# CoC (Copilot of Copilot)

Standalone Node.js CLI for executing YAML-based AI workflows outside VS Code. Depends on the published `@plusplusoneplusplus/forge` package (`^1.0.0`) as a runtime dependency. Published to npm as `@plusplusoneplusplus/coc` (public access). Requires Node.js >= 24. The dashboard SPA consumes `@plusplusoneplusplus/coc-client` for shared REST transport, typed admin, repo detail, explorer, queue, task/file preview, notes, notes-git, git, preferences, work items, workflow, wiki, memory, pull-request, schedule, seen-state, models, skills calls, and process WebSocket lifecycle while preserving local React hook APIs (`fetchApi`, `useWebSocket`, `seenStateApi`).

## Build & Test

```bash
npm run build        # Compile TypeScript
npm run test:run     # Run tests (Vitest)
```

Git commit file clicks in the repo dashboard use `RepoGitTab` split-view routing: full commits render `CommitDetail` diffs, while single commit files render `CommitFileContent` with full-file markdown/source content in the right panel.
Repo Settings → Memory exposes a per-repo **Enable Memory for this Repo** switch backed by `boundedMemory.enabled` in `/api/workspaces/:id/preferences`; disabling it preserves `MEMORY.md` content but stops future bounded-memory injection and candidate capture. The same settings view includes a confirmed **Wipe Memory** action backed by `DELETE /api/repos/:repoId/memory`, which deletes the repo `MEMORY.md`, clears `memory/raw-memory.db` candidates, and removes `memory/recall-index.db`.
Capture-mode memory writes upsert durable candidate rows in the repo/system memory database; duplicate normalized facts strengthen the same candidate via signal counts, provenance, explicit memory intent, and scores derived from write frequency or explicit user intent. Promotion runs through the manual repo memory API/UI action, explicit `memory-promote` queue tasks, or opt-in per-repo auto-promotion. Auto-promotion is disabled unless both `features.autoMemoryPromotion` and `boundedMemory.autoPromote.mode` are enabled; threshold mode enqueues one low-priority repo `memory-promote` task when pending candidates reach the configured count, and cron modes register a deterministic managed schedule under the existing schedule manager. Auto runs use gated ranking defaults (`minScore` 0.75, `minRecallCount` 3, `minUniqueQueries` 2), dedupe queued/running promotion tasks, respect per-repo isolation, and record status in `memory/auto-promote-state.json`. `memory-promote` queue tasks acquire `memory/promote.lock`, rank pending candidates deterministically with forge's candidate-ranking policy, optionally run disabled-by-default AI normalization over selected candidate groups only, append selected clean fact text without rewriting `MEMORY.md`, use normalized content hashes to skip already covered facts, and finalize each candidate ID independently as promoted, dropped, ignored, or still pending. Direct bounded memory tool/admin actions remain the explicit mutation paths for manual `MEMORY.md` edits.
Admin → Settings → Appearance & Navigation exposes global display preferences backed by `/api/preferences`, including inline HTML previews (`htmlEmbed.enabled`) and inline ghost-text autocomplete (`promptAutocomplete.enabled`, with AI generation enabled by default via `promptAutocomplete.ai.enabled` and a configurable `promptAutocomplete.ai.model` — see `docs/wiki/prompt-autocomplete.md`). The dashboard top bar uses a fixed code-defined utility icon order. The repo Workflows tab and the New Schedule form's workflow action are gated by `workflows.enabled`. When inline HTML previews are enabled, local `.html`/`.htm` markdown references in chat using image syntax `![alt](page.html)` render as sandboxed iframe previews through `/api/workspaces/:id/files/html` (link syntax stays a plain anchor). Default HTML embed height is 600px, persisted per file via localStorage on user resize. Notes render allowlisted Google Maps links (`https://www.google.com/maps/embed?...`, `https://maps.google.com/maps?...`) as inline map iframes in both read mode and rich edit mode; `maps.app.goo.gl` share links remain plain anchors. Map embed height defaults to 400px and is persisted per URL via localStorage on user resize.
Repo Settings → Notes exposes normal repository notes git auto-commit controls only. Virtual workspaces (`my_work`, `my_life`) omit the Notes settings sidebar item and route Notes settings deep links to Info. My Work startup seeds scoped bundled skills into `~/.coc/repos/my_work/.github/skills/` without modifying global skills or overwriting existing local skill directories.
Repo Settings → LLM Tools exposes per-repo enable/disable toggles for AI chat tools backed by `disabledLlmTools` in `/api/workspaces/:id/preferences`. Dedicated API: `GET/PUT /api/workspaces/:id/llm-tools-config`. Tool defaults are mode-aware: `tavily_web_search` is disabled at the registry level, and classic mode also disables `create_work_item` and `create_bug` unless the repo has an explicit disabled-tools preference. Tool registry lives in `llm-tools/llm-tool-registry.ts`; common ask/plan/autopilot/follow-up chat tool bundle assembly lives in `executors/chat-tool-builder.ts`.
Server startup warms forge's `modelMetadataStore` before listening so chat executors can resolve model-specific reasoning effort from live metadata before accepting queue work. Chat and follow-up executors also initialize model metadata on demand if a model-specific task starts before metadata is cached. Variant models with a `capabilities.family` base are preserved in process metadata but sent to the SDK as the base model plus the resolved reasoning effort.
Dashboard Usage shows token breakdowns by day/model. Per-model cells show tokens only; Total cells add estimated token-cost USD from forge pricing helpers and display SDK multiplier accounting as `Premium units` without dollar formatting.

