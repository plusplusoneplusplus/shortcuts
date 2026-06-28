# Monorepo Layout, Build, and Release

The repository is an npm workspaces monorepo for published Node packages. This file documents the cross-package contract, build/test commands, package management, and conventions enforced across the whole tree. Load it when planning multi-package changes, debugging build/release issues, or wiring new conventions.

## Products & Shared Packages

| Product | Location | Runtime | Description |
|---------|----------|---------|-------------|
| **CoC CLI** | `packages/coc/` | Node.js | CLI for executing YAML-based AI workflows (`coc run|validate|list|serve|wipe-data`) |
| **CoC Container** | `packages/coccontainer/` | Node.js | Container-oriented CoC server package with messaging integrations and service entry points |
| **CoC Client** | `packages/coc-client/` | Node.js/browser | Framework-free TypeScript client for CoC REST and realtime APIs |
| **Deep Wiki** | `packages/deep-wiki/` | Node.js | CLI that auto-generates comprehensive wikis for codebases (`deep-wiki seeds|discover|generate|theme|init`) |
| **Teams Bot** | `packages/teams-bot/` | Node.js | Microsoft Teams bot integration for CoC-backed workflows |

| Shared Package | Location | Description |
|----------------|----------|-------------|
| **coc-workflow** | `packages/coc-workflow/` | Pure DAG workflow compiler/executor plus portable Ralph orchestration contracts/helpers, workflow types, validation, scheduling, node executors, result adapter, and legacy pipeline YAML compatibility types |
| **forge** | `packages/forge/` | Core AI utilities and compatibility surface: imports AI SDK from `coc-agent-sdk`, task queue, runtime policies, process store, git CLI, remote server connectors (`connectors` sub-path: SSH, DevTunnel), utilities, and workflow compatibility exports |
| **coc-agent-sdk** | `packages/coc-agent-sdk/` | Provider-agnostic AI agent SDK: `CopilotSDKService`, `CodexSDKService`, `SDKServiceRegistry`, session lifecycle, streaming state machine, MCP config, model registry |
| **coc-memory** | `packages/coc-memory/` | Memory V2 core package: SQLite-backed fact/episode stores, hybrid search, embedding provider abstraction, capture service, safety scanning |
| **whatsapp-bot** | `packages/whatsapp-bot/` | Standalone WhatsApp bot via Baileys — no CoC/forge deps. Used by `coccontainer` when `messaging.whatsapp.enabled` is true |

**Architectural boundary:** Shared behavior belongs in Node packages with explicit package contracts. UI-facing behavior for the CoC dashboard lives under `packages/coc/`; reusable REST clients live in `packages/coc-client/`; workflow, memory, SDK, and utility logic stay in their dedicated packages.

## Package Management & Publishing

Published workspaces (`coc`, `coc-workflow`, `forge`, `coc-agent-sdk`, `coc-memory`, `coc-client`, `deep-wiki`, `coccontainer`, `whatsapp-bot`, `teams-bot`) are published to npm under the `@plusplusoneplusplus` scope with public access. Versioning and publishing are coordinated via **`@changesets/cli`** with an independent versioning strategy.

**How workspace packages are consumed:** `coc` and `deep-wiki` depend on published workspace packages via caret ranges. During local development, npm workspaces symlink them automatically. There is no bundling or copying into consumer packages — packages are resolved from `node_modules` at runtime.

**CoC build order:** `packages/coc-agent-sdk` builds before `coc-workflow`; `coc-workflow` builds before `forge` and `coc`; and `coc` depends on compiled `coc-agent-sdk`, `coc-client`, `coc-workflow`, and `coc-memory` output. The root `build:packages` script builds `coc-agent-sdk`, `coc-workflow`, `forge`, `coc-client`, and `coc-memory` before `coc`. Direct `packages/forge` builds run `scripts/prebuild.mjs` to build `coc-agent-sdk` and `coc-workflow` before `tsc`; direct `packages/coc` builds run `scripts/prebuild.mjs` to build `coc-agent-sdk`, `coc-client`, `coc-workflow`, and `coc-memory`, then clean `dist` before `tsc` emits package artifacts.

**Versioning workflow:**
1. Add a changeset: `npm run changeset` (interactive prompt for affected packages and semver bump)
2. Version packages: `npm run version-packages` (applies changesets, updates `package.json` versions and changelogs)
3. Publish: `npm run publish-packages` (builds all packages then runs `changeset publish`)

**CI release:** `.github/workflows/release.yml` runs on pushes to `main`. When pending changesets exist, `changesets/action` opens a "Version Packages" PR. When the PR is merged (no pending changesets), it publishes changed packages to npm.

**Changesets config:** `.changeset/config.json` — independent versioning, public access, `main` as base branch, `updateInternalDependencies: "patch"`.

**Minimum Node.js:** All packages require Node.js ≥ 24 (`engines.node`). CI runs on `24.x`.

## Build & Test

- **Build packages:** `npm run build:packages`
- **Build all:** `npm run build`
- **Compile:** `npm run compile` (alias for package build)
- **Test all:** `npm run test`
- **Test packages:** `npm run test:run` in any package directory (Vitest)
- **Lint:** `npm run lint`
- **Debug CoC:** `cd packages/coc && npm run build && npm link && cd ../..` then `coc run <path>` or `coc serve --no-open`
- **Debug Deep Wiki:** `cd packages/deep-wiki && npm run build && npm link && cd ../..` then `deep-wiki generate <repo>`
- **Run CoCContainer with rebuild loop:** `./scripts/coccontainer-serve-loop.sh --port 8080` installs dependencies, builds and links the package chain, verifies native dependencies such as `better-sqlite3`, then starts `coccontainer serve --no-open`
- **Run CoC as a service:** see [coc-service.md](coc-service.md)

## Cross-Package Conventions

**Repo-scoped data:** All runtime data specific to a single repository must live under `~/.coc/repos/<workspaceId>/`. Use `getRepoDataPath(dataDir, workspaceId, filename)` from `packages/coc/src/server/` to resolve the path. Do **NOT** add new top-level directories under `~/.coc/` for per-repo data.

**Canonical origin IDs:** Forge git helpers export `resolveCanonicalOrigin()` / `resolveCanonicalOriginId()` from `@plusplusoneplusplus/forge/git`. They derive `gh_<owner>_<repo>` for GitHub, `ado_<org>_<project>` for Azure DevOps, `git_<remoteHash>` for unknown remotes, and `local_<workspaceId>` when no remote exists.

**Creating work items:** Work items are stored as JSON files in `~/.coc/repos/<originId>/work-items/` using canonical origin IDs (`local_<workspaceId>` for workspaces with no remote), not as `.plan.md` files in `tasks/`. Same-origin workspace directories are migrated into the canonical origin directory on first store access.

- **ALWAYS use the REST API** to create/update work items when the CoC server is running:
  ```
  POST http://localhost:4000/api/workspaces/<workspaceId>/work-items
  Body: { title, description, priority, tags, source }
  ```
- **Never write work-item JSON files directly** — the server uses an atomic write-queue.

**Model resolution:** `task.config.model` > `PerRepoPreferences.defaultModels[mode]` > `defaultModel` > CLI default.

## Development Notes

- TypeScript packages targeting Node.js ≥ 24
- Format on save and import organization enabled
- Cross-platform: Linux, macOS, Windows
