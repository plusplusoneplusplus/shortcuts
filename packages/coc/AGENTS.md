# CoC (Copilot of Copilot)

Standalone Node.js CLI for executing YAML-based AI workflows outside VS Code. Depends on the published `@plusplusoneplusplus/forge` package (`^1.0.0`) as a runtime dependency. Published to npm as `@plusplusoneplusplus/coc` (public access). Requires Node.js ≥ 24.

## Build & Test

```bash
npm run build        # Compile TypeScript
npm run test:run     # Run tests (Vitest)
```

Git commit file clicks in the repo dashboard use `RepoGitTab` split-view routing: full commits render `CommitDetail` diffs, while single commit files render `CommitFileContent` with full-file markdown/source content in the right panel.

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
│   ├── index.ts          # Server factory - createExecutionServer(), imports router/API/WebSocket/SSE from @plusplusoneplusplus/coc-server
│   ├── queue-handler.ts          # Queue management API — validates 3 task types (chat, run-workflow, run-script); no-repoId branch scopes to global workspace
│   ├── queue-executor-bridge.ts  # Bridges queue to AI/workflow/script execution — unified chat dispatch with context-based routing
│   ├── queue-persistence.ts      # Persistent queue state — per-workspace files under ~/.coc/queues/repo-<workspaceId>.json
│   ├── multi-repo-executor-bridge.ts  # Multi-repo workflow execution — maintains repoId↔rootPath bidirectional maps
│   ├── multi-repo-queue-persistence.ts # Per-repo queue persistence — uses workspace ID for file naming
│   ├── global-workspace.ts       # Global workspace bootstrapper — creates ~/.coc/global-workspace/ and registers virtual workspace (GLOBAL_WORKSPACE_ID)
│   ├── my-work-workspace.ts      # My Work virtual workspace bootstrapper — creates ~/.coc/repos/my_work/ with notes structure (MY_WORK_WORKSPACE_ID)
│   ├── my-work-handler.ts        # My Work REST API — sync, generate-summary, status endpoints
│   ├── my-life-workspace.ts      # My Life virtual workspace bootstrapper — creates ~/.coc/repos/my_life/ with goals/journal notes (MY_LIFE_WORKSPACE_ID)
│   ├── my-life-handler.ts        # My Life REST API — sync, generate-summary, status endpoints
│   ├── workflows-handler.ts      # Workflow CRUD and listing API
│   ├── workflow-watcher.ts       # File watcher for workflow changes
│   ├── tasks-handler.ts          # Task management API — task root at ~/.coc/repos/<workspaceId>/tasks/
│   ├── task-watcher.ts           # File watcher for task changes
│   ├── task-comments-handler.ts  # Task comment/annotation API
│   ├── task-generation-handler.ts # AI-powered task generation
│   ├── stale-task-detector.ts    # Detects and flags stale tasks
│   ├── schedule-handler.ts       # Scheduled execution API
│   ├── schedule-manager.ts       # Schedule lifecycle management
│   ├── task-root-resolver.ts     # Resolves task root path from workspaceId (requires workspaceId in TaskRootOptions)
│   ├── process-resume-handler.ts # Resume interrupted processes
│   ├── prompt-handler.ts         # Prompt management API
│   ├── prompt-utils.ts           # Prompt utilities
│   ├── preferences-handler.ts    # User preference storage API (UI prefs only; pin/archive moved to processes table)
│   ├── pin-archive-handler.ts    # Pin/archive REST API (PATCH /api/processes/:id/pin, /archive; POST /api/processes/archive, /unarchive; GET /api/workspaces/:id/pinned)
│   ├── admin-handler.ts          # Admin/diagnostic endpoints
│   ├── heap-monitor.ts          # Heap memory pressure monitoring (periodic V8 heap checks, GET /api/admin/heap)
│   ├── output-file-manager.ts    # Manage output file storage
│   ├── output-pruner.ts          # Prune old output files
│   ├── data-exporter.ts          # Export stored data
│   ├── data-importer.ts          # Import data
│   ├── data-wiper.ts             # Data cleanup/reset
│   ├── diff-comments-handler.ts  # Git diff view comment CRUD API
│   ├── commit-chat-binding-store.ts # SQLite store mapping commitHash → taskId for commit-chat
│   ├── image-blob-store.ts       # Externalizes base64 images from queue persistence into JSON files
│   ├── replicate-apply-handler.ts # Applies ReplicateResult changes to disk (idempotent)
│   ├── llm-tools/                # AI tool factories for chat executors
│   │   ├── index.ts              # Barrel re-exports
│   │   ├── add-diff-comment-tool.ts # Factory for per-invocation add_diff_comment AI tool (commit chat)
│   │   ├── diff-line-mapper.ts   # Unified diff parser and source-line → diff-index mapper
│   │   ├── resolve-comment-tool.ts   # Factory for per-invocation resolve_comment AI tool
│   │   ├── search-conversations-tool.ts # Factory for search_conversations AI tool (FTS5 conversation search)
│   │   ├── suggest-follow-ups-tool.ts # Factory for suggest_follow_ups AI tool
│   │   └── update-task-status-tool.ts # Factory for update_task_status AI tool
│   ├── executors/                 # AI chat execution layer — process lifecycle, client caching, prompt building
│   │   ├── copilot-client-cache.ts # CopilotClient process pool: per-process caching + pre-warmed idle pool (default 3). Idle timeout: 5 min. Pool rotation: 5 min. Retry-on-death handled in executors.
│   │   ├── base-executor.ts       # Abstract base: streaming, throttling, tool-event capture, session state, output persistence
│   │   ├── chat-base-executor.ts  # Abstract chat executor: AI call lifecycle with retry-on-client-death (1 retry with fresh client from pool)
│   │   ├── chat-executor.ts       # Ask-mode executor (interactive)
│   │   ├── plan-executor.ts       # Plan-mode executor
│   │   ├── autopilot-executor.ts  # Autopilot-mode executor
│   │   ├── follow-up-executor.ts  # Follow-up message executor with retry-on-client-death
│   │   ├── process-lifecycle-runner.ts # Full process lifecycle orchestration
│   │   └── prompt-builder.ts      # System message, memory context, repo instructions, skill injection
│   ├── task-migration.ts         # One-time migration from legacy .vscode/tasks/ location
│   ├── startup-process-migration.ts # Auto-migrates file-based process histories to SQLite on startup (renames processes/ → processes.migrated/)
│   ├── template-watcher.ts       # Watches .vscode/templates/ for file changes
│   ├── templates-handler.ts      # Template CRUD API (list, read, create, update, delete)
│   ├── notes-watcher.ts          # File watcher for notes directories — debounced, .md-only, broadcasts notes-changed WS events
│   ├── wiki/                     # Wiki integration
│   │   ├── index.ts              # Wiki module exports
│   │   ├── types.ts              # Wiki types
│   │   ├── wiki-manager.ts       # Wiki lifecycle management
│   │   ├── wiki-data.ts          # Wiki data access layer
│   │   ├── wiki-routes.ts        # Wiki HTTP routes
│   │   ├── generate-handler.ts   # Wiki generation API
│   │   ├── explore-handler.ts    # Wiki exploration API
│   │   ├── ask-handler.ts        # Wiki Q&A endpoint
│   │   ├── context-builder.ts    # Build context for wiki AI queries
│   │   ├── conversation-session-manager.ts  # Manage wiki chat sessions
│   │   ├── file-watcher.ts       # Watch wiki source files
│   │   └── admin-handlers.ts     # Wiki admin endpoints
│   ├── terminal/                  # WebSocket-based terminal
│   │   ├── index.ts              # Barrel exports
│   │   ├── types.ts              # Terminal session and message types (IPty, TerminalSession, TerminalClientMessage, TerminalServerMessage)
│   │   ├── terminal-session-manager.ts  # PTY lifecycle management (create, resize, destroy, idle cleanup)
│   │   └── terminal-ws-server.ts # WebSocket server for /ws/terminal — per-workspace connections, multi-session per client, PTY I/O forwarding, heartbeat
│   ├── memory/                  # Memory extraction and observation management
│   │   ├── extraction-config.ts         # ExtractionConfig types, defaults, validation
│   │   ├── extraction-state.ts          # ExtractionStateManager — tracks per-process extraction state in JSON
│   │   ├── transcript-extractor.ts      # TranscriptExtractor — reads conversation turns, calls AI, writes raw observations
│   │   ├── memory-extraction-sweep.ts   # MemoryExtractionSweep — periodic sweep (start/stop/dispose) finding idle completed processes
│   │   ├── memory-aggregate-executor.ts # MemoryAggregateExecutor — consolidates raw observations + notes into consolidated.md
│   │   ├── memory-config-handler.ts     # Memory config persistence (readMemoryConfig, writeMemoryConfig)
│   │   ├── memory-routes.ts             # Global memory REST endpoints
│   │   ├── repo-memory-handler.ts       # Per-repo memory REST endpoints (observations dir, not pipeline)
│   │   └── repo-memory-migration.ts     # Startup migration for memory directories
│   └── spa/              # Dashboard SPA
│       ├── html-template.ts  # HTML generation - Generates full HTML with inline bundled assets from client/dist/
│       ├── index.ts          # Module exports - generateDashboardHtml + DashboardOptions
│       ├── helpers.ts        # Template helpers
│       ├── types.ts          # Dashboard option types
│       └── client/           # React SPA client
│           └── react/
│               ├── App.tsx              # Root React component
│               ├── admin/               # Admin panel & preferences UI
│               ├── chat/                # Chat conversation utilities
│               ├── components/          # Shared UI components (e.g., ContextWindowIndicator)
│               ├── context/             # React contexts (App, Queue, Task, Toast, FloatingChats, etc.)
│               ├── hooks/               # 30+ custom hooks (useApi, useWebSocket, useMarkdownPreview, useDiffComments, etc.)
│               ├── layout/              # Layout components (Router, TopBar, BottomNav, ThemeProvider)
│               ├── processes/           # Process detail views, conversation bubbles, tool call rendering
│               │   └── dag/             # Workflow DAG visualization (25+ components)
│               ├── queue/               # Queue management UI (EnqueueDialog, QueueView)
│               ├── repos/               # Repository management (45+ components: git, workflows, branches, diffs)
│               │   └── explorer/        # File explorer with Monaco Editor
│               ├── shared/              # Shared components (MarkdownReviewEditor, Dialog, Button, SourceEditor, etc.)
│               ├── tasks/               # Task management UI (TaskTree, TaskPreview, TaskActions)
│               │   └── comments/        # Inline comment system (CommentCard, CommentSidebar, SelectionToolbar)
│               ├── types/               # TypeScript type definitions
│               ├── utils/               # Utility modules (config, format, path-resolution)
│               ├── views/
│               │   ├── memory/          # Memory management (MemoryView, entries/files/config panels, ExploreCachePanel)
│               │   └── skills/          # Skills management (SkillsView, installed/bundled/config panels)
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
- **Rich mode** (opt-in via `showRichMode`): Tiptap WYSIWYG via `RichEditorCore`, markdown↔html round-trip through `noteMarkdown.ts` helpers, Ctrl+S save, dirty-state tracking. Comments disabled in first pass.
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
- `onboardingProgress?: { repoAdded, firstChatSent, workflowsVisited, settingsVisited, dismissed }` — first-steps checklist progress
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
