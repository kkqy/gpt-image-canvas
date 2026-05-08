# Local Feature Delta

Read this before merging or rebasing from upstream `raw/main`. These are local features that were added on top of upstream and must not be dropped when upstream reorganizes files or replaces UI structure.

The current upstream merge baseline was `raw/main` at `a1c6cd48d66ba0766d004c77199ed1aaae9655a1`. If upstream changes the same areas again, compare source behavior instead of relying on file names, because upstream split the app across `features/*`, `domain/*`, `server/routes/*`, and `styles/*`.

## Merge Rule

- Keep upstream's current module structure unless there is a specific reason not to.
- Preserve every behavior listed below, even when upstream moves or rewrites the surrounding file.
- After resolving conflicts, verify both source-level behavior and browser UI. Passing typecheck alone is not enough for Gallery and Canvas behavior.
- Do not revert to the old monolithic `apps/web/src/App.tsx`, `apps/api/src/index.ts`, or `apps/web/src/styles.css` layout just to recover local behavior.

## Gallery And Asset Behavior

Local Gallery behavior is more capable than upstream and must survive merges.

- Gallery supports multi-select with persistent selected state.
- Gallery supports Shift range selection using the last selected output as an anchor.
- Gallery supports batch download with progress, cancellation, and per-file status.
- Gallery supports batch delete with progress, cancellation, and a confirmation dialog.
- Deleting one or more Gallery outputs must remove the corresponding generated outputs from generation history.
- Deleting one or more Gallery outputs must remove linked image shapes from the canvas.
- Canvas cleanup must not depend only on the currently mounted editor. It must also clean persisted tldraw snapshots so images do not reappear after navigating back to the canvas or after reload.
- If Gallery deletion happens before the editor is mounted, deleted asset ids must be retained and cleaned when the editor mounts.
- Gallery delete confirmation copy must say that local files and asset records are deleted, while cloud backups are not deleted.
- Deleting a Gallery item on the API must delete unused local asset files and previews, remove local asset records, and clean reference rows for that asset.
- Asset deletion must not remove a shared local asset file if another Gallery output still references the same asset.

Important paths:

- `apps/web/src/features/gallery/GalleryPage.tsx`
- `apps/web/src/features/canvas/CanvasApp.tsx`
- `apps/web/src/styles/gallery-cards.css`
- `apps/web/src/styles/responsive.css`
- `apps/web/src/styles/dark.css`
- `apps/api/src/domain/project/project-store.ts`
- `apps/api/src/server/routes/gallery.ts`

Browser checks after merging Gallery changes:

- The featured first Gallery image can be selected.
- A selected Gallery image keeps its checkmark visible after the pointer leaves the card.
- Batch toolbar buttons enable and disable correctly.
- Batch delete shows a confirmation dialog and progress UI.
- Single and batch delete remove linked images from the canvas and from persisted project state.
- Deleting from `/gallery` first and then opening `/canvas` must not show deleted images.

## Canvas Quick Actions

The canvas has local quick actions that upstream may not include.

- `一键清理` / `Clean failed` removes failed generation placeholders from the current canvas.
- `一键排版` / `Auto arrange` arranges selected image shapes, or all canvas image shapes if none are selected.
- The quick action bar must be visible on desktop and usable on mobile.

Important paths:

- `apps/web/src/features/canvas/CanvasApp.tsx`
- `apps/web/src/shared/i18n/index.tsx`
- `apps/web/src/styles/canvas.css`
- `apps/web/src/styles/responsive.css`
- `apps/web/src/styles/dark.css`

Browser checks after merging Canvas UI changes:

- Canvas route shows both quick action buttons.
- Clean failed reports a useful empty-state message when no failed placeholders exist.
- Auto arrange reports a useful empty-state message when no images exist.
- Auto arrange keeps selected images selected after arranging.

## Background Generation Recovery

Manual generation has local recovery behavior that must survive upstream merges.

