import type { Hono } from "hono";
import {
  completeReferenceGenerationRecord,
  completeTextGenerationRecord,
  createRunningReferenceGenerationRecord,
  createRunningTextGenerationRecord,
  isGenerationAbortError,
  markGenerationRecordCancelled,
  markGenerationRecordFailed
} from "../../domain/generation/image-generation.js";
import { getGenerationRecord } from "../../domain/project/project-store.js";
import { createConfiguredImageProvider } from "../../domain/providers/image-provider-selection.js";
import { ProviderError, type EditImageProviderInput, type ImageProviderInput } from "../../infrastructure/providers/image-provider.js";
import { errorResponse, errorToMessage, providerErrorJson } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseEditPayload, parseGeneratePayload } from "../http/validation.js";

interface ServerGenerationTask {
  controller: AbortController;
}

const serverGenerationTasks = new Map<string, ServerGenerationTask>();

export function registerImageRoutes(app: Hono): void {
  app.post("/api/images/generate", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseGeneratePayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      const record = createRunningTextGenerationRecord(parsed.value);
      startTextGenerationTask(record.id, parsed.value);
      return c.json({ record });
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.post("/api/images/edit", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseEditPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      const started = await createRunningReferenceGenerationRecord(parsed.value);
      startReferenceGenerationTask(started.record.id, started.input);
      return c.json({ record: started.record });
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.get("/api/generations/:id", (c) => {
    const record = getGenerationRecord(c.req.param("id"));
    if (!record) {
      return c.json(errorResponse("not_found", "找不到请求的生成记录。"), 404);
    }

    return c.json({ record });
  });

  app.post("/api/generations/:id/cancel", (c) => {
    const generationId = c.req.param("id");
    const existingRecord = getGenerationRecord(generationId);
    if (!existingRecord) {
      return c.json(errorResponse("not_found", "找不到请求的生成记录。"), 404);
    }
    if (existingRecord.status !== "running" && existingRecord.status !== "pending") {
      return c.json({ record: existingRecord });
    }

    const task = serverGenerationTasks.get(generationId);
    if (task) {
      task.controller.abort();
      serverGenerationTasks.delete(generationId);
    }

    markGenerationRecordCancelled(generationId, "已取消本次生成。");
    const record = getGenerationRecord(generationId);
    if (!record) {
      return c.json(errorResponse("not_found", "找不到请求的生成记录。"), 404);
    }

    return c.json({ record });
  });
}

function startTextGenerationTask(generationId: string, input: ImageProviderInput): void {
  startGenerationTask(generationId, async (signal) => {
    const provider = await createConfiguredImageProvider(signal);
    await completeTextGenerationRecord(generationId, input, provider, signal);
  });
}

function startReferenceGenerationTask(generationId: string, input: EditImageProviderInput): void {
  startGenerationTask(generationId, async (signal) => {
    const provider = await createConfiguredImageProvider(signal);
    await completeReferenceGenerationRecord(generationId, input, provider, signal);
  });
}

function startGenerationTask(generationId: string, run: (signal: AbortSignal) => Promise<void>): void {
  const controller = new AbortController();
  serverGenerationTasks.set(generationId, { controller });

  void run(controller.signal)
    .catch((error) => {
      if (isGenerationAbortError(error) || controller.signal.aborted) {
        markGenerationRecordCancelled(generationId, "已取消本次生成。");
        return;
      }

      markGenerationRecordFailed(generationId, errorToMessage(error));
    })
    .finally(() => {
      serverGenerationTasks.delete(generationId);
    });
}
