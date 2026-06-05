# Monorepo Layout, Build, and Release

The published Node packages plus a frozen VS Code extension live in one npm workspaces monorepo. This file documents the cross-package contract, build/test commands, package management, and conventions enforced across the whole tree. Load it when planning multi-package changes, debugging build/release issues, or wiring new conventions.

## Products & Shared Packages

| Product | Location | Runtime | Description |
|---------|----------|---------|-------------|
| **VS Code Extension** | `packages/vscode-extension/` | VS Code | Markdown review, git diff review, code review, shortcut groups, global notes, tasks viewer, YAML workflows — **FROZEN: do not modify** |
| **CoC CLI** | `packages/coc/` | Node.js | CLI for executing YAML-based AI workflows (`coc run|validate|list|serve|wipe-data`) |
| **CoC Client** | `packages/coc-client/` | Node.js/browser | Framework-free TypeScript client for CoC REST and realtime APIs |
| **Deep Wiki** | `packages/deep-wiki/` | Node.js | CLI that auto-generates comprehensive wikis for codebases (`deep-wiki seeds|discover|generate|theme|init`) |

| Shared Package | Location | Description |
|----------------|----------|-------------|
| **coc-workflow** | `packages/coc-workflow/` | Pure DAG workflow compiler/executor plus portable Ralph orchestration contracts/helpers, workflow types, validation, scheduling, node executors, result adapter, and legacy pipeline YAML compatibility types |
| **forge** | `packages/forge/` | Core AI utilities and compatibility surface: imports AI SDK from `coc-agent-sdk`, task queue, runtime policies, process store, git CLI, remote server connectors (`connectors` sub-path: SSH, DevTunnel), utilities, and workflow compatibility exports |
| **coc-agent-sdk** | `packages/coc-agent-sdk/` | Provider-agnostic AI agent SDK: `CopilotSDKService`, `CodexSDKService`, `SDKServiceRegistry`, session lifecycle, streaming state machine, MCP config, model registry |
| **coc-memory** | `packages/coc-memory/` | Memory V2 core package: SQLite-backed fact/episode stores, hybrid search, embedding provider abstraction, capture service, safety scanning |
| **whatsapp-bot** | `packages/whatsapp-bot/` | Standalone WhatsApp bot via Baileys — no CoC/forge deps. Used by `coccontainer` when `messaging.whatsapp.enabled` is true |

**Architectural boundary:** Pure Node.js logic lives in packages (no VS Code deps). VS Code-specific wrappers live in `packages/vscode-extension/src/shortcuts/`. Example: `forge/src/ai/` = pure AI SDK; `packages/vscode-extension/src/shortcuts/ai-service/` = VS Code UI wrapper. **`packages/vscode-extension/` is frozen — do not read, edit, or reason about its code.**

## Package Management & Publishing

Published workspaces (`coc`, `coc-workflow`, `forge`, `coc-agent-sdk`, `coc-memory`, `coc-client`, `deep-wiki`, `coccontainer`, `whatsapp-bot`, `teams-bot`) are published to npm under the `@plusplusoneplusplus` scope with public access. Versioning and publishing are coordinated via **`@changesets/cli`** with an independent versioning strategy.

**How workspace packages are consumed:** `coc` and `deep-wiki` depend on published workspace packages via caret ranges. During local development, npm workspaces symlink them automatically. There is no bundling or copying into consumer packages — packages are resolved from `node_modules` at runtime.

**CoC build order:** `packages/coc-agent-sdk` builds before `coc-workflow`; `coc-workflow` builds before `forge` and `coc`; and `coc` depends on compiled `coc-client`, `coc-workflow`, and `coc-memory` output. The root `build:packages` script builds `coc-agent-sdk`, `coc-workflow`, `forge`, `coc-client`, and `coc-memory` before `coc`. Direct `packages/forge` builds run `scripts/prebuild.mjs` to build `coc-agent-sdk` and `coc-workflow` before `tsc`; direct `packages/coc` builds run `scripts/prebuild.mjs` to build `coc-client`, `coc-workflow`, and `coc-memory` before `tsc`.

