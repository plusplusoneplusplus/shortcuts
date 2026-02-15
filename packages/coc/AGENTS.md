# CoC (Copilot of Copilot)

Standalone Node.js CLI for executing YAML-based AI pipelines outside VS Code. Consumes `@plusplusoneplusplus/pipeline-core`.

## Build & Test

```bash
npm run build        # Compile TypeScript
npm run test:run     # Run tests (Vitest)
```

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
coc run <path>              # Execute a pipeline
coc validate <path>         # Validate YAML without executing
coc list [dir]              # List pipeline packages in a directory
coc serve                   # Start AI Execution Dashboard web server
```

### `run` Options

| Flag | Description |
|------|-------------|
| `-m, --model <model>` | Override AI model |
| `-p, --parallel <n>` | Parallelism limit |
| `-o, --output <fmt>` | Output format: `table`, `json`, `csv`, `markdown` |
| `-f, --output-file <path>` | Write results to file |
| `-w, --workspace-root <path>` | Workspace root for skill resolution |
| `--param key=value` | Pipeline parameters (repeatable) |
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
│   ├── run.ts            # Execute pipeline - Handles execution, progress, and result formatting
│   ├── validate.ts       # Validate YAML - Checks structure, input sources, and filter config
│   ├── list.ts           # List packages - Discovers and displays pipeline packages in a directory
│   └── serve.ts          # Start server - Launches AI Execution Dashboard with browser auto-open
├── server/
│   ├── index.ts          # Server factory - createExecutionServer(), wires store + WebSocket + routes
│   ├── router.ts         # HTTP router - Request routing, CORS, static files, SPA fallback
│   ├── api-handler.ts    # REST API - CRUD for processes/workspaces, stats, query filtering
│   ├── websocket.ts      # WebSocket server - Raw RFC 6455, workspace-scoped event broadcasting
│   ├── sse-handler.ts    # SSE streaming - Real-time process output via Server-Sent Events
│   ├── types.ts          # Server types - ExecutionServer, Route, ServeCommandOptions
│   └── spa/              # Dashboard SPA
│       ├── html-template.ts  # HTML generation - Inline SPA with all CSS/JS embedded
│       ├── styles.ts         # CSS styles - Dark/light theme, responsive layout
│       ├── scripts.ts        # Client JS - WebSocket connection, API calls, DOM updates
│       ├── helpers.ts        # Template helpers
│       └── types.ts          # Dashboard option types
├── ai-invoker.ts         # AI invoker factory - Creates CopilotSDKService instances with session pooling
├── logger.ts             # Console logger - Colored output, spinners, and progress bars
├── output-formatter.ts   # Result formatting - Formats results as table/json/csv/markdown
└── config.ts             # Config resolution - Loads and merges ~/.coc/config.yaml with defaults (legacy fallback: ~/.coc.yaml)
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

201+ tests across 13 test files using Vitest:
- `cli.test.ts` - CLI argument parsing and command routing
- `config.test.ts` - Configuration file loading and merging
- `logger.test.ts` - Colored output and spinner functionality
- `ai-invoker.test.ts` - AI invoker creation and session management
- `output-formatter.test.ts` - Result formatting (table/json/csv/markdown)
- `commands/list.test.ts` - Pipeline package discovery and listing
- `commands/run.test.ts` - Pipeline execution and progress handling
- `commands/validate.test.ts` - YAML validation logic
- `commands/serve.test.ts` - Serve command startup, banner, browser open
- `server/api-handler.test.ts` - REST API endpoints (CRUD, filtering, stats)
- `server/integration.test.ts` - End-to-end server integration tests
- `server/spa.test.ts` - SPA HTML generation, theming
- `server/websocket.test.ts` - WebSocket frame encoding/decoding, event broadcasting

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Execution error |
| 2 | Config/validation error |
| 3 | AI service unavailable |
| 130 | Cancelled (SIGINT) |
