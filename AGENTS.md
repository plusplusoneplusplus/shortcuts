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
| **Deep Wiki** | `packages/deep-wiki/` | Node.js | CLI that auto-generates comprehensive wikis for codebases (`deep-wiki seeds\|discover\|generate\|theme\|init`) |

| Shared Package | Location | Description |
|----------------|----------|-------------|
| **forge** | `packages/forge/` | Core AI/pipeline engine: AI SDK (CopilotSDKService, session-per-request), DAG workflow engine (executeWorkflow, compileToWorkflow), task queue, runtime policies, process store, git CLI, utilities |

**Key architectural boundary:** Pure Node.js logic lives in packages (no VS Code deps). VS Code-specific wrappers live in `packages/vscode-extension/src/shortcuts/`. Example: `forge/src/ai/` = pure AI SDK; `packages/vscode-extension/src/shortcuts/ai-service/` = VS Code UI wrapper. **`packages/vscode-extension/` is frozen — do not read, edit, or reason about its code.**

## Package Management & Publishing

All three packages (`forge`, `coc`, `deep-wiki`) are published to npm under the `@plusplusoneplusplus` scope with public access. Versioning and publishing are coordinated via **`@changesets/cli`** with an independent versioning strategy.

**How forge is consumed:** `coc` and `deep-wiki` depend on the published `@plusplusoneplusplus/forge` package via a caret range (`^1.0.0`). During local development, npm workspaces symlink forge automatically. There is no bundling or copying of forge into consumer packages — forge is resolved from `node_modules` at runtime.

**Versioning workflow:**
1. Add a changeset: `npm run changeset` (interactive prompt for affected packages and semver bump)
2. Version packages: `npm run version-packages` (applies changesets, updates `package.json` versions and changelogs)
3. Publish: `npm run publish-packages` (builds all packages then runs `changeset publish`)

**CI release:** `.github/workflows/release.yml` runs on pushes to `main`. When pending changesets exist, `changesets/action` opens a "Version Packages" PR. When the PR is merged (no pending changesets), it publishes changed packages to npm.

**Changesets config:** `.changeset/config.json` — independent versioning, public access, `main` as base branch, `updateInternalDependencies: "patch"`.

**Minimum Node.js:** All packages require Node.js ≥ 24 (`engines.node`). CI runs on `24.x`.

## Build & Test

- **Build all:** `npm run build` · **Build extension:** `npm run compile` · **Watch:** `npm run watch`
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
| `install`    | Register the startup task (requires elevation). Runs an initial build by default. |
| `uninstall`  | Stop and remove the task (requires elevation). |
| `start`      | Start the task immediately (no reboot required). |
| `stop`       | Stop the task and kill all CoC-related processes. |
| `restart`    | `stop` then `start`. |
| `status`     | Show task state, running PIDs, log file size, and last log line. |
| `logs`       | Print the last N log lines. Use `-Follow` for continuous tail. |

Key options: `-Port` (default 4000), `-NoBuildSkip` (build on every start, not just install), `-LogLines` (default 50), `-Follow`, `-TaskName` (default `CoCServer`).

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

**Commands:** `coc run <path>` (execute workflow), `coc validate <path>`, `coc list [dir]`, `coc serve` (AI dashboard + wiki serving), `coc wipe-data`.

**Key `run` flags:** `-m` model, `-p` parallel, `-o` output format (table/json/csv/markdown), `-f` output file, `--param key=value`, `--dry-run`, `--approve-permissions`, `--timeout`, `-v` verbose.

**Key `serve` flags:** `-p` port (default 4000), `-H` host, `-d` data-dir (`~/.coc`), `--theme`, `--no-open`.

**Configuration:** `~/.coc/config.yaml` (legacy: `~/.coc.yaml`). CLI flags > config file > defaults. Exit codes: 0=success, 1=error, 2=config, 3=AI unavailable, 130=SIGINT. Default process store backend is SQLite (`store.backend: sqlite`); use `createProcessStore(dataDir, backend?)` from `src/config.ts` to instantiate the correct store.

**Architecture:** `src/cli.ts` (Commander setup) → `src/commands/` (run, validate, list, serve, wipe-data) → `src/server/` (HTTP router, API handler, WebSocket, SSE, queue, scheduling, tasks, wiki integration, SPA dashboard).

