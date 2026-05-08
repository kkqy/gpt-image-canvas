import type { Hono } from "hono";
import sharp from "sharp";
import { parsePreviewWidth, readStoredAssetPreview } from "../../domain/assets/preview.js";
import { readStoredAsset, readStoredAssetMetadata } from "../../domain/generation/image-generation.js";
import { getAssetPromptMetadata, type AssetPromptMetadata } from "../../domain/project/project-store.js";
import { downloadFileName, errorResponse } from "../http/errors.js";

const PROMPT_METADATA_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const WINDOWS_EXIF_TEXT_LIMIT = 12_000;

interface PromptMetadataDownloadInput {
  assetId: string;
  bytes: Buffer;
  mimeType: string;
  promptMetadata?: AssetPromptMetadata;
}

export function registerAssetRoutes(app: Hono): void {
  app.get("/api/assets/:id/preview", async (c) => {
    const parsedWidth = parsePreviewWidth(c.req.query("width"));
    if (!parsedWidth.ok) {
      return c.json(errorResponse(parsedWidth.code, parsedWidth.message), 400);
    }

    const preview = await readStoredAssetPreview(c.req.param("id"), parsedWidth.width);
    if (!preview) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    return new Response(new Uint8Array(preview.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${downloadFileName(c.req.param("id"))}-${preview.width}.webp"`,
        "Content-Type": "image/webp"
      }
    });
  });

  app.get("/api/assets/:id/metadata", async (c) => {
    const metadata = await readStoredAssetMetadata(c.req.param("id"));
    if (!metadata) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    return c.json(metadata);
  });

  app.get("/api/assets/:id/download", async (c) => {
    const assetId = c.req.param("id");
    const asset = await readStoredAsset(assetId);
    if (!asset) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    const bytes = await embedPromptMetadataForDownload({
      assetId,
      bytes: asset.bytes,
      mimeType: asset.file.mimeType,
      promptMetadata: getAssetPromptMetadata(assetId)
    });

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `attachment; filename="${downloadFileName(asset.file.fileName)}"`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": asset.file.mimeType
      }
    });
  });

  app.get("/api/assets/:id", async (c) => {
    const asset = await readStoredAsset(c.req.param("id"));
    if (!asset) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    return new Response(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${asset.file.fileName}"`,
        "Content-Type": asset.file.mimeType
      }
    });
  });
}

async function embedPromptMetadataForDownload(input: PromptMetadataDownloadInput): Promise<Buffer> {
  if (!input.promptMetadata || !PROMPT_METADATA_MIME_TYPES.has(input.mimeType)) {
    return input.bytes;
  }

  try {
    const image = sharp(input.bytes).keepMetadata().withXmp(buildPromptXmp(input.promptMetadata));
    if (input.mimeType === "image/jpeg") {
      image.withExifMerge({
        IFD0: {
          XPComment: truncateWindowsExifText(formatWindowsExifPromptComment(input.promptMetadata)),
          XPKeywords: "gpt-image-canvas",
          XPSubject: truncateWindowsExifText(input.promptMetadata.prompt),
          XPTitle: "gpt-image-canvas prompt metadata",
          Software: "gpt-image-canvas"
        }
      });
    }

    return await image.toBuffer();
  } catch (error) {
    console.warn(`Could not embed prompt metadata for asset ${sanitizeLogValue(input.assetId)}. ${errorToMessage(error)}`);
    return input.bytes;
  }
}

function buildPromptXmp(metadata: AssetPromptMetadata): string {
  const prompt = escapeXml(metadata.prompt);
  const effectivePrompt = escapeXml(metadata.effectivePrompt);

  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description
      rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:gic="https://github.com/kkqy/gpt-image-canvas/metadata/1.0/">
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${prompt}</rdf:li>
        </rdf:Alt>
      </dc:description>
      <gic:source>gpt-image-canvas</gic:source>
      <gic:prompt>${prompt}</gic:prompt>
      <gic:effectivePrompt>${effectivePrompt}</gic:effectivePrompt>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function formatWindowsExifPromptComment(metadata: AssetPromptMetadata): string {
  return `Prompt: ${metadata.prompt}\nEffective prompt: ${metadata.effectivePrompt}`;
}

function truncateWindowsExifText(value: string): string {
  return value.length <= WINDOWS_EXIF_TEXT_LIMIT ? value : `${value.slice(0, WINDOWS_EXIF_TEXT_LIMIT)}...`;
}

function sanitizeLogValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "_");
}

function errorToMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Request failed.";
}
