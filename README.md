# GPT Image Canvas

[English](README.md) | [简体中文](README.zh-CN.md)

Local AI image canvas for prompt-to-image generation, reference-image generation, and multi-step Agent planning. It combines tldraw, Hono, SQLite, and GPT Image 2 into a local-first creative workspace.

Current version: `v0.2.0`.

## Preview

![GPT Image Canvas preview](docs/assets/app-preview.png)

## What It Does

- Create and arrange AI-generated images on a tldraw canvas.
- Generate from text prompts or use selected canvas images as references.
- Save project state, generation history, and generated assets locally.
- Configure image providers from `.env`, the in-app provider dialog, or Codex login.
- Plan multi-image work in the Agent tab, then execute DAG-based generation jobs around a plan node.
- Optionally back up new generated images to Tencent Cloud COS.
- Browse local outputs in Gallery, including rerun, locate, download, and upload status.

## Requirements

- Node.js `24.15.0`. The repo includes `.nvmrc` and `.node-version`.
- pnpm `9.14.2`. The version is pinned in `package.json`.
- An OpenAI API key with access to `gpt-image-2`, an OpenAI-compatible image endpoint, or a Codex login completed inside the app.
- Docker Desktop or a compatible Docker Engine, only if you want the Docker workflow.

Activate the pinned package manager with Corepack if needed:

```sh
corepack prepare pnpm@9.14.2 --activate
```

## Quick Start

Windows PowerShell:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm dev
```

macOS/Linux:

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Open the web app at [http://localhost:5173](http://localhost:5173).

`pnpm dev` starts both local services:

- API: [http://127.0.0.1:8787](http://127.0.0.1:8787)
- Web: [http://localhost:5173](http://localhost:5173), proxying `/api` to the API service

The app can start without credentials. Without a usable provider, `/` shows the credential-aware homepage and generation requests return `missing_provider` until you configure one.

## Configure Generation

The default provider order is:

1. Environment OpenAI-compatible config from `.env` or runtime variables.
2. Local OpenAI-compatible config saved in the app.
3. Codex login fallback.

For the simplest API-key setup, edit `.env`:

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_TIMEOUT_MS=1200000
```

Leave `OPENAI_BASE_URL` empty for the official OpenAI API. Set it to an OpenAI-compatible `/v1` endpoint when using another provider, and set `OPENAI_IMAGE_MODEL` if that endpoint expects a different image model name.

You can also open the top-right `配置` dialog and save one local OpenAI-compatible provider. Local keys are stored in SQLite under `DATA_DIR`, returned only as masked values, and preserved until you enter a replacement key.

## Routes

- `/` is the credential-aware homepage. It offers `Codex 登录` and `接入 API` when no provider is available.
- `/canvas` is the working canvas. Without a provider, it redirects back to `/`.
- `/gallery` remains available even without credentials, so local work can still be viewed.

Environment values are read-only in the provider dialog. If you change `.env`, restart the API or Docker container.

## Using the Canvas

The right-side panel has two main flows:

- `Manual`: enter a prompt, choose size/quality/format, and generate. Selecting one image shape switches the flow into reference-image generation.
- `Agent`: describe a multi-image task, optionally select up to three canvas images, review the generated plan node, then execute it.

Agent planning uses a separate OpenAI-compatible chat configuration from the image provider. Save it in the Agent LLM settings with API key, Base URL, model, timeout, and `supportsVision`.

When `supportsVision` is enabled, selected images are attached to the planning request as multimodal inputs. When disabled, selected images are passed only as reference handles for later image generation. Agent messages are not persisted in this version; plan nodes already on the canvas are saved with the normal canvas snapshot.

Plan execution is DAG-based. Independent jobs can run in parallel, jobs that reference generated outputs wait for their dependencies, and `Retry failed` reruns failed or blocked jobs while keeping successful upstream outputs. A single plan is capped at 16 generated images, including intermediate anchors.

## Cloud Backup

Generated images are always saved locally first. If Tencent Cloud COS is enabled from the in-app cloud storage dialog, new images are also uploaded to:

```text
<key-prefix>/YYYY/MM/<assetId>.<ext>
```

The COS dialog is prefilled from:

- `COS_DEFAULT_BUCKET`
- `COS_DEFAULT_REGION`
- `COS_DEFAULT_KEY_PREFIX`

Saving COS settings performs a test upload and delete before the config is persisted. `SecretKey` is stored in local SQLite and only returned as a masked value. COS upload failures do not fail image generation; the image remains available locally and the history item shows the upload failure.

## Project Layout

```text
apps/api         Hono API, SQLite storage, provider selection, Agent planning/execution
apps/web         Vite + React + tldraw web app
packages/shared  Shared contracts and constants
docs             Project docs and preview assets
data             Local runtime data, ignored by Git
```

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start API and web dev servers. |
| `pnpm api:dev` | Start the API dev workflow. |
| `pnpm web:dev` | Start the Vite web dev workflow. |
| `pnpm typecheck` | Typecheck shared, web, and API packages. |
| `pnpm build` | Build shared, web, and API packages. |
| `pnpm start` | Start the built API package. |
| `pnpm --filter @gpt-image-canvas/api smoke:planner` | Check Agent plan validation fixtures. |
| `pnpm --filter @gpt-image-canvas/api smoke:agent` | Check Agent config and WebSocket basics. |
| `pnpm --filter @gpt-image-canvas/api smoke:executor` | Check Agent DAG execution with a fake image provider. |

