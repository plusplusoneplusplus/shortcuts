# CoC (Copilot of Copilot)

Standalone Node.js CLI for executing YAML-based AI workflows outside VS Code. Consumes `@plusplusoneplusplus/pipeline-core`.

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
│   └── options-resolver.ts  # Shared option resolution logic for commands
├── server/
│   ├── index.ts          # Server factory - createExecutionServer(), wires store + WebSocket + routes
│   ├── router.ts         # HTTP router - Request routing, CORS, static files, SPA fallback
│   ├── api-handler.ts    # REST API - CRUD for processes/workspaces, stats, query filtering
│   ├── websocket.ts      # WebSocket server - `ws` library, workspace-scoped event broadcasting
│   ├── sse-handler.ts    # SSE streaming - Real-time process output via Server-Sent Events
│   ├── types.ts          # Server types - ExecutionServer, Route, ServeCommandOptions
│   ├── queue-handler.ts          # Queue management API endpoints
│   ├── queue-executor-bridge.ts  # Bridges queue system to pipeline executor
│   ├── queue-persistence.ts      # Persistent queue state storage
│   ├── multi-repo-executor-bridge.ts  # Multi-repo workflow execution
│   ├── multi-repo-queue-persistence.ts # Per-repo queue persistence
│   ├── workflows-handler.ts      # Workflow CRUD and listing API
│   ├── workflow-watcher.ts       # File watcher for workflow changes
│   ├── tasks-handler.ts          # Task management API endpoints
│   ├── task-watcher.ts           # File watcher for task changes
│   ├── task-comments-handler.ts  # Task comment/annotation API
│   ├── task-generation-handler.ts # AI-powered task generation
│   ├── stale-task-detector.ts    # Detects and flags stale tasks
│   ├── schedule-handler.ts       # Scheduled execution API
│   ├── schedule-manager.ts       # Schedule lifecycle management
│   ├── schedule-persistence.ts   # Persistent schedule storage
│   ├── process-resume-handler.ts # Resume interrupted processes
│   ├── prompt-handler.ts         # Prompt management API
│   ├── prompt-utils.ts           # Prompt utilities
│   ├── preferences-handler.ts    # User preference storage API
│   ├── admin-handler.ts          # Admin/diagnostic endpoints
│   ├── output-file-manager.ts    # Manage output file storage
│   ├── output-pruner.ts          # Prune old output files
│   ├── data-exporter.ts          # Export stored data
│   ├── data-importer.ts          # Import data
│   ├── data-wiper.ts             # Data cleanup/reset
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
│   └── spa/              # Dashboard SPA
│       ├── html-template.ts  # HTML generation - Inline SPA with all CSS/JS embedded
│       ├── styles.ts         # CSS styles - Dark/light theme, responsive layout
│       ├── scripts.ts        # Client JS - WebSocket connection, API calls, DOM updates
│       ├── helpers.ts        # Template helpers
│       └── types.ts          # Dashboard option types
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
```

**Configuration Precedence:** CLI flags > config file > defaults

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