## Usage

```bash
# Run from project root
node packages/coc/dist/index.js <command>

# Or link globally
cd packages/coc && npm link
coc <command>
```

## Commands

```bash
coc run <path>              # Execute a workflow
coc validate <path>         # Validate YAML without executing
coc list [dir]              # List workflow packages in a directory
coc serve                   # Start AI Execution Dashboard web server
coc skills                  # Manage CoC skills (list, install-bundled, install, delete, check-updates)
coc wipe-data               # Clear all stored data
```

### `run` Options

| Flag | Description |
|------|-------------|
| `-m, --model <model>` | Override AI model |
| `-p, --parallel <n>` | Parallelism limit |
| `-o, --output <fmt>` | Output format: `table`, `json`, `csv`, `markdown` |
| `-f, --output-file <path>` | Write results to file |
| `-w, --workspace-root <path>` | Workspace root for skill resolution |
| `--param key=value` | Workflow parameters (repeatable) |
| `--dry-run` | Validate only, skip execution |
| `--approve-permissions` | Auto-approve AI permission requests |
| `-v, --verbose` | Per-item progress output |
| `--timeout <seconds>` | Execution timeout |
| `--no-color` | Disable colored output |

### `validate` Options

| Flag | Description |
|------|-------------|
| `--no-color` | Disable colored output |

### `list` Options

| Flag | Description |
|------|-------------|
| `-o, --output <fmt>` | Output format: `table`, `json`, `csv`, `markdown` |
| `--no-color` | Disable colored output |

### `serve` Options

| Flag | Description |
|------|-------------|
| `-p, --port <number>` | Port number (default: 4000) |
| `-H, --host <string>` | Bind address (default: localhost) |
| `-d, --data-dir <path>` | Data directory for process storage (default: ~/.coc) |
| `--no-open` | Don't auto-open browser |
| `--theme <theme>` | UI theme: `auto`, `light`, `dark` |
| `--no-color` | Disable colored output |

## Architecture

The `src/server/` tree is grouped by feature domain. Cross-cutting plumbing
(`index.ts`, `router.ts`, `types.ts`, `paths.ts`, `errors.ts`,
`preferences-handler.ts`) stays at the root. Everything else lives in a
focused subfolder.