**Testing:** 114+ Vitest test files covering CLI, commands, server handlers, queue, wiki, SPA, e2e.

## Deep Wiki (`packages/deep-wiki/`)

CLI that generates comprehensive wikis via a six-phase AI pipeline. Consumes `forge`.

**Commands:** `deep-wiki seeds <repo>` (theme seeds), `deep-wiki discover <repo>` (Phase 1 only), `deep-wiki generate <repo>` (full pipeline), `deep-wiki theme <repo> [name]` (cross-cutting theme articles), `deep-wiki init` (template config).

**Six-Phase Pipeline:**
1. **Seeds** (optional) — AI identifies key themes/domains. Heuristic fallback from directory names.
2. **Discovery** — AI with MCP tools produces `ComponentGraph` JSON. Large repo support (3000+ files): multi-round or iterative breadth-first using seeds.
3. **Consolidation** — Rule-based + AI clustering to merge/refine components. Skip with `--no-cluster`.
4. **Analysis** — Per-component deep analysis with MCP tools. Incremental via git-hash caching.
5. **Writing** — Article generation + reduce/synthesis for overviews.
6. **Website** — Static HTML with themes (light/dark/auto), Mermaid zoom/pan support.

**Key concepts:** Components (smallest code unit, always present), Domains (top-level dirs, large repos only), Themes (cross-cutting concerns spanning components).

**Theme pipeline:** `deep-wiki theme` runs: Probe → Outline → Analysis → Articles → Wiki Integration (updates `module-graph.json`, cross-links).

**Key flags:** `--output`, `--model`, `--concurrency`, `--depth` (shallow/normal/deep), `--seeds` (auto or file), `--phase` (start from N), `--force`, `--use-cache`, `--skip-website`, `--no-cluster`.

**Caching:** `.wiki-cache/` with git-hash invalidation. Per-phase: seeds, probes, discovery, consolidation, analysis, articles. `--force` bypasses; `--use-cache` ignores hash.

**Testing:** 64 Vitest test files covering all phases, theme module, cache, commands, rendering.

## forge (`packages/forge/`)

Pure Node.js AI engine — no VS Code deps. Published as `@plusplusoneplusplus/forge`.

**Key modules:** Logger (pluggable), Errors (`PipelineCoreError` with codes), Runtime policies (timeout/retry/cancellation via `runWithPolicy`), Task queue (`TaskQueueManager` + `QueueExecutor`), AI SDK (`CopilotSDKService`, session-per-request, MCP config, model registry), Workflow engine (DAG executor, compiler, node executors, concurrency limiter, result adapter), Map-Reduce (`MapReduceExecutor`, splitters, reducers), Process store (`SqliteProcessStore` default — single `processes.db` file; legacy `FileProcessStore` — per-repo JSON files under `~/.coc/repos/<workspaceId>/processes/`), Git CLI (`@plusplusoneplusplus/forge/git` subpath), Editor (anchor, parsing, rendering), Tasks (scanner, parser, operations), Memory (see below), Templates (commit replication), ADO (Azure DevOps work items + PRs), Skills (scanner, installer, bundled provider, skill resolver), Utilities (file I/O, glob, HTTP, text matching, AI response parsing, template engine, CSV reader, prompt resolver, filter executor, input generator).

**Module layout (post pipeline/ deletion):**
- Pipeline YAML config types → `workflow/pipeline-compat.ts` (used by compiler)
- Pipeline phase/event types → `pipeline-types.ts` (used by process-store, coc SPA)
- Workspace execution / WSL routing → `utils/workspace-execution.ts` (shared execution-context detection, WSL command args, repo path normalization)
- CSV reader → `utils/csv-reader.ts`
- Prompt resolver → `utils/prompt-resolver.ts`
- Skill resolver → `skills/skill-resolver.ts`
- Template engine (pipeline) → `utils/pipeline-template.ts`
- Filter executor (pipeline) → `utils/filter-executor.ts`
- Input generator → `utils/input-generator.ts`
- Retry utils → `utils/retry-utils.ts`
- Paste context manager → `utils/paste-context-manager.ts` (large prompt externalization to temp files)

**Workflow execution:** `compileToWorkflow(yamlContent)` converts legacy pipeline YAML or native workflow YAML to `WorkflowConfig`, then `executeWorkflow(config, options)` runs the DAG. Use `flattenWorkflowResult(result)` for flat display output.

