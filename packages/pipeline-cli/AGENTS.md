# Pipeline CLI

Standalone Node.js CLI for executing YAML-based AI pipelines outside VS Code. Consumes `@plusplusoneplusplus/pipeline-core`.

## Build & Test

```bash
npm run build        # Compile TypeScript
npm run test:run     # Run tests (Vitest)
```

## Usage

```bash
# Run from project root
node packages/pipeline-cli/dist/index.js <command>

# Or link globally
cd packages/pipeline-cli && npm link
pipeline <command>
```

## Commands

```bash
pipeline run <path>              # Execute a pipeline
pipeline validate <path>         # Validate YAML without executing
pipeline list [dir]              # List pipeline packages in a directory
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

## Architecture

```
src/
├── index.ts              # Entry point (bin) - Parses CLI args and routes to commands
├── cli.ts                # Commander program setup - Defines commands, flags, and option parsing
├── commands/
│   ├── run.ts            # Execute pipeline - Handles execution, progress, and result formatting
│   ├── validate.ts       # Validate YAML - Checks structure, input sources, and filter config
│   └── list.ts           # List packages - Discovers and displays pipeline packages in a directory
├── ai-invoker.ts         # AI invoker factory - Creates CopilotSDKService instances with session pooling
├── logger.ts             # Console logger - Colored output, spinners, and progress bars
├── output-formatter.ts   # Result formatting - Formats results as table/json/csv/markdown
└── config.ts             # Config resolution - Loads and merges ~/.pipeline-cli.yaml with defaults
```

## Configuration

Configuration file: `~/.pipeline-cli.yaml`

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
```

**Configuration Precedence:** CLI flags > config file > defaults

## Testing

201+ tests across 8 test files using Vitest:
- `cli.test.ts` - CLI argument parsing and command routing
- `config.test.ts` - Configuration file loading and merging
- `logger.test.ts` - Colored output and spinner functionality
- `ai-invoker.test.ts` - AI invoker creation and session management
- `output-formatter.test.ts` - Result formatting (table/json/csv/markdown)
- `commands/list.test.ts` - Pipeline package discovery and listing
- `commands/run.test.ts` - Pipeline execution and progress handling
- `commands/validate.test.ts` - YAML validation logic

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Execution error |
| 2 | Config/validation error |
| 3 | AI service unavailable |
| 130 | Cancelled (SIGINT) |
