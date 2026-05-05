import { desc, eq, inArray } from "drizzle-orm";
import { isAbsolute, relative, resolve } from "node:path";
import { deleteStoredAssetPreviews } from "./asset-preview.js";
import { LocalAssetStorageAdapter } from "./asset-storage.js";
import type {
  GeneratedAsset,
  GalleryImageItem,
  GalleryResponse,
  GenerationRecord as ApiGenerationRecord,
  GenerationStatus,
  ImageMode,
  ImageQuality,
  OutputFormat,
  OutputStatus,
  ProjectState
} from "./contracts.js";
import { db } from "./database.js";
import { runtimePaths } from "./runtime.js";
import { assets, generationOutputs, generationRecords, generationReferenceAssets, projects } from "./schema.js";

export const DEFAULT_PROJECT_ID = "default";
const DEFAULT_PROJECT_NAME = "Default Project";
const fallbackWarnings = new Set<string>();
const localAssetStorage = new LocalAssetStorageAdapter();

export interface AssetPromptMetadata {
  prompt: string;
  effectivePrompt: string;
}

interface ProjectSnapshotInput {
  name?: string;
  snapshotJson: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseSnapshot(snapshotJson: string): unknown | null {
  return JSON.parse(snapshotJson) as unknown;
}

export function ensureDefaultProject(): void {
  const existing = getDefaultProjectRow();

  if (existing) {
    return;
  }
  if (defaultProjectRowExists()) {
    return;
  }

  const createdAt = nowIso();
  db.insert(projects)
    .values({
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      snapshotJson: "null",
      createdAt,
      updatedAt: createdAt
    })
    .run();
}

export function saveProjectSnapshot(input: ProjectSnapshotInput): ProjectState {
  ensureDefaultProject();

  const updatedAt = nowIso();
  const current = getDefaultProjectRow();

  db.update(projects)
    .set({
      name: input.name ?? current?.name ?? DEFAULT_PROJECT_NAME,
      snapshotJson: input.snapshotJson,
      updatedAt
    })
    .where(eq(projects.id, DEFAULT_PROJECT_ID))
    .run();

  return getProjectState();
}

export function getProjectState(): ProjectState {
  ensureDefaultProject();

  const project = getDefaultProjectRow();

  if (!project) {
    return {
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      snapshot: null,
      history: getGenerationHistory(),
      updatedAt: nowIso()
    };
  }

  return {
    id: project.id,
    name: project.name,
    snapshot: parseSnapshot(project.snapshotJson),
    history: getGenerationHistory(),
    updatedAt: project.updatedAt
  };
}

export function getGalleryImages(): GalleryResponse {
  const rows = db
    .select({
      output: generationOutputs,
      generation: generationRecords,
      asset: assets
    })
    .from(generationOutputs)
    .innerJoin(generationRecords, eq(generationOutputs.generationId, generationRecords.id))
    .innerJoin(assets, eq(generationOutputs.assetId, assets.id))
    .where(eq(generationOutputs.status, "succeeded"))
    .orderBy(desc(generationOutputs.createdAt))
    .all();

  return {
    items: rows.map(({ output, generation, asset }) => ({
      outputId: output.id,
      generationId: generation.id,
      mode: generation.mode as ImageMode,
      prompt: generation.prompt,
      effectivePrompt: generation.effectivePrompt,
      presetId: generation.presetId,
      size: {
        width: generation.width,
        height: generation.height
      },
      quality: generation.quality as ImageQuality,
      outputFormat: generation.outputFormat as OutputFormat,
      createdAt: output.createdAt,
      asset: toGeneratedAsset(asset)
    })).filter((item): item is GalleryImageItem => Boolean(item.asset))
  };
}

export async function deleteGalleryOutput(outputId: string): Promise<boolean> {
  const output = db.select().from(generationOutputs).where(eq(generationOutputs.id, outputId)).get();
  if (!output) {
    return false;
  }

  const asset = output.assetId ? db.select().from(assets).where(eq(assets.id, output.assetId)).get() : undefined;
  const shouldDeleteAsset = asset ? !isAssetUsedByAnotherGalleryOutput(asset.id, outputId) : false;
  if (asset && shouldDeleteAsset) {
    await deleteLocalAssetFile(asset);
    await deleteStoredAssetPreviews(asset.id);
  }

  const result = db.delete(generationOutputs).where(eq(generationOutputs.id, outputId)).run();
  if (result.changes === 0) {
    return false;
  }

  if (asset && shouldDeleteAsset) {
    db.delete(generationReferenceAssets).where(eq(generationReferenceAssets.assetId, asset.id)).run();
    db.update(generationRecords)
      .set({ referenceAssetId: null })
      .where(eq(generationRecords.referenceAssetId, asset.id))
      .run();
    db.delete(assets).where(eq(assets.id, asset.id)).run();
  }

  return true;
}

function isAssetUsedByAnotherGalleryOutput(assetId: string, outputId: string): boolean {
  return db
    .select({ id: generationOutputs.id })
    .from(generationOutputs)
    .where(eq(generationOutputs.assetId, assetId))
    .all()
    .some((output) => output.id !== outputId);
}

async function deleteLocalAssetFile(asset: typeof assets.$inferSelect): Promise<void> {
  const filePath = resolve(runtimePaths.dataDir, asset.relativePath);
  if (!isInsideDirectory(filePath, runtimePaths.assetsDir)) {
    return;
  }

  await localAssetStorage.deleteObject({ filePath });
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const localPath = relative(directory, filePath);
  return Boolean(localPath) && !localPath.startsWith("..") && !isAbsolute(localPath);
}

export function getAssetPromptMetadata(assetId: string): AssetPromptMetadata | undefined {
  return db
    .select({
      prompt: generationRecords.prompt,
      effectivePrompt: generationRecords.effectivePrompt
    })
    .from(generationOutputs)
    .innerJoin(generationRecords, eq(generationOutputs.generationId, generationRecords.id))
    .where(eq(generationOutputs.assetId, assetId))
    .get();
}

export function getGenerationRecord(generationId: string): ApiGenerationRecord | undefined {
  const record = db.select().from(generationRecords).where(eq(generationRecords.id, generationId)).get();
  if (!record) {
    return undefined;
  }

  return mapGenerationRecordRows([record])[0];
}

export function markStaleRunningGenerationsFailed(message: string): void {
  db.update(generationRecords)
    .set({
      status: "failed",
      error: message
    })
    .where(eq(generationRecords.status, "running"))
    .run();
}

function getDefaultProjectRow(): (typeof projects.$inferSelect) | undefined {
  try {
    return db.select().from(projects).where(eq(projects.id, DEFAULT_PROJECT_ID)).get();
  } catch (error) {
    warnOnce(
      "project-read-fallback",
      `Project row could not be read; returning a blank canvas fallback. ${formatErrorSummary(error)}`
    );
    return undefined;
  }
}

function defaultProjectRowExists(): boolean {
  try {
    const row = db.select({ id: projects.id }).from(projects).where(eq(projects.id, DEFAULT_PROJECT_ID)).get();
    return Boolean(row);
  } catch {
    return true;
  }
}

function getGenerationHistory(): ApiGenerationRecord[] {
  try {
    return readGenerationHistory();
  } catch (error) {
    warnOnce(
      "history-read-fallback",
      `Generation history could not be read; returning an empty history. ${formatErrorSummary(error)}`
    );
    return [];
  }
}

function warnOnce(key: string, message: string): void {
  if (fallbackWarnings.has(key)) {
    return;
  }

  fallbackWarnings.add(key);
  console.warn(message);
}

function formatErrorSummary(error: unknown): string {
  if (error instanceof Error) {
    const codeValue = (error as { code?: unknown }).code;
    const code = typeof codeValue === "string" ? `${codeValue}: ` : "";
    return `${code}${error.message}`;
  }

  return String(error);
}

function readGenerationHistory(): ApiGenerationRecord[] {
  const records = db.select().from(generationRecords).orderBy(desc(generationRecords.createdAt)).limit(20).all();
  return mapGenerationRecordRows(records);
}

function mapGenerationRecordRows(records: Array<typeof generationRecords.$inferSelect>): ApiGenerationRecord[] {
  if (records.length === 0) {
    return [];
  }

  const generationIds = records.map((record) => record.id);
  const outputs = db
    .select()
    .from(generationOutputs)
    .where(inArray(generationOutputs.generationId, generationIds))
    .orderBy(generationOutputs.createdAt)
    .all();
  const referenceRows = db
    .select()
    .from(generationReferenceAssets)
    .where(inArray(generationReferenceAssets.generationId, generationIds))
    .all()
    .sort((left, right) =>
      left.generationId === right.generationId
        ? left.position - right.position
        : left.generationId.localeCompare(right.generationId)
    );

  const assetIds = outputs.flatMap((output) => (output.assetId ? [output.assetId] : []));
  const assetRows =
    assetIds.length > 0 ? db.select().from(assets).where(inArray(assets.id, assetIds)).all() : [];
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));

  const outputsByGenerationId = new Map<string, typeof outputs>();
  for (const output of outputs) {
    const existing = outputsByGenerationId.get(output.generationId) ?? [];
    existing.push(output);
    outputsByGenerationId.set(output.generationId, existing);
  }
  const referenceAssetIdsByGenerationId = new Map<string, string[]>();
  for (const referenceRow of referenceRows) {
    const existing = referenceAssetIdsByGenerationId.get(referenceRow.generationId) ?? [];
    existing.push(referenceRow.assetId);
    referenceAssetIdsByGenerationId.set(referenceRow.generationId, existing);
  }

  return records.flatMap((record) => {
    const mappedOutputs = (outputsByGenerationId.get(record.id) ?? []).map((output) => ({
      id: output.id,
      status: output.status as OutputStatus,
      asset: output.assetId ? toGeneratedAsset(assetById.get(output.assetId)) : undefined,
      error: output.error ?? undefined
    }));

    if (mappedOutputs.length === 0 && record.status === "succeeded") {
      return [];
    }

    return [
      {
        id: record.id,
        mode: record.mode as ImageMode,
        prompt: record.prompt,
        effectivePrompt: record.effectivePrompt,
        presetId: record.presetId,
        size: {
          width: record.width,
          height: record.height
        },
        quality: record.quality as ImageQuality,
        outputFormat: record.outputFormat as OutputFormat,
        count: record.count,
        status: record.status as GenerationStatus,
        error: record.error ?? undefined,
        referenceAssetIds: referenceAssetIdsByGenerationId.get(record.id) ?? (record.referenceAssetId ? [record.referenceAssetId] : undefined),
        referenceAssetId: record.referenceAssetId ?? undefined,
        createdAt: record.createdAt,
        outputs: mappedOutputs
      }
    ];
  });
}

function toGeneratedAsset(asset: (typeof assets.$inferSelect) | undefined): GeneratedAsset | undefined {
  if (!asset) {
    return undefined;
  }

  return {
    id: asset.id,
    url: `/api/assets/${asset.id}`,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    cloud:
      asset.cloudProvider === "cos" && (asset.cloudStatus === "uploaded" || asset.cloudStatus === "failed")
        ? {
            provider: asset.cloudProvider,
            status: asset.cloudStatus,
            lastError: asset.cloudError ?? undefined,
            uploadedAt: asset.cloudUploadedAt ?? undefined
          }
        : undefined
  };
}