**Testing:** 156 Vitest test files.

## Server Layer (`packages/coc/src/server/`)

HTTP/WebSocket server for AI dashboard and wiki serving. Previously a separate `coc-server` package, now merged into `coc`.

**Execution layer:** Process CRUD API, queue management, admin (time-limited crypto tokens for destructive ops), WebSocket (workspace-scoped events, file subscriptions), SSE per-process streaming, export/import. **Directory history import:** `DirectoryHistoryImporter` in `directory-history-importer.ts` scans a `repos/` directory for file-based process history, matches against registered workspaces, and imports into SQLite via `INSERT OR IGNORE` (additive, no server restart needed). Reuses `serializeProcessToRow`/`serializeTurnToRow` from `storage-migration.ts`. Admin routes: `POST /api/admin/storage/scan-directory`, `GET /api/admin/storage/import-directory-token`, `POST /api/admin/storage/import-directory` (SSE streaming). UI in `StorageSection.tsx` when backend is SQLite. **Startup auto-migration:** On startup, `migrateWorkspaceRegistryIfNeeded()` migrates workspace/wiki registries from JSON, then `migrateProcessHistoryIfNeeded()` migrates file-based process histories into SQLite. Both are idempotent, non-destructive (rename source to `.migrated`), and no-ops for file-based backends.

**Follow-up routing:** When a follow-up message arrives via `POST /api/processes/:id/message`, the handler routes based on task state: immediate + running tasks attempt steering via `bridge.steerProcess()`; running/queued tasks buffer into `pendingMessages` on the process; terminal tasks (failed/cancelled) enqueue a fresh task. The `ProcessLifecycleRunner` drains one pending message after each task completion via `onDrainPendingMessages`, chaining follow-ups server-side. The SPA client always sends follow-ups through `/message` — the server is the single authority for routing. The client does not call `/pending-messages` directly; queued follow-ups appear in the UI only after server confirmation via SSE `pending-message-added` events. `QueuedFollowUps` renders server-confirmed pending messages in a compact section separate from conversation bubbles.

**WebSocket upgrade dispatch:** `attachWebSocketUpgradeHandler(server, processWs, terminalWs?)` in `websocket.ts` routes upgrades by URL pathname: `/ws` → `ProcessWebSocketServer`, `/ws/terminal` → `TerminalWebSocketServer` (if provided), else `socket.destroy()`. Both WS servers expose a `handleUpgrade(req, socket, head)` method. `ProcessWebSocketServer.attach(server)` is a backward-compat shim that self-registers its own upgrade listener.

**Terminal layer:** `TerminalWebSocketServer` in `terminal/terminal-ws-server.ts` manages WebSocket connections at `/ws/terminal?workspaceId=X`. Each connection is workspace-scoped; clients send `terminal-create` messages to spawn PTY sessions, then `terminal-input`/`terminal-resize`/`terminal-close` to interact. Multiple sessions per connection are supported. PTY management is delegated to `TerminalSessionManager`. Instantiated only when `resolvedConfig.terminal.enabled` is true. Cleaned up via `closeAll()` during server shutdown.

**WSL repos:** Repo-root discovery accepts WSL UNC and Linux-style paths. Keep Windows-hosted trust/config/session storage, but route repo execution through the shared forge workspace-execution helpers rather than adding ad hoc `wsl.exe` spawning in server code. For Copilot SDK and interactive terminal launches on Windows, translate WSL repo roots to host UNC paths and run the Windows-hosted CLI instead of assuming `copilot` exists inside WSL.

**Module decomposition:** Large handler files are split into focused sub-modules with thin re-export aggregators for backward compatibility:
- `schedule-manager.ts` → cron utilities in `cron-utils.ts` (parseCron, nextCronTime, describeCron, slugifyName)
- `api-git-routes.ts` → aggregator delegating to `api-git-commit-routes`, `api-git-branch-range-routes`, `api-git-branch-routes`, `api-git-working-tree-routes`
- `task-comments-handler.ts` → manager in `task-comments-manager.ts`, AI helpers in `task-comments-ai.ts`, relocation in `task-comments-relocation.ts`, shared AI in `comments-ai-helpers.ts`
- `diff-comments-handler.ts` → manager in `diff-comments-manager.ts`, AI helpers in `diff-comments-ai.ts`
- `tasks-handler.ts` → `tasks-read-handler.ts`, `tasks-write-handler.ts`, `tasks-handler-utils.ts`
- `workflows-handler.ts` → `workflows-read-handler.ts`, `workflows-write-handler.ts`, `workflow-constants.ts`, `workflow-utils.ts`

