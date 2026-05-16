# AGENTS.md

Guidance for AI agents working in this repository. NEVER create document files unless explicitly asked.

## Key Design Choice (Maintained manually, AI should NEVER update this section)
- CoC:
    - multi-repo support is required. Never design or implement a feature that would break multi-repo scenario. 
    - copilot-sdk wrapper should NEVER add a sendFollowUp method or something similar. copilot-sdk-wrapper layer or above should NEVER try to add keep-alive/session-object cache.
    - Prefer use file path in the prompt instead of expanding the prompt with file's content.

## Monorepo Overview

Three products plus shared infrastructure, all in one npm workspaces monorepo:

| Product | Location | Runtime | Description |
|---------|----------|---------|-------------|
| **VS Code Extension** | `packages/vscode-extension/` | VS Code | Markdown review, git diff review, code review, shortcut groups, global notes, tasks viewer, YAML workflows — **FROZEN: do not modify** |
| **CoC CLI** | `packages/coc/` | Node.js | CLI for executing YAML-based AI workflows (`coc run\|validate\|list\|serve\|wipe-data`) |
| **CoC Client** | `packages/coc-client/` | Node.js/browser | Framework-free TypeScript client for CoC REST and realtime APIs |
| **Deep Wiki** | `packages/deep-wiki/` | Node.js | CLI that auto-generates comprehensive wikis for codebases (`deep-wiki seeds\|discover\|generate\|theme\|init`) |

| Shared Package | Location | Description |
|----------------|----------|-------------|
| **forge** | `packages/forge/` | Core AI/pipeline engine: AI SDK (CopilotSDKService, session-per-request), DAG workflow engine (executeWorkflow, compileToWorkflow), task queue, runtime policies, process store, git CLI, utilities |

**Key architectural boundary:** Pure Node.js logic lives in packages (no VS Code deps). VS Code-specific wrappers live in `packages/vscode-extension/src/shortcuts/`. Example: `forge/src/ai/` = pure AI SDK; `packages/vscode-extension/src/shortcuts/ai-service/` = VS Code UI wrapper. **`packages/vscode-extension/` is frozen — do not read, edit, or reason about its code.**

## Package Management & Publishing

All published packages (`forge`, `coc`, `coc-client`, `deep-wiki`) are published to npm under the `@plusplusoneplusplus` scope with public access. Versioning and publishing are coordinated via **`@changesets/cli`** with an independent versioning strategy.

**How forge is consumed:** `coc` and `deep-wiki` depend on the published `@plusplusoneplusplus/forge` package via a caret range (`^1.0.0`). During local development, npm workspaces symlink forge automatically. There is no bundling or copying of forge into consumer packages — forge is resolved from `node_modules` at runtime.

**Versioning workflow:**
1. Add a changeset: `npm run changeset` (interactive prompt for affected packages and semver bump)
2. Version packages: `npm run version-packages` (applies changesets, updates `package.json` versions and changelogs)
3. Publish: `npm run publish-packages` (builds all packages then runs `changeset publish`)

**CI release:** `.github/workflows/release.yml` runs on pushes to `main`. When pending changesets exist, `changesets/action` opens a "Version Packages" PR. When the PR is merged (no pending changesets), it publishes changed packages to npm.

**Changesets config:** `.changeset/config.json` — independent versioning, public access, `main` as base branch, `updateInternalDependencies: "patch"`.

**Minimum Node.js:** All packages require Node.js ≥ 24 (`engines.node`). CI runs on `24.x`.

## Build & Test

- **Build packages:** `npm run build:packages` · **Build extension:** `npm run compile` · **Watch:** `npm run watch`
- **Test all:** `npm run test` (extension Mocha tests, 6900+)
- **Test packages:** `npm run test:run` in any package directory (Vitest)
- **Lint:** `npm run lint` · **Package:** `npm run vsce:package` · **Publish:** `npm run vsce:publish`
- **Debug CoC:** `cd packages/coc && npm run build && npm link && cd ../..` then `coc run <path>` or `coc serve --no-open`
- **Debug Deep Wiki:** `cd packages/deep-wiki && npm run build && npm link && cd ../..` then `deep-wiki generate <repo>`
- **Run CoC as a service:** `.\scripts\Manage-CoCService.ps1 install` (see section below)

## CoC Service Management (`scripts/Manage-CoCService.ps1`)

Manages `coc-serve-loop.ps1` as a Windows Task Scheduler task running under the SYSTEM account at startup.

```
.\scripts\Manage-CoCService.ps1 <Command> [options]
```

| Command      | Description |
|--------------|-------------|
| `install`    | Register the startup task (requires elevation). Runs an initial build by default. Use `-TunnelId` to host a configured Microsoft Dev Tunnel alongside the server. |
| `uninstall`  | Stop and remove the task (requires elevation). |
| `start`      | Start the task immediately (no reboot required). |
| `stop`       | Stop the task and kill all CoC-related processes. |
| `restart`    | `stop` then `start`. |
| `status`     | Show task state, running PIDs, log file size, and last log line. |
| `logs`       | Print the last N log lines. Use `-Follow` for continuous tail. |