- Manual generation placeholders use the server `generationId` as their placeholder request id so they can be recovered after reload.
- Loading a project must preserve restorable manual generation placeholders instead of blindly filtering all loading placeholders.
- Running or pending generation records should reconnect to polling after reload when matching placeholders exist on the canvas.
- Completed, failed, or cancelled records should be applied to matching placeholders after reload.
- History rows for pending or running records should still allow cancellation, even when no active in-memory task exists yet.
- Locating a pending history record should find placeholders by either temporary record id or server generation id.

Important paths:

- `apps/web/src/features/canvas/CanvasApp.tsx`
- `apps/api/src/server/routes/images.ts`
- `apps/api/src/domain/project/project-store.ts`

Verification notes:

- `pnpm typecheck` validates types but does not prove recovery works.
- End-to-end recovery requires a real running generation: start generation, reload before completion, then confirm polling resumes and the placeholder is replaced or failed correctly.
- Service restarts should mark stale running records failed with a clear message.

## Prompt Metadata And Downloads

Downloaded images include prompt metadata locally.

- Asset downloads should embed prompt metadata when possible.
- Download routes should preserve `Content-Length` after metadata embedding.
- Metadata lookup must use the stored generated asset record, not only current history UI state.

Important paths:

- `apps/api/src/server/routes/assets.ts`
- `apps/api/src/domain/project/project-store.ts`

## Batch Generation Concurrency

Manual text generation and reference generation use bounded parallel requests.

- Each requested output is sent upstream as a single-image request.
- `OPENAI_IMAGE_BATCH_CONCURRENCY` controls how many single-output requests run at once.
- Default concurrency is `2`.
- This applies to text generation and reference image editing.
- Completed outputs are persisted while the generation record is still `running`, using `generation_outputs.position` to preserve placeholder order.
- Canvas polling should replace each completed output's placeholder incrementally; it must not wait for the whole batch to finish before showing any generated image.
- Gallery may show completed outputs from a still-running generation; Canvas should stay in sync with those completed outputs on the next poll.
- If a running generation already has at least `count` persisted outputs, `/api/generations/:id` must reconcile the generation status to `succeeded`, `partial`, or `failed` instead of leaving it stuck as `running`.
- Startup stale-running cleanup must preserve completed or partially completed outputs: complete output sets should become final records, partial output sets should become `partial`, and only empty interrupted records should become `failed`.
- Existing `generation_outputs` rows created before `position` existed must be backfilled by creation order so Canvas can map outputs to placeholders deterministically.

Important paths:

- `apps/api/src/domain/generation/image-generation.ts`
- `apps/api/src/infrastructure/database.ts`
- `apps/api/src/infrastructure/schema.ts`
- `apps/web/src/features/canvas/CanvasApp.tsx`
- `.env.example`
- `README.md`
- `README.zh-CN.md`

## Provider, Storage, And Local Data Expectations

Local-first behavior is intentional and should not be weakened during upstream merges.

- Local provider config and Codex auth state live in SQLite under `DATA_DIR`.
- COS configuration and upload status are local runtime data.
- COS upload failure must not fail image generation.
- Generated local assets should remain usable even when cloud backup failed.
- Secrets must never be logged and must not be committed through `.env`, SQLite files, `data/`, `.ralph/`, or `.codex-temp/`.

Relevant references:

- `docs/PRODUCT_SENSE.md`
- `docs/RELIABILITY.md`
- `docs/SECURITY.md`
- `docs/product-specs/gallery-and-assets.md`
- `docs/product-specs/provider-configuration.md`

## Upstream Merge Checklist

Run this checklist before committing an upstream merge.

- Compare local `main` against the upstream merge base for Gallery, Canvas generation, assets, and provider/storage behavior.
- Search for all functions listed in this document and confirm equivalent behavior exists after conflict resolution.
- Run `pnpm typecheck`.
- Run `pnpm build`.
- Run the app and verify Gallery selection, Gallery deletion, Canvas quick actions, provider configuration, and Agent tab rendering.
- If real credentials are available, verify one manual generation with `count > 1` and confirm bounded parallel output handling still works.
- If possible, verify one reload-during-generation recovery path.
- Commit with a message that distinguishes upstream merge work from local feature restoration.