**Storage layout — `~/.coc/` (top-level, global):**
- `config.yaml` — server configuration
- `processes.db` — SQLite process store (default backend; schema version 8); also stores queue tasks, schedule runs, per-process seen/unseen state (`seen_at` column), commit-chat bindings, per-process last-event timestamp (`last_event_at` column), pin state (`pinned_at` column), per-turn pin/archive/delete state (`conversation_turns.pinned_at`, `archived`, `deleted_at`), and FTS5 `conversation_search` index on `conversation_turns.content`
- `preferences.json` — global UI preferences (theme, etc.)
- `memory/` — system-level bounded memory (`memory/system/MEMORY.md`)
- `skills/` — global skill definitions

**Storage layout — `~/.coc/repos/<workspaceId>/` (per-repo):**
- `queues.json` — queue state
- `schedules.json` — schedule definitions
- `git-ops.json` — background git operations
- `preferences.json` — per-repo UI preferences
- `tasks/` — task and plan files
- `processes/` — legacy file-based process store (used only when `store.backend: file` in config)
- `outputs/` — AI conversation output markdown files (`<processId>.md`), managed by `OutputFileManager`
- `memory/` — per-repo bounded memory (`memory/MEMORY.md`); injected into all chat executors by default
- `paste-context/` — temp files for large pasted content externalized from chat prompts (auto-cleaned after task completion and on server startup)

Use `getRepoDataPath(dataDir, workspaceId, filename)` (exported from `packages/coc/src/server/`) as the canonical helper for building any per-repo file path. Do **not** construct these paths manually.

**Convention — repo-scoped data:** All runtime data that is specific to a single repository must live under `~/.coc/repos/<workspaceId>/`. Do **NOT** add new top-level directories under `~/.coc/` for per-repo data. Use `getRepoDataPath(dataDir, workspaceId, filename)` from `packages/coc/src/server/` to resolve the path.

**Convention — creating work items:** Work items are stored as JSON files in `~/.coc/repos/<workspaceId>/work-items/` (NOT as `.plan.md` files in `tasks/`). `.plan.md` files appear in the **Tasks tab**; work item JSON files appear in the **Work Items tab**. These are completely separate systems.
- **ALWAYS use the REST API** to create/update work items when the CoC server is running (default port 4000):
  ```
  POST http://localhost:4000/api/workspaces/<workspaceId>/work-items
  Body: { title, description, priority, tags, source }
  ```
- **Never write work-item JSON files directly** via file I/O — the server uses an atomic write-queue and direct writes will be silently overwritten on the next server-side write.
- The API also broadcasts a `work-item-added` WebSocket event so the dashboard UI updates immediately without a page refresh.

**Wiki layer:** `WikiManager` registry, `WikiData` in-memory store, `ContextBuilder` (RAG-style retrieval), `ConversationSessionManager` (multi-turn AI), `FileWatcher`, deep-wiki integration. Handler deduplication: `wiki-backend.ts` defines shared `ResolvedAskContext`/`ResolvedExploreContext`/`WikiProvider` interfaces; `handleAskCore()`/`handleExploreCore()` are the single-path implementations shared by both multi-wiki (native) and standalone handlers; `api-handlers.ts` directly creates context objects and delegates to core handlers; `standalone-admin-handlers.ts` and `standalone-config-loader.ts` handle deep-wiki-specific admin (seeds, config); generate handlers accept `WikiProvider` (satisfied by `WikiManager` or `createSingleWikiProvider()`).

**Onboarding layer:** `WelcomeModal` (first-launch modal), `FirstStepsCard` (guided checklist replacing empty repos state), `FeatureTip` (contextual dismissible tips). State in `GlobalPreferences` (`hasSeenWelcome`, `onboardingProgress`, `dismissedTips`), gated by `SHOW_WELCOME_TUTORIAL` compile-time flag.