```
src/
├── index.ts              # Entry point (bin) - Parses CLI args and routes to commands
├── cli.ts                # Commander program setup - Defines commands, flags, and option parsing
├── commands/
│   ├── run.ts            # Execute workflow - Handles execution, progress, and result formatting
│   ├── validate.ts       # Validate YAML - Checks structure, input sources, and filter config
│   ├── list.ts           # List packages - Discovers and displays workflow packages in a directory
│   ├── serve.ts          # Start server - Launches AI Execution Dashboard with browser auto-open
│   ├── wipe-data.ts      # Wipe data - Clears stored processes, queues, and schedules
│   ├── skills.ts         # Skills management - list, install-bundled, install, delete subcommands
│   └── options-resolver.ts  # Shared option resolution logic for commands
├── server/
│   ├── index.ts                      # Server factory — createExecutionServer(); orchestrates infra + route registration
│   ├── router.ts                     # HTTP route table + dispatcher
│   ├── types.ts                      # Cross-cutting Route/Match types
│   ├── paths.ts                      # getRepoDataPath() — canonical per-repo path helper
│   ├── errors.ts                     # AppError + sendError helpers
│   ├── preferences-handler.ts        # Global + per-repo preference REST API (single large surface; not split)
│   ├── core/                         # Cross-cutting plumbing used by every layer
│   │   ├── api-handler.ts            # sendJSON helpers + low-level routing primitives
│   │   ├── attachment-utils.ts       # Image/file attachment helpers for chat payloads
│   │   ├── image-utils.ts            # PNG/JPEG sniffing, resizing, dataURL helpers
│   │   ├── hostname-utils.ts         # Cross-platform hostname helpers
│   │   └── build-info.ts             # Auto-generated build metadata (BUILD_COMMIT, BUILD_VERSION) — gitignored
│   ├── streaming/                    # Real-time transport
│   │   ├── websocket.ts              # ProcessWebSocketServer + attachWebSocketUpgradeHandler
│   │   └── sse-handler.ts            # Per-process Server-Sent Events streaming
│   ├── logging/                      # Server logger and log routes
│   │   ├── server-logger.ts          # pino-backed logger
│   │   ├── server-log-capture.ts     # In-memory ring buffer for /api/logs
│   │   └── logs-routes.ts            # GET /api/logs and download endpoints
│   ├── admin/                        # Admin diagnostics
│   │   ├── admin-handler.ts          # /api/admin/* surface (config, system prompts, providers)
│   │   ├── db-browser-handler.ts     # SQLite browser endpoints (read-only)
│   │   ├── heap-monitor.ts           # Periodic V8 heap monitoring
│   │   └── stats-handler.ts          # Token usage + cost stats
│   ├── workspaces/                   # Workspace bootstrappers + virtual workspaces
│   │   ├── global-workspace.ts       # GLOBAL_WORKSPACE_ID — ~/.coc/global-workspace/
│   │   ├── my-work-workspace.ts      # MY_WORK_WORKSPACE_ID — ~/.coc/repos/my_work/
│   │   ├── my-work-handler.ts        # My Work REST API
│   │   ├── my-life-workspace.ts      # MY_LIFE_WORKSPACE_ID — ~/.coc/repos/my_life/
│   │   ├── my-life-handler.ts        # My Life REST API
│   │   └── workspace-summary-handler.ts  # Aggregated workspace summary endpoint
│   ├── processes/                    # Process lifecycle (excluding execution loop)
│   │   ├── in-memory-process-store.ts    # In-memory store for tests + dev
│   │   ├── output-file-manager.ts        # Manages ~/.coc/repos/<id>/outputs/<processId>.md
│   │   ├── output-pruner.ts              # Periodic prune of stale outputs
│   │   ├── stale-task-detector.ts        # Flags processes whose tasks died
│   │   ├── pin-archive-handler.ts        # PATCH/POST /api/processes/.../pin|archive
│   │   ├── seen-state-handler.ts         # GET/PATCH /api/workspaces/:id/seen-state
│   │   ├── turn-actions-handler.ts       # Per-turn delete/pin/archive on conversation_turns
│   │   ├── process-history-handler.ts    # Conversation history listing & detail
│   │   ├── process-resume-handler.ts     # Resume interrupted processes
│   │   └── commit-chat-binding-store.ts  # SQLite store: commitHash → taskId
│   ├── queue/                        # Queue layer (handler, timed queue/autopilot pause persistence, bridges, blob store, partitioner)
│   │   ├── queue-handler.ts                # /api/queue/* CRUD + validation, pause/resume state
│   │   ├── queue-executor-bridge.ts        # Bridges queue tasks to AI/workflow/script executors
│   │   ├── multi-repo-queue-router.ts      # Routes queue operations across per-repo queues + repoId↔rootPath maps
│   │   ├── image-blob-store.ts             # Externalizes base64 images from persistence to JSON
│   │   ├── queue-partitioner.ts            # Per-repo queue partitioning rules
│   │   └── shared/                         # Queue shared utilities (queue-utils, process-history-mapper, ...)
│   ├── schedule/                     # Scheduled execution
│   │   ├── cron-utils.ts                       # parseCron, nextCronTime, describeCron, slugifyName
│   │   ├── schedule-handler.ts                 # Schedule REST API
│   │   ├── schedule-manager.ts                 # In-memory schedule registry + tick loop
│   │   ├── schedule-run-persistence.ts         # Run-history persistence interface
│   │   ├── sqlite-schedule-run-persistence.ts  # SQLite implementation
│   │   ├── schedule-yaml-persistence.ts        # YAML import/export of schedule definitions
│   │   ├── repo-schedule-loader.ts             # Load per-repo schedule overrides
│   │   └── repo-schedule-overrides.ts          # Override resolution logic
│   ├── tasks/                        # Tasks + comments domain
│   │   ├── task-types.ts                # ChatPayload, TaskDefs, type guards
│   │   ├── task-cache.ts                # In-memory cache for parsed tasks
│   │   ├── task-watcher.ts              # File watcher for task changes
│   │   ├── task-migration.ts            # Migration from legacy .vscode/tasks/ location
│   │   ├── task-root-resolver.ts        # Resolves task root from workspaceId
│   │   ├── task-generation-handler.ts   # AI-powered task generation
│   │   ├── tasks-handler.ts             # Aggregator (re-exports read+write)
│   │   ├── tasks-read-handler.ts        # Read-only task endpoints
│   │   ├── tasks-write-handler.ts       # Mutating task endpoints
│   │   ├── tasks-handler-utils.ts       # Shared validation + helpers
│   │   └── comments/                     # Task + diff comment handlers (live together because they share base classes)
│   │       ├── base-comments-manager.ts            # Common manager for sidecar JSON comments
│   │       ├── comments-ai-helpers.ts              # Shared AI prompt/response utilities
│   │       ├── task-comments-handler.ts            # /api/workspaces/:id/tasks/.../comments
│   │       ├── task-comments-manager.ts            # File-backed manager
│   │       ├── task-comments-relocation.ts         # Reanchor comments after edits
│   │       ├── task-comments-ai.ts                 # AI prompts for task comments
│   │       ├── diff-comments-handler.ts            # /api/workspaces/:id/diff-comments
│   │       ├── diff-comments-manager.ts            # File-backed manager
│   │       └── diff-comments-ai.ts                 # AI prompts for diff comments
│   ├── notes/                        # Notes feature (read/write/comments/AI/files)
│   │   ├── notes-handler.ts             # Aggregator that registers all notes routes
│   │   ├── notes-constants.ts           # SYSTEM_FOLDER_NAMES and related
│   │   ├── notes-watcher.ts             # Debounced .md file watcher
│   │   ├── notes-read-handler.ts        # Tree/content/search read endpoints
│   │   ├── notes-write-handler.ts       # Create/update/delete + .order.json
│   │   ├── notes-order.ts               # .order.json helpers
│   │   ├── notes-edits-handler.ts       # Note edit snapshot endpoints
│   │   ├── notes-file-preview-handler.ts # Inline file preview from notes
│   │   ├── notes-image-handler.ts       # Note image upload/serve
│   │   ├── notes-ai-handler.ts          # AI tool: create new notes
│   │   ├── notes-comments-handler.ts    # Per-note comment routes
│   │   ├── notes-comments-manager.ts    # Sidecar storage (lives alongside)
│   │   ├── notes-comments-ai.ts         # Batch resolve prompt for AI
│   │   ├── notes-comments-types.ts      # Sidecar/comment thread types
│   │   └── git/                          # Notes-specific git tracking
│   │       ├── notes-git-types.ts                  # NotesGitConfig + status/log/diff types
│   │       ├── notes-git-service.ts                # Standalone git ops on ~/.coc/repos/<id>/notes/
│   │       ├── notes-git-handler.ts                # REST routes (init/status/log/diff/commit)
│   │       ├── notes-git-autocommit.ts             # PS1/Bash auto-commit script + schedule helpers
│   │       ├── notes-git-autocommit-handler.ts     # REST routes (enable/disable/update/status)
│   │       └── notes-git-timer-manager.ts          # In-process auto-commit timer manager
│   ├── workflows/                    # Workflow definitions
│   │   ├── workflow-constants.ts         # Constants (workflow folder names, etc.)
│   │   ├── workflow-utils.ts             # Path/spec helpers
│   │   ├── workflow-watcher.ts           # File watcher
│   │   ├── workflows-handler.ts          # Aggregator (read+write)
│   │   ├── workflows-read-handler.ts     # List/read endpoints
│   │   └── workflows-write-handler.ts    # Mutating endpoints
│   ├── templates/                    # Template + replicate
│   │   ├── template-watcher.ts           # Watches .vscode/templates/
│   │   ├── templates-handler.ts          # Template CRUD API
│   │   └── replicate-apply-handler.ts    # Applies ReplicateResult changes to disk
│   ├── skills/                       # Skill + per-repo instructions REST
│   │   ├── skill-handler.ts              # /api/workspaces/:id/skills/*
│   │   ├── skill-route-handlers.ts       # Sub-route helpers
│   │   ├── global-skill-handler.ts       # Global skills management
│   │   └── instruction-handler.ts        # /api/workspaces/:id/instructions (per-mode .github/coc/instructions*.md)
│   ├── prompts/                      # Prompt management
│   │   ├── prompt-handler.ts             # Prompt CRUD API
│   │   └── prompt-utils.ts               # Variable rendering and lookup helpers
│   ├── servers/                      # Remote CoC server registry + DevTunnel connector
│   │   ├── remote-server-types.ts        # Discriminated URL/DevTunnel server contracts and runtime health shapes
│   │   ├── remote-server-store.ts        # Global ~/.coc/remote-servers.json persistence and validation
│   │   ├── devtunnel-port-parser.ts      # Parses devtunnel port list output and enforces one HTTP port
│   │   ├── devtunnel-connector.ts        # Managed devtunnel connect lifecycle, deduplication, readiness polling, cleanup
│   │   ├── remote-server-health.ts       # Common health probing for direct and tunnel-backed endpoints
│   │   └── remote-server-routes.ts       # /api/servers CRUD, test, health, connection, connect/disconnect routes
│   ├── git/                          # Git utilities (cache + repo path helpers)
│   │   ├── git-cache.ts                  # Cache for git diff/log queries
│   │   ├── git-info-cache.ts             # Cached git status/branch info
│   │   └── repo-utils.ts                 # extractRepoId, findGitRoot, normalizeRepoPath
│   ├── storage/                      # Persistence migrations + import/export
│   │   ├── storage-migration.ts                  # Process file → SQLite migration helpers + serializers
│   │   ├── startup-process-migration.ts          # Auto-migrate at server startup (idempotent)
│   │   ├── startup-workspace-migration.ts        # Workspace registry JSON → SQLite
│   │   ├── directory-history-importer.ts         # Import file-based history from a directory tree
│   │   ├── data-exporter.ts                      # Export everything to a tarball
│   │   ├── data-importer.ts                      # Import a previously exported tarball
│   │   ├── data-wiper.ts                         # Wipe stored data
│   │   └── export-import-types.ts                # Shared types for the above
│   ├── llm-tools/                    # AI tool factories for chat executors
│   │   ├── index.ts                          # Barrel re-exports
│   │   ├── add-diff-comment-tool.ts          # Per-invocation add_diff_comment tool (commit chat)
│   │   ├── ask-user-tool.ts                  # ask_user tool
│   │   ├── create-bug-tool.ts                # create_bug tool (queues a bug work item)
│   │   ├── create-work-item-tool.ts          # create_work_item tool
│   │   ├── update-work-item-tool.ts          # update_work_item tool
│   │   ├── diff-line-mapper.ts               # Unified diff parser + source-line ↔ diff-index mapper
│   │   ├── get-conversation-tool.ts          # Conversation lookup tool
│   │   ├── llm-tool-registry.ts              # LLM_TOOL_REGISTRY — canonical user-toggleable tool list
│   │   ├── resolve-comment-tool.ts           # resolve_comment tool
│   │   ├── search-conversations-tool.ts      # FTS5 keyword search + recent listing
│   │   ├── suggest-follow-ups-tool.ts        # suggest_follow_ups tool
│   │   └── tavily-web-search-tool.ts         # Tavily web search tool
│   ├── executors/                    # AI chat execution layer (process lifecycle, prompt building)
│   │   ├── base-executor.ts          # Abstract base: streaming, throttling, tool-event capture, system-prompt/output persistence
│   │   ├── chat-base-executor.ts     # Abstract chat executor: AI call lifecycle, shared memory/auto-folder/options helpers, metadata-aware reasoning-effort selection
│   │   ├── chat-executor.ts          # Ask-mode executor (interactive)
│   │   ├── plan-executor.ts          # Plan-mode executor
│   │   ├── autopilot-executor.ts     # Autopilot-mode executor
│   │   ├── follow-up-executor.ts     # Follow-up message executor using shared chat-mode lifecycle helpers and metadata-aware reasoning-effort selection
│   │   ├── note-chat-executor.ts     # Note chat executor
│   │   ├── note-create-executor.ts   # Note create executor
│   │   ├── commit-chat-executor.ts   # Commit chat executor
│   │   ├── resolve-comments-executor.ts # Server-side comment resolution executor
│   │   ├── workflow-executor.ts      # Workflow execution executor
│   │   ├── shell-executor.ts         # Shell script executor
│   │   ├── task-generation-executor.ts # Task-generation executor
│   │   ├── wrapped-task-executor.ts  # Wrapper that gates execution behind preferences
│   │   ├── process-lifecycle-runner.ts # Full process lifecycle orchestration + pending-message draining
│   │   ├── prompt-builder.ts         # System message, memory context, repo instructions, skill injection
│   │   ├── chat-tool-builder.ts      # Shared common chat tool bundle assembly + LLM tool preference filtering
│   │   ├── system-message-builder.ts # System message assembly
│   │   ├── executor-registry.ts      # Executor instance registry
│   │   ├── bounded-memory-addon.ts   # Wires bounded MEMORY.md into chat executors
│   │   └── ...                       # Other helpers (skill-config-resolver, title-generator, etc.)
│   ├── infrastructure/               # Server bootstrap layer (composition root)
│   │   ├── websocket-infrastructure.ts   # Builds + attaches ProcessWebSocketServer
│   │   ├── terminal-infrastructure.ts    # Builds TerminalWebSocketServer (when enabled)
│   │   ├── watcher-infrastructure.ts     # Builds task/workflow/notes/template watchers
│   │   └── ...                           # Other infra factories used by index.ts
│   ├── routes/                       # Centralised route registration
│   │   └── index.ts                      # registerAllRoutes(): wires every handler into router
│   ├── providers/                    # Provider abstraction for AI/PRs/etc.
│   ├── repos/                        # Repository management endpoints
│   ├── shared/                       # Cross-handler helpers (handler-utils, router helpers)
│   ├── task-strategies/              # Task strategy plug-ins (replicate-template, run-script, …)
│   ├── work-items/                   # Work-items REST + executors
│   ├── wiki/                         # Wiki integration
│   │   ├── wiki-manager.ts                  # Lifecycle management
│   │   ├── wiki-data.ts                     # Data access layer
│   │   ├── wiki-routes.ts                   # HTTP routes
│   │   ├── generate-handler.ts              # Generation API
│   │   ├── explore-handler.ts               # Exploration API
│   │   ├── ask-handler.ts                   # Q&A endpoint
│   │   ├── context-builder.ts               # RAG-style retrieval
│   │   ├── conversation-session-manager.ts  # Multi-turn chat sessions
│   │   ├── file-watcher.ts                  # Watches wiki source files
│   │   └── admin-handlers.ts                # Wiki admin endpoints
│   ├── terminal/                     # WebSocket-based terminal (PTY layer)
│   │   ├── types.ts                          # IPty, TerminalSession, TerminalClientMessage, TerminalServerMessage
│   │   ├── terminal-session-manager.ts       # PTY lifecycle (create, resize, destroy, idle cleanup; WSL roots launch bash via wsl.exe on Windows)
│   │   ├── terminal-routes.ts                # REST session listing, destroy, and pin state endpoints
│   │   └── terminal-ws-server.ts             # /ws/terminal — per-workspace create/attach, multi-session
│   ├── memory/                       # Memory configuration + bounded-memory REST API
│   │   ├── memory-config-handler.ts          # readMemoryConfig, writeMemoryConfig
│   │   ├── memory-routes.ts                  # Global memory REST endpoints
│   │   ├── bounded-memory-routes.ts          # Global bounded memory REST (/api/memory/bounded/*)
│   │   ├── repo-memory-handler.ts            # Per-repo MEMORY.md REST (/api/repos/:repoId/memory/*)
│   │   ├── background-review.ts              # Periodic AI memory review
│   │   ├── background-review-executor.ts     # Executor for background review tasks
│   │   ├── memory-promote.ts                 # Config for candidate promotion
│   │   ├── memory-promote-executor.ts        # Queued executor: candidate promotion with optional normalization, no MEMORY.md rewrite
│   │   └── pre-compression-flush.ts          # Flush memory before compression
│   ├── models/                       # Model registry endpoints
│   └── spa/                          # Dashboard SPA
│       ├── html-template.ts  # HTML generation - Generates full HTML with inline bundled assets from client/dist/
│       ├── index.ts          # Module exports - generateDashboardHtml + DashboardOptions
│       ├── helpers.ts        # Template helpers
│       ├── types.ts          # Dashboard option types
│       └── client/           # React SPA client
│           ├── entry.tsx         # SPA entry point (mounts App/PopOut shells)
│           ├── comments/         # Comment type definitions and utilities (comment-constants, diff-comment-*, task-comments-types, shared-comment-types)
│           ├── diff/             # Diff rendering primitives (diff-utils, markdown-renderer)
│           └── react/
│               ├── App.tsx              # Root React component
│               ├── admin/               # Admin panel & preferences UI
│               ├── chat/                # Chat conversation utilities
│               ├── components/          # Shared UI components (e.g., ContextWindowIndicator)
│               ├── contexts/            # React contexts (App, Queue, Task, Toast, FloatingChats, etc.)
│               ├── hooks/               # 30+ custom hooks (useApi, useWebSocket, useMarkdownPreview, useDiffComments, etc.)
│               ├── layout/              # Layout components (Router, TopBar, BottomNav, ThemeProvider)
│               ├── features/chat/       # Chat conversation UI: ChatDetail/ChatListPane, FollowUpInputArea + NewChatArea use a compact stacked layout. The input card holds the editor and a single mobile-responsive (`flex-wrap`) toolbar containing — in this order — the ModePillSelector (pills with dot colors that match `MODE_BORDER_COLORS`: ask=yellow, plan=blue, autopilot=green), the model picker chip (single source of truth for the active model — shows session model or override and an inline ✕ to clear; no separate override badge), slash/attach buttons, and the QueueFollowUpButton (with `sm:`-gated ⌘↵ shortcut hint). Compact density: outer `py-2`, stack `space-y-1`, RichTextInput `min-h-[28px]`, toolbar `py-1` with `h-6` buttons, QueueFollowUpButton `h-7 px-2 text-xs`. Legacy single-row layout is preserved when `compactModeSelector` is true (e.g., narrow side panels). SlashCommandMenu renders as a card popover with a header and `↵` indicator on the highlighted row.
│               ├── features/notes/      # Notes UI; NoteEditor Run Skill is available for any notePath and dispatches normalized contextFiles/contextTaskName. Notes sidebar update indicators compare tree node lastModifiedAt against localStorage key `coc-notes-seen-<workspaceId>`.
│               ├── features/pull-requests/ # Pull request dashboard: attention groups, row selection, detail view, and BatchCommandPanel queueing `pr-batch` chat tasks from selected PRs
│               ├── features/terminal/   # Terminal UI; TerminalView hydrates pinned server sessions through /api/workspaces/:id/terminals, sends tab pin/unpin through PATCH /api/workspaces/:id/terminals/:sessionId/pin, and restored tabs attach to existing PTYs
│               ├── processes/           # Process detail views, conversation bubbles, tool call rendering
│               │   └── dag/             # Workflow DAG visualization (25+ components)
│               ├── queue/               # Queue management UI (EnqueueDialog, QueueView)
│               ├── repos/               # Repository management: ReposView, ReposGrid; imports from features/ directly
│               │   ├── slash-command-parser.ts  # Parses `/skill` and `/model` (meta-command) tokens from chat input
│               │   ├── ModelCommandMenu.tsx      # Model picker dropdown for the `/model` meta-command
│               │   ├── useModelCommand.ts        # Hook managing model picker state and modelOverride
│               │   └── explorer/        # File explorer with Monaco Editor
│               ├── shared/              # Feature-level shared components (MarkdownReviewEditor, SourceEditor, RichTextInput, MarkdownView, etc.)
│               │   └── file-path/       # File path hover preview (delegated tooltip for .file-path-link spans)
│               ├── ui/                  # UI primitives (Button, Card, Dialog, Spinner, Badge, Toast, cn, etc.)
│               ├── tasks/               # Task management UI (TaskTree, TaskPreview, TaskActions)
│               │   └── comments/        # Inline comment system (CommentCard, CommentSidebar, SelectionToolbar)
│               ├── types/               # TypeScript type definitions
│               ├── utils/               # Utility modules (config, format, path-resolution)
│               ├── welcome/             # Onboarding system (WelcomeModal, FirstStepsCard, FeatureTip, tips registry)
│               ├── featureFlags.ts      # Compile-time feature flags (SHOW_WELCOME_TUTORIAL)
│               └── wiki/                # Wiki UI (WikiView, WikiAsk, WikiGraph, WikiComponentTree, etc.)
├── ai-invoker.ts         # AI invoker factory - Creates CopilotSDKService instances with session pooling
├── logger.ts             # Console logger - Colored output, spinners, and progress bars
├── output-formatter.ts   # Result formatting - Formats results as table/json/csv/markdown
├── config.ts             # Config resolution - Loads and merges ~/.coc/config.yaml with defaults (legacy fallback: ~/.coc.yaml)
├── config/
│   └── schema.ts         # Configuration JSON schema for validation
├── validation/
│   ├── index.ts          # Validation module exports
│   └── schemas.ts        # Pipeline YAML validation schemas
```

