# Server Architecture

Standalone Node.js CLI for executing YAML-based AI workflows. Depends on `@plusplusoneplusplus/coc-workflow` for pure workflow compilation/execution and `@plusplusoneplusplus/forge` for runtime/process/queue utilities. Published as `@plusplusoneplusplus/coc`. Requires Node.js ≥ 24.

## CLI Commands

```bash
coc run <path>              # Execute a workflow
coc validate <path>         # Validate YAML without executing
coc list [dir]              # List workflow packages in a directory
coc serve                   # Start AI Execution Dashboard web server
coc queue submit [message]  # Submit a chat task to a running CoC server queue
coc queue list              # List active queued/running tasks, optionally filtered
coc queue cancel <taskId>   # Cancel a queued or running task
coc queue status <taskId>   # Show status/details for a single queue task
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

### `serve` Options

| Flag | Description |
|------|-------------|
| `-p, --port <number>` | Port number (default: 4000) |
| `-H, --host <string>` | Bind address (default: localhost) |
| `-d, --data-dir <path>` | Data directory (default: ~/.coc) |
| `--no-open` | Don't auto-open browser |
| `--theme <theme>` | UI theme: `auto`, `light`, `dark` |

## Source Layout

```
src/
├── index.ts              # Entry point (bin)
├── cli.ts                # Commander program setup
├── commands/
│   ├── run.ts            # Execute workflow
│   ├── validate.ts       # Validate YAML
│   ├── list.ts           # List packages
│   ├── serve.ts          # Start server
│   ├── wipe-data.ts      # Clear stored data
│   ├── skills.ts         # Skills management
│   ├── queue.ts          # Queue submit/list/cancel/status CLI commands
│   └── options-resolver.ts  # Shared option resolution
├── server/               # HTTP/WebSocket server (see module layout below)
├── ai-invoker.ts         # AI invoker factory
├── logger.ts             # Console logger
├── output-formatter.ts   # Result formatting
├── config.ts             # Config resolution (~/.coc/config.yaml)
├── config/schema.ts      # Configuration JSON schema
└── validation/           # Pipeline YAML validation
```

## Server Module Layout

The `src/server/` tree is grouped by feature domain. Cross-cutting plumbing stays at the root.

| Directory | Purpose |
|-----------|---------|
| `core/` | api-handler, attachment-utils, image-utils, hostname-utils, build-info |
| `streaming/` | WebSocket (ProcessWebSocketServer), SSE per-process streaming |
| `logging/` | pino-backed logger, in-memory ring buffer, /api/logs routes |
| `admin/` | admin-handler, db-browser (read-only SQLite), heap-monitor, stats |
| `workspaces/` | global-workspace, my-work, my-life, workspace-summary |
| `processes/` | in-memory store, output-file-manager, stale-task-detector, pin/archive, seen-state, turn-actions, history, resume |
| `queue/` | queue-handler, executor-bridge, multi-repo-router, image-blob-store, partitioner |
| `schedule/` | cron-utils, schedule-handler/manager/executor, run-persistence, yaml-persistence, repo-schedule-loader/overrides. Schedule run records stay `running` after enqueue and finalize from queue terminal events; scheduled Ralph runs finalize from the full `ralphSessionComplete` lifecycle, including final checks and gap-fix loops. Overlapping timer fires are recorded as `missed` and the next timer is armed after the active run finishes. |
| `tasks/` | task-types, cache, watcher, migration, root-resolver, generation, read/write handlers, comments/ |
| `notes/` | read/write/comments/AI/file-preview/image/edits handlers, git/ sub-module, notes-root-resolver (multi-root), notes-roots-handler (roots CRUD API) |
| `workflows/` | constants, utils, watcher, read/write handlers |
| `templates/` | template-watcher, CRUD handler, replicate-apply |
| `skills/` | skill-handler, route-handlers, global-skill-handler, instruction-handler |
| `prompts/` | prompt-handler, prompt-utils |
| `servers/` | Remote CoC server registry, DevTunnel connector |
| `git/` | git-cache, git-info-cache, repo-utils |
| `storage/` | storage-migration, startup migrations, directory-history-importer, export/import/wiper |
| `llm-tools/` | AI tool factories (see [llm-tools.md](llm-tools.md)) |
| `executors/` | AI chat execution layer (see Executors section below) |
| `infrastructure/` | Server bootstrap (composition root) |
| `routes/` | Centralized route registration |
| `providers/` | Provider abstraction for AI/PRs |
| `repos/` | Repository management endpoints |
| `work-items/` | Work-items REST + executors |
| `wiki/` | Wiki integration (manager, data, routes, context-builder, conversation-sessions) |
| `terminal/` | WebSocket-based PTY (session-manager, routes, ws-server) |
| `memory/` | Memory config, bounded-memory REST, repo-memory, promote, background-review |
| `ralph/` | Iterative execution sessions and file-backed journal (see [ralph.md](ralph.md)) |
| `for-each/` | Dedicated For Each run records, item-plan validation, file-backed repo-scoped draft/approval storage |
| `models/` | Model registry endpoints |
| `messaging/` | Teams bot integration: manager, command router, per-user state |
| `spa/` | Dashboard SPA (HTML template, React client) |

## Executors

The `executors/` directory contains the AI chat execution layer:

| File | Purpose |
|------|---------|
| `base-executor.ts` | Abstract base: streaming, throttling, tool-event capture |
| `chat-base-executor.ts` | Abstract chat executor: AI call lifecycle, memory/options helpers |
| `chat-executor.ts` | Ask-mode executor (interactive) |
| `autopilot-executor.ts` | Autopilot-mode executor |
| `follow-up-executor.ts` | Follow-up message executor |
| `note-chat-executor.ts` | Note chat executor |
| `note-create-executor.ts` | Note create executor |
| `commit-chat-executor.ts` | Commit chat executor |
| `workflow-executor.ts` | Workflow execution executor |
| `shell-executor.ts` | Shell script executor |
| `process-lifecycle-runner.ts` | Full process lifecycle + pending-message draining |
| `prompt-builder.ts` | System message, memory context, skill injection |
| `chat-tool-builder.ts` | Common chat tool bundle assembly |
| `bounded-memory-addon.ts` | Wires bounded MEMORY.md into chat executors |

CoC chat tasks use Ask, Autopilot, or Ralph modes. Legacy stored or incoming chat payloads with `mode='plan'` are normalized to Ask before dispatch, metadata persistence, schedule execution, and follow-up execution; the server does not route CoC chat work through a dedicated Plan executor.

## Configuration

Configuration file: `~/.coc/config.yaml` (legacy fallback: `~/.coc.yaml`). CLI flags > config file > defaults.

```yaml
model: gpt-4
parallel: 5
output: table
approvePermissions: false
mcpConfig: ~/.copilot/mcp-config.json  # global MCP; repo .vscode/mcp.json is also loaded per workspace
timeout: 1800
defaultProvider: copilot  # default for new chats/tasks when payload.provider is omitted