**Memory layer:** `MemoryConfig` (`storageDir`, `backend`). REST API registered by `registerMemoryRoutes()`: `GET/PUT /api/memory/config`, explore-cache browsing routes (`GET /api/memory/explore-cache/levels`, `GET /api/memory/explore-cache/raw`, `GET /api/memory/explore-cache/raw/:filename`, `GET /api/memory/explore-cache/consolidated`, `GET /api/memory/explore-cache/consolidated/:id`). Bounded memory routes (`GET/PATCH/DELETE /api/memory/bounded/*`) serve per-repo and system `MEMORY.md` content. Per-repo memory CRUD at `/api/repos/:repoId/memory/*` via `repo-memory-handler.ts`. Dashboard UI: `MemoryView` → `MemoryConfigPanel` + bounded memory viewer.

**Seen-state layer:** `seen-state-handler.ts` (`registerSeenStateRoutes`) exposes per-process read/unread tracking via `GET/PATCH /api/workspaces/:id/seen-state`, `DELETE /api/workspaces/:id/seen-state/:processId`, `GET /api/workspaces/:id/seen-state/count`. Backed by `seen_at TEXT` column on `processes` table. Client hook `useUnseenActivity` loads from server on mount, uses optimistic local state + debounced fire-and-forget API calls. One-time localStorage migration from `coc-unseen-*` keys on first load.

**Turn actions layer:** `turn-actions-handler.ts` (`registerTurnActionRoutes`) exposes per-message delete, pin, and archive on conversation turns. Routes: `DELETE /api/processes/:id/turns/:turnIndex` (soft-delete), `PATCH .../restore`, `PATCH .../pin`, `PATCH .../archive`, `GET /api/processes/:id/turns/pinned`. Backed by `deleted_at TEXT`, `pinned_at TEXT`, `archived INTEGER` columns on `conversation_turns` table. SPA: `ConversationTurnBubble` context menu (Delete/Pin/Archive), `ProcessDetail` renders collapsible Pinned Messages section, archived toggle, undo-delete toast.

**SPA module layout (`packages/coc/src/server/spa/client/react/`):**
- `chat/` — Reusable conversation rendering: `ConversationTurnBubble`, `ConversationMiniMap`, `ConversationMetadataPopover`, tool call components (`ToolCallView`, `ToolCallGroupView`, `ToolResultPopover`, `WhisperCollapsedGroup`), `CommitStrip`, `NoteEditCard`, and utilities (`commitDetection`, `toolGroupUtils`, `timeline-utils`, `chatConversationUtils`). Barrel: `chat/index.ts`.
- `processes/` — Process-list/detail UI: `ProcessDetail`, `ProcessesView`, `ProcessesSidebar`, `ProcessFilters`, `QueueTaskSkeleton`, `WorkflowResultCard`, `MarkdownReviewDialog`, plus `dag/` sub-module for workflow DAG visualization.
- `shared/` — Feature-level shared components: `MarkdownView`, `MarkdownReviewEditor`, `RichTextInput`, `SourceEditor`, `FollowPromptDialog`, `ResolveContextDialog`, `FilePreview`, `NotificationBell`, `SkillDetailPanel`, etc. Barrel: `shared/index.ts`.
- `ui/` — Generic UI primitives: `Button`, `Card`, `Dialog`, `Spinner`, `Badge`, `Toast`, `cn`, `ImageGallery`, `FilePathLink`, `ContextWindowIndicator`, `JsonResponseView`, `json-utils`, etc. Barrel: `ui/index.ts`.
- `repos/` — Per-repo views: `ReposView`, `ReposGrid`. Consumes `features/` components directly.
- `tasks/` — Task/plan/comment management. Consumes `shared/MarkdownView`.

**Testing:** 627+ Vitest test files under `packages/coc/test/server/`.

## Memory System (`packages/forge/src/memory/`)

Bounded, file-backed persistence layer that lets AI chat sessions learn from past interactions. The AI writes `write_memory` tool calls (add/replace/remove), which are applied immediately to `MEMORY.md`; the frozen snapshot is injected into subsequent prompts. There is no batch-consolidation pipeline or raw-observations staging area.

**Storage layout:** `~/.coc/repos/<workspaceId>/memory/MEMORY.md` (per-repo), `~/.coc/memory/system/MEMORY.md` (global system). `MemoryLevel` = `'repo' | 'system' | 'git-remote' | 'both'`.

**Key symbols in `forge`:**