Key options: `-Port` (default 4000, non-tunnel mode only), `-BindAddress` (default `127.0.0.1`; use `0.0.0.0` to expose on all interfaces — named `-BindAddress` to avoid PowerShell's `$Host` automatic variable), `-TunnelId` (host the configured Microsoft Dev Tunnel and use its persisted HTTP port binding), `-NoBuildSkip` (build on every start, not just install), `-LogLines` (default 50), `-Follow`, `-TaskName` (default `CoCServer`). Configure the tunnel first with `.\scripts\config-devtunnel.ps1 [-TunnelId <id>] [-Port <port>]`; the service loop reads the configured tunnel port and only starts/stops `devtunnel host`.

**Log file:** `~/.coc/logs/coc-service.log` — rotated automatically at 10 MB.

## VS Code Extension(`packages/vscode-extension/`) — FROZEN

> ⚠️ **This folder is frozen and no longer actively developed. AI agents must NOT read, edit, or reason about code in `packages/vscode-extension/`. It is not an npm workspace.**

Entry point: `packages/vscode-extension/src/extension.ts`. Feature modules under `packages/vscode-extension/src/shortcuts/`:

- **markdown-comments** — Custom Editor API for inline markdown review. Comments in `.vscode/comments/<hash>.json`.
- **git-diff-comments** — Git diff review with comment categories and resolve/reopen workflow.
- **code-review** — Review commits against rules in `.github/cr-rules/*.md`.
- **yaml-pipeline** — Workflows management UI. Workflows are directories with `pipeline.yaml` under `.vscode/workflows/`.
- **tasks-viewer** — Hierarchical task management in `.vscode/tasks/`. Recursive scanning, document grouping by suffix (plan/spec/test/notes/todo/design/impl/review/checklist/requirements/analysis).
- **ai-service** — VS Code AI wrapper: `AIProcessManager` (Memento persistence), `AIQueueService`, `CopilotCLIInvoker`. Working dir defaults to `{workspace}/src` if exists.
- **git** — VS Code git layer wrapping `forge/src/git/`.
- **skills** — Install skills from GitHub repos or local dirs to `.github/skills`.
- **shared** — Base classes: `BaseTreeDataProvider`, `FilterableTreeDataProvider`, icon/filter/error utilities.

**Configuration:** `.vscode/shortcuts.yaml` with `basePaths` (aliases like `@frontend`), `logicalGroups` (nested, items of type file/folder/command/task/note), `globalNotes`. Versioned migration system (v1→v4) in `config-migrations.ts`.

**MCP/Permissions:** `SendMessageOptions` supports `availableTools` (whitelist), `excludedTools` (blacklist), `mcpServers`, `onPermissionRequest`. MCP config auto-loaded from `~/.copilot/mcp-config.json` for every session (opt out with `loadDefaultMcpConfig: false` or `mcpServers: {}`). Without `onPermissionRequest`, operations are denied by default.

## CoC CLI (`packages/coc/`)

Standalone CLI for YAML AI workflows. Consumes `forge`. Server functionality (HTTP/WebSocket, REST API, SSE streaming, SPA dashboard, wiki serving) is integrated directly into `packages/coc/src/server/`.

**Commands:** `coc run <path>`, `coc validate <path>`, `coc list [dir]`, `coc serve`, `coc skills`, `coc wipe-data`.

**Configuration:** `~/.coc/config.yaml` (legacy: `~/.coc.yaml`). CLI flags > config file > defaults. Default process store backend is SQLite. Namespaced config merge/source tracking is registered in `packages/coc/src/config/namespace-registry.ts`; add namespace fields there instead of expanding branch lists in `config.ts`.

**Loop subsystem (`src/server/loops/`):** Recurring follow-up messages within a conversation. **Gated by `loops.enabled` config flag (default `false`).** When disabled, infrastructure is not constructed, REST routes are not registered, `scheduleWakeup`/`createLoop` LLM tools are filtered out, the `/loop` skill is not auto-installed, and dashboard UI (badge, panel, slash-command) is hidden. Separate from schedules — own `LoopEntry` type, own SQLite persistence (`loops` table in `processes.db`), own executor. Uses `ScheduleTimerRegistry` for timing and `TaskQueueManager` for follow-up execution.

- **Types:** `LoopEntry`, `LoopStatus` (`active`/`paused`/`cancelled`/`expired`) in `loop-types.ts`.
- **Persistence:** `LoopStore` — SQLite CRUD with `ensureTable()`, max 50 active loops per server.
- **Executor:** `LoopExecutor` — arms timers, handles tick execution with circuit breakers (3 consecutive failures → auto-pause, 100 wakeups/process limit, 3-day TTL default). Per-process concurrency guard prevents double-firing.
- **LLM tools:** `createLoop`, `cancelLoop`, `listLoops` (skill-gated via `/loop` skill); `scheduleWakeup` (always available, registered in `LLM_TOOL_REGISTRY`). Defined in `llm-tools/loop-tools.ts`.
- **Bundled skill:** `/loop` in `forge/resources/bundled-skills/loop/SKILL.md` — teaches interval parsing, mode selection, user confirmation, stop-condition recognition.
- **REST API:** Workspace-scoped at `/api/workspaces/:id/loops`, server-wide at `/api/loops`. CRUD + pause/resume. Handler in `loops/loop-handler.ts`.
- **Infrastructure:** `loop-infrastructure.ts` factory creates LoopStore + LoopExecutor + ScheduleTimerRegistry. Wired into `createExecutionServer`. On shutdown, active loops are paused with `pausedReason: 'server-restart'` (no auto-resume).
- **Dashboard UI:** `LoopBadge` (header badge with active count), `LoopManagementPanel` (list/pause/resume/cancel), turn source badge on `ConversationTurnBubble` for loop/wakeup turns.
- **Turn metadata:** `turnSource` field on `ConversationTurn` (`{ source: 'loop'|'wakeup', loopId/wakeupId }`) propagated through follow-up executor pipeline.
- **Follow-up mode resolution:** `resolveFollowUpMode(store, processId, explicit?)` in `executors/follow-up-mode.ts` is the single source of truth for "what mode does this follow-up run in?". Every programmatic follow-up enqueue site (loop ticks, wakeup timer, requeue) must call it and set `payload.mode`. `validateAndParseTask` only defaults `payload.mode` to `autopilot` for new chats (no `processId`); REST follow-ups must supply mode. `FollowUpExecutor.executeFollowUp` requires `mode` and logs a fail-loud warning + defaults to `'ask'` if missing.

**Testing:** 627+ Vitest test files under `packages/coc/test/server/`.

> **Deep reference:** See `.github/skills/coc-knowledge/` for detailed architecture, module layout, REST API catalog, memory system, LLM tools, and dashboard SPA documentation.

## CoC Client (`packages/coc-client/`)

Framework-free TypeScript client for CoC REST and realtime APIs. Exposes domain clients for all server endpoints plus WebSocket events and per-process SSE streaming helpers. Includes `LoopsClient` domain for loop CRUD + pause/resume.

## Deep Wiki (`packages/deep-wiki/`)

CLI that generates comprehensive wikis via a six-phase AI pipeline (Seeds → Discovery → Consolidation → Analysis → Writing → Website). Consumes `forge`.

**Commands:** `deep-wiki seeds`, `deep-wiki discover`, `deep-wiki generate`, `deep-wiki theme`, `deep-wiki init`.

**Testing:** 64 Vitest test files.

> **Deep reference:** See `.github/skills/coc-knowledge/references/deep-wiki.md`.

## forge (`packages/forge/`)

Pure Node.js AI engine — no VS Code deps. Published as `@plusplusoneplusplus/forge`.

**Key modules:** Logger, Errors, Runtime policies, Task queue, AI SDK (CopilotSDKService, session-per-request), Workflow engine (DAG), Map-Reduce, Process store (SQLite default), Git CLI, Diff providers (`src/diff/` — unified `IDiffProvider` for commit, range, working-tree, PR, and PR-iteration diffs), Memory system, Skills, Utilities. `ConversationTurn` includes optional `turnSource` field for loop/wakeup attribution. Bundled skills include `/loop` in `resources/bundled-skills/loop/`.

**Workflow execution:** `compileToWorkflow(yamlContent)` → `executeWorkflow(config, options)` → `flattenWorkflowResult(result)`.

**Testing:** 156 Vitest test files.

> **Deep reference:** See `.github/skills/coc-knowledge/` for SDK wrapper, workflow engine, memory system, and process store details.

## Key Conventions

**Convention — repo-scoped data:** All runtime data specific to a single repository must live under `~/.coc/repos/<workspaceId>/`. Use `getRepoDataPath(dataDir, workspaceId, filename)` from `packages/coc/src/server/` to resolve the path. Do **NOT** add new top-level directories under `~/.coc/` for per-repo data.

**Convention — creating work items:** Work items are stored as JSON files in `~/.coc/repos/<workspaceId>/work-items/` (NOT as `.plan.md` files in `tasks/`).
- **ALWAYS use the REST API** to create/update work items when the CoC server is running:
  ```
  POST http://localhost:4000/api/workspaces/<workspaceId>/work-items
  Body: { title, description, priority, tags, source }
  ```
- **Never write work-item JSON files directly** — the server uses an atomic write-queue.

**Convention — model resolution:** `task.config.model` > `PerRepoPreferences.defaultModels[mode]` > `defaultModel` > CLI default.

## Development Notes

- TypeScript, webpack bundling, VS Code API ≥ 1.95.0, Node.js ≥ 24
- Format on save and import organization enabled
- Tree data providers: extend `BaseTreeDataProvider` or `FilterableTreeDataProvider`
- Commands registered centrally in `src/shortcuts/commands.ts`
- Cross-platform: Linux, macOS, Windows