Before completing code changes, run:

```sh
pnpm typecheck
pnpm build
```

For UI changes, run `pnpm dev` and verify the Vite app in a browser at [http://localhost:5173](http://localhost:5173).

If `better-sqlite3` reports a `NODE_MODULE_VERSION` mismatch after switching Node versions, rebuild it:

```sh
pnpm --filter @gpt-image-canvas/api rebuild better-sqlite3 --stream
```

## Docker

Docker Compose builds shared contracts, the web app, and the API into one image. The API serves both `/api` and the built web bundle from one localhost port. SQLite data and generated assets persist in host `./data`.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
docker compose config --quiet --no-env-resolution
docker compose up --build
```

macOS/Linux:

```sh
cp .env.example .env
docker compose config --quiet --no-env-resolution
docker compose up --build
```

Open [http://localhost:8787](http://localhost:8787) by default. Set `PORT` in `.env` before starting Compose to use a different localhost port.

Use `docker compose config --quiet --no-env-resolution` when real credentials exist. Plain `docker compose config` expands env files and can print secrets.

Compose defaults `SQLITE_JOURNAL_MODE=DELETE` and `SQLITE_LOCKING_MODE=EXCLUSIVE` to avoid SQLite shared-memory errors on Docker Desktop bind mounts. Avoid running `pnpm dev` and Docker against the same `data/` directory at the same time.

The Compose build accepts these network-related build args:

- `NODE_IMAGE`
- `NPM_CONFIG_REGISTRY`
- `APT_MIRROR`
- `APT_SECURITY_MIRROR`

The default `NODE_IMAGE` is `node:24.15.0-bookworm-slim`.

## Runtime Data And Secrets

`DATA_DIR` defaults to `./data` locally and `/app/data` in Docker. It contains:

- `gpt-image-canvas.sqlite`: project state, generation history, asset metadata, provider config, Agent LLM config, optional COS config, and Codex OAuth token records.
- `assets/`: generated image files.

Do not commit `.env`, `.ralph/`, `.codex-temp/`, `data/`, generated images, SQLite databases, or build output.

Treat `data/gpt-image-canvas.sqlite` as sensitive after saving local provider keys, Agent LLM keys, COS secrets, or Codex tokens. The app is designed for local workstation use; do not expose it publicly without adding your own authentication and network controls.

If a real API key was ever committed, rotate the key. Git ignore rules prevent future leaks, but they do not remove secrets from existing Git history.

## Troubleshooting

- Missing provider: add `OPENAI_API_KEY` to `.env` and restart, save a local provider from `配置`, or complete `Codex 登录`.
- Codex login fails: confirm the machine can reach `https://auth.openai.com`, keep the login dialog open, and restart the flow if the user code expires.
- Custom endpoint fails: confirm `OPENAI_BASE_URL` points to an OpenAI-compatible `/v1` endpoint and supports the configured image model.
- Agent cannot plan: save the Agent LLM config separately from the image provider config. If `supportsVision` is enabled and the request fails, try fewer or smaller selected images.
- Agent plan cannot execute: confirm the normal image provider is configured; Agent planning and image generation use separate configs.
- Port conflict: set `PORT` for API/Docker. For web dev, stop the process on `5173` or run `pnpm web:dev -- --port 5174`.
- Docker cannot pull the base image: restore Docker Hub access or set `NODE_IMAGE` to an equivalent cached Node `24.15.0` image.
- SQLite `SQLITE_IOERR_SHMOPEN` in Docker: keep the Compose SQLite defaults, rebuild, and make sure no local API process is using the same database.
- SQLite `SQLITE_CORRUPT`: stop all app processes, back up `data/`, then restore from backup or remove the SQLite files to create a clean database. Files under `data/assets/` can be kept.
- Stale local state: stop the app and remove files under `data/`. This deletes local project state, history, and generated assets.

## Upgrading

Before upgrading an older local install, back up runtime data:

Windows PowerShell:

```powershell
Copy-Item -Recurse data data-backup-before-upgrade
docker compose up --build
```

macOS/Linux:

```sh
cp -R data data-backup-before-upgrade
docker compose up --build
```

Rebuild the web app and API together after an upgrade.

## Codex Notes

Codex can work directly in this repository. Let it read `AGENTS.md`, then use the pinned package manager:

```sh
pnpm install
pnpm typecheck
pnpm build
```

The default COS form values are read from `.env`:

- `COS_DEFAULT_BUCKET`
- `COS_DEFAULT_REGION`
- `COS_DEFAULT_KEY_PREFIX`

Saving COS settings performs a test upload and delete before persisting the configuration. `SecretKey` is stored in the local SQLite database because the app has no server-side account system yet, but GET responses only return a masked secret indicator.

Cloud upload failures do not fail image generation. The asset remains available locally, and the UI marks the history item with the cloud backup failure.

## Local Data

Runtime state is stored under `DATA_DIR`, which defaults to `./data` locally and `/app/data` in Docker. The directory contains:

- `gpt-image-canvas.sqlite` for the default project, generation history, asset metadata, cloud upload metadata, one optional local provider configuration, optional COS settings, and Codex OAuth token records.
- `assets/` for generated image files.

The Docker Compose workflow bind-mounts host `./data` to `/app/data`, so projects and generated assets survive container rebuilds. Do not commit `.env`, `data/`, generated images, SQLite files, or build output.

## Security / Privacy Notes

- Secrets are read only from `.env`, runtime environment variables, or the local SQLite settings database. Never commit `.env`, expanded Docker Compose config output, shell history containing keys, SQLite databases, or logs that include secret values.
- Local provider API keys saved from the top-right provider dialog are stored in SQLite and masked by the provider-config API. Treat `data/gpt-image-canvas.sqlite` as sensitive after saving a local API key, and do not publish the local app without adding your own authentication and network controls.
- Codex OAuth access tokens, refresh tokens, ID tokens, email, account ID, expiry, and refresh timestamps are stored in local SQLite under `DATA_DIR`. Treat the SQLite database as sensitive runtime data after Codex login.
- COS SecretKey values saved from the UI are stored locally in SQLite and are masked by the settings API. Treat `data/gpt-image-canvas.sqlite` as sensitive when COS is configured.
- Prompts, project state, generated assets, and SQLite data are local runtime data under `DATA_DIR`. Treat `data/` as private unless you intentionally export specific assets.
- Before publishing a branch, check `git status --short` and confirm only source, docs, and intended metadata are staged. `.env`, `.ralph/`, `.codex-temp/`, `data/`, generated images, SQLite databases, and build output should stay untracked.
- If a real API key was ever committed, rotate that key first. Git ignore rules prevent future leaks, but they do not remove secrets from existing Git history.

## Troubleshooting

- Missing or empty `OPENAI_API_KEY`: the app still boots. If no local API config or Codex session is available, `/` shows the homepage and text-to-image / reference-image requests return `missing_provider`. Add a valid key to `.env` and restart the API or Docker container, save a local API key from `配置`, or use the `Codex 登录` flow.
- Codex login cannot complete: confirm the machine can reach `https://auth.openai.com`, keep the device-login dialog open until authorization finishes, and restart the flow if the user code expires. Do not paste or log token values.
- Custom provider endpoint: set `OPENAI_BASE_URL` in `.env`, for example `https://api.example.com/v1`, then restart the API or Docker container, or enter a local Base URL in `配置`. The endpoint must be OpenAI-compatible and support the configured image model.
- Missing model access: confirm the OpenAI organization and project used by the active provider key can access the configured image model. Set `OPENAI_IMAGE_MODEL` or the local advanced model field if your compatible endpoint expects a different model name.
- High-resolution generation timeouts: upstream image requests default to 20 minutes; increase `OPENAI_IMAGE_TIMEOUT_MS` or the local provider timeout field if needed.
- Batch generation concurrency: each requested output is sent upstream as a single-image request. `OPENAI_IMAGE_BATCH_CONCURRENCY` controls how many run at once and defaults to `2`.
- Port already in use: set `PORT` in `.env` for the API/Docker runtime. If Web port `5173` is occupied, stop the process using it, or run `pnpm web:dev -- --port 5174` explicitly and open the printed URL.
- Docker build cannot pull the Node base image: use a locally cached image with `NODE_IMAGE=node:23-bullseye-slim docker compose up --build` on macOS/Linux or `$env:NODE_IMAGE = 'node:23-bullseye-slim'` followed by `docker compose up --build` in Windows PowerShell, or restore Docker Hub access and rerun `docker compose up --build`.
- Docker config output includes `.env` values by default. Use `docker compose config --quiet --no-env-resolution` for validation when real credentials are present, and do not share expanded config output.
- SQLite `SQLITE_IOERR_SHMOPEN` in Docker: keep the Compose defaults `SQLITE_JOURNAL_MODE=DELETE` and `SQLITE_LOCKING_MODE=EXCLUSIVE`, rebuild, and make sure no local API process is using the same `data/` database at the same time.
- SQLite `SQLITE_CORRUPT`: stop all app processes, back up `data/`, and restore from backup or remove the SQLite files to let the app create a clean database. Generated image files under `data/assets/` can be kept.
- `/api/project` returns 400 while autosaving: check Docker logs for `Project save rejected`. Large canvases are supported up to 100 MB snapshots; imported data URL images can still make snapshots very large.
- Stale or unwanted local state: stop the app and remove files under `data/`. This deletes local project state, history, and generated assets.

Keep credentials out of prompts and logs. For Ralph-driven work, read `docs/ralph-execution.md`; keep PRDs under `.agents/tasks/`, runtime state under `.ralph/`, and scratch files under `.codex-temp/`.

## License

MIT

## Friendly Links

- [LINUX DO - 新的理想型社区](https://linux.do/)