| Symbol | Role |
|--------|------|
| `MemoryStore` (interface) | Full CRUD contract |
| `BoundedMemoryStore` | File-backed store; add/replace/remove/setEntries with substring matching, char limits, `§` delimiters, mkdir-based file locking. `setEntries()` provides trusted atomic rewrite for reconciled output |
| `scanMemoryContent()` | Stateless security scanner for injection/exfiltration threats and invisible Unicode |
| `MemoryPromptBuilder` | Frozen snapshot prompt builder: reads `BoundedMemoryStore` at construction, renders immutable `═══`-separated block with usage header + `MEMORY_GUIDANCE` for system prompt injection |
| `createWriteMemoryTool()` | Factory returning an AI-callable `memory` tool + `getWrittenFacts()` accessor. Supports `bounded` mode (direct MEMORY.md mutation) and `capture` mode (raw record append to `RawMemoryRecordStore`, `replace`/`remove` disabled) |
| `RawMemoryRecordStore` | SQLite-backed append-only store for raw memory candidates; supports claim/release/complete batch lifecycle for aggregation. Per-scope DB at `~/.coc/repos/<workspaceId>/memory/raw-records.db` (repo) or `~/.coc/memory/system/raw-records.db` (system) |
| `prepareReconciliationContext()` | Deterministic pre-processing: dedup raw records, stable-sort, build content→recordId map for post-AI tracking |
| `validateProposedEntries()` | Validates AI-proposed bounded entry list: type/empty/duplicate/security/char-limit checks |
| `buildApplyPlan()` | Maps validated entries back to raw record IDs, classifying each as aggregated or dropped |
| `applyReconciliation()` | Atomically rewrites MEMORY.md via `BoundedMemoryStore.setEntries()` |

**Tool Call Cache** (secondary subsystem in same folder): `ToolCallCapture`, `FileToolCallCacheStore`, `ToolCallCacheAggregator`, `ToolCallCacheRetriever`, `withToolCallCache()` — caches AI tool call Q&A pairs for replay/reuse across runs.

**Bounded Memory Addon** (CoC server integration in `packages/coc/src/server/executors/bounded-memory-addon.ts`): `buildBoundedMemoryAddon()` creates a per-request `BoundedMemoryStore` (file-backed at `~/.coc/repos/<workspaceId>/memory/MEMORY.md`), a `MemoryPromptBuilder` snapshot for system prompt injection, and an AI-callable `memory` tool via `createMemoryTool()`. Also wires system-level memory at `~/.coc/memory/system/MEMORY.md`. Gated by `PerRepoPreferences.boundedMemory.enabled` (opt-in per repo, default false). Accepts optional `captureContext` parameter to switch the tool to capture mode, where `add` appends raw records to `RawMemoryRecordStore` (at `memory/raw-memory.db`) instead of mutating `MEMORY.md` directly. Prompt injection always reads only bounded `MEMORY.md` regardless of mode. `appendBoundedMemoryContext()` in `prompt-builder.ts` appends the frozen memory block to chat system messages. All 6 chat executors (chat, autopilot, plan, follow-up, commit-chat, note-chat) wire the addon.

**LLM Tool Preferences** (per-repo tool enable/disable): `llm-tools/llm-tool-registry.ts` defines `LLM_TOOL_REGISTRY` — the canonical list of user-toggleable AI tools with metadata (`name`, `label`, `description`, `enabledByDefault`). Registry-level defaults disable `tavily_web_search`; effective defaults are mode-aware via `getEffectiveDefaultDisabledTools(uiLayoutMode)`, which also disables `create_work_item` and `create_bug` in classic mode. Explicit `PerRepoPreferences.disabledLlmTools` values override mode-aware defaults, including an empty array to enable every tool. `readEffectiveDisabledLlmTools(dataDir, workspaceId)` is the server-side helper for executor defaults. `applyLlmToolPreferences()` in `prompt-builder.ts` filters assembled tools + suffixes by the disabled list. API: `GET/PUT /api/workspaces/:id/llm-tools-config`. SPA: `LlmToolsPanel` in Repo Settings → LLM Tools tab.

## Development Notes

- TypeScript, webpack bundling, VS Code API ≥ 1.95.0, Node.js ≥ 24
- Format on save and import organization enabled
- Tree data providers: extend `BaseTreeDataProvider` or `FilterableTreeDataProvider`
- Commands registered centrally in `src/shortcuts/commands.ts`
- Cross-platform: Linux, macOS, Windows