## Markdown Review & Preview

**MarkdownReviewEditor** (`src/server/spa/client/react/shared/MarkdownReviewEditor.tsx`) — shared React component used in task preview and process conversation dialogs. Props: `wsId`, `filePath`, `fetchMode` (`'tasks'|'auto'`), `showAiButtons`, `showRichMode`, `initialViewMode` (`'review'|'source'`).

- **Review mode**: `renderMarkdownToHtml()` → highlight.js + Mermaid diagrams + code-block actions (via `useMarkdownPreview` hook)
- **Source mode**: `renderSourceModeToHtml()` with `SourceEditor` (Ctrl+S save, dirty-state `●` indicator)
- **Rich mode** (opt-in via `showRichMode`): Tiptap WYSIWYG via `RichEditorCore`, markdown↔html round-trip through `noteMarkdown.ts` helpers, Google Maps embed node views from allowlisted link placeholders, Ctrl+S save, dirty-state tracking. Comments disabled in first pass.
- Non-markdown files auto-wrapped in fenced code blocks before rendering
- Inline comment system: `useCommentAnchors` + `useCommentInteractions` for text-selection-based annotations

**useMarkdownPreview** hook (`markdown-preview.tsx`) — shared rendering pipeline used by MarkdownReviewEditor, TaskPreview, FilePreview, and conversation bubbles. Delegates to `forge`'s markdown parsing (code blocks, tables, mermaid) and rendering functions.