serve:
  port: 4000
  host: localhost
  dataDir: ~/.coc
  theme: auto

monitoring:
  heap:
    enabled: true
    interval: 60000
    threshold: 0.85

store:
  backend: sqlite    # or 'file'

terminal:
  enabled: true

workflows:
  enabled: true

forEach:
  enabled: false

codex:
  enabled: false

claude:
  enabled: false
```

Exit codes: 0=success, 1=error, 2=config, 3=AI unavailable, 130=SIGINT.

## Server Startup

1. Model metadata store warmed before listening (so executors can resolve reasoning effort)
2. Auto-migrations: workspace registry JSON → SQLite, file-based process history → SQLite
3. Chat/follow-up executors initialize model metadata on demand if task starts before cache warm
4. Variant models with `capabilities.family` base preserved in process metadata but sent to SDK as base model + reasoning effort
5. `defaultProvider` is resolved at startup and wired into queue infrastructure; chat payloads with `payload.provider` override it, while follow-ups use the provider recorded on the original process

## Storage Layout

**Global (`~/.coc/`):**
- `config.yaml` — server configuration
- `processes.db` — SQLite process store (schema v8)
- `preferences.json` — global UI preferences
- `memory/system/MEMORY.md` — system-level bounded memory
- `skills/` — global skill definitions

**Per-repo (`~/.coc/repos/<workspaceId>/`):**
- `queues.json`, `schedules.json`, `git-ops.json`, `preferences.json`
- `tasks/` — task and plan files
- `outputs/` — AI conversation output markdown
- `memory/MEMORY.md` — per-repo bounded memory
- `ralph-sessions/<sessionId>/` — Ralph `session.json` metadata and `progress.md` journal
- `for-each-runs/<runId>/` — For Each `run.json` metadata and `items.json` reviewed item plan/state
- `paste-context/` — temp files for large pasted content

Use `getRepoDataPath(dataDir, workspaceId, filename)` for all per-repo path construction.