**Versioning workflow:**
1. Add a changeset: `npm run changeset` (interactive prompt for affected packages and semver bump)
2. Version packages: `npm run version-packages` (applies changesets, updates `package.json` versions and changelogs)
3. Publish: `npm run publish-packages` (builds all packages then runs `changeset publish`)

**CI release:** `.github/workflows/release.yml` runs on pushes to `main`. When pending changesets exist, `changesets/action` opens a "Version Packages" PR. When the PR is merged (no pending changesets), it publishes changed packages to npm.

**Changesets config:** `.changeset/config.json` — independent versioning, public access, `main` as base branch, `updateInternalDependencies: "patch"`.

**Minimum Node.js:** All packages require Node.js ≥ 24 (`engines.node`). CI runs on `24.x`.

## Build & Test

- **Build packages:** `npm run build:packages`
- **Build extension:** `npm run compile`
- **Watch:** `npm run watch`
- **Test all:** `npm run test` (extension Mocha tests, 6900+)
- **Test packages:** `npm run test:run` in any package directory (Vitest)
- **Lint:** `npm run lint`
- **Package:** `npm run vsce:package`
- **Publish:** `npm run vsce:publish`
- **Debug CoC:** `cd packages/coc && npm run build && npm link && cd ../..` then `coc run <path>` or `coc serve --no-open`
- **Debug Deep Wiki:** `cd packages/deep-wiki && npm run build && npm link && cd ../..` then `deep-wiki generate <repo>`
- **Run CoCContainer with rebuild loop:** `./scripts/coccontainer-serve-loop.sh --port 8080` installs dependencies, builds and links the package chain, verifies native dependencies such as `better-sqlite3`, then starts `coccontainer serve --no-open`
- **Run CoC as a service:** see [coc-service.md](coc-service.md)

## Cross-Package Conventions

**Repo-scoped data:** All runtime data specific to a single repository must live under `~/.coc/repos/<workspaceId>/`. Use `getRepoDataPath(dataDir, workspaceId, filename)` from `packages/coc/src/server/` to resolve the path. Do **NOT** add new top-level directories under `~/.coc/` for per-repo data.

**Creating work items:** Work items are stored as JSON files in `~/.coc/repos/<workspaceId>/work-items/` (NOT as `.plan.md` files in `tasks/`).

- **ALWAYS use the REST API** to create/update work items when the CoC server is running:
  ```
  POST http://localhost:4000/api/workspaces/<workspaceId>/work-items
  Body: { title, description, priority, tags, source }
  ```
- **Never write work-item JSON files directly** — the server uses an atomic write-queue.

**Model resolution:** `task.config.model` > `PerRepoPreferences.defaultModels[mode]` > `defaultModel` > CLI default.

## VS Code Extension (FROZEN)

> ⚠️ `packages/vscode-extension/` is frozen and no longer actively developed. AI agents must NOT read, edit, or reason about code in `packages/vscode-extension/`. It is not an npm workspace.

Historical reference (do not modify): entry point `packages/vscode-extension/src/extension.ts`. Feature modules under `packages/vscode-extension/src/shortcuts/` covered markdown comments, git diff comments, code review, YAML pipelines, tasks viewer, AI service, git layer, skills, and shared base classes. Configuration lived in `.vscode/shortcuts.yaml` with a versioned migration system (v1→v4). MCP/Permissions were handled via `SendMessageOptions`.

## Development Notes

- TypeScript, webpack bundling, VS Code API ≥ 1.95.0, Node.js ≥ 24
- Format on save and import organization enabled
- Cross-platform: Linux, macOS, Windows
- (Extension only, frozen) Tree data providers extend `BaseTreeDataProvider` or `FilterableTreeDataProvider`; commands are registered centrally in `src/shortcuts/commands.ts`