**Monaco Editor** (`repos/explorer/MonacoFileEditor.tsx`) — used in the repository explorer's PreviewPane for file viewing/editing with syntax highlighting and theme sync.

## Configuration

Configuration file: `~/.coc/config.yaml` (legacy fallback: `~/.coc.yaml`)

```yaml
# Default AI model
model: gpt-4

# Default parallelism limit
parallel: 5

# Default output format
output: table  # Options: table, json, csv, markdown

# Auto-approve AI permission requests
approvePermissions: false

# Path to MCP config file
mcpConfig: ~/.copilot/mcp-config.json

# Default timeout in seconds
timeout: 1800

# Serve command defaults
serve:
  port: 4000
  host: localhost
  dataDir: ~/.coc
  theme: auto

# Heap monitoring (enabled by default)
monitoring:
  heapCheck:
    enabled: true
    intervalMs: 30000
    warnThreshold: 70
    criticalThreshold: 85

# Skills configuration
skills:
  autoUpdate: true           # Auto-update stale global skills on serve startup (default: true)
```

**Configuration Precedence:** CLI flags > config file > defaults

**Welcome/Onboarding preferences (in `GlobalPreferences`):**
- `hasSeenWelcome?: boolean` — tracks whether the welcome modal has been dismissed
- `onboardingProgress?: { hasRunWorkflow, hasOpenedWiki, hasUsedChat, settingsVisited, dismissed, hasCompletedTour }` — welcome tour and first-steps checklist progress
- `dismissedTips?: string[]` — IDs of contextual feature tips the user has dismissed

## Testing

114+ tests across 114 test files using Vitest:
- `cli.test.ts` - CLI argument parsing and command routing
- `config.test.ts`, `config/schema.test.ts` - Configuration and schema validation
- `logger.test.ts` - Colored output and spinner functionality
- `ai-invoker.test.ts` - AI invoker creation and session management
- `output-formatter.test.ts` - Result formatting (table/json/csv/markdown)
- `options-resolver.test.ts` - Shared option resolution logic
- `commands/` - run, validate, list, serve, wipe-data command tests
- `server/` - 70+ test files covering API handlers, queue, scheduling, tasks, wiki, SPA, WebSocket, SSE
- `spa/react/` - React component and hook tests
- `validation/` - Schema validation tests
- `e2e/` - End-to-end integration tests

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Execution error |
| 2 | Config/validation error |
| 3 | AI service unavailable |
| 130 | Cancelled (SIGINT) |
