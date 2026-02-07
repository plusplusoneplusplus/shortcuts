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

## Architecture

```
src/
├── index.ts              # Entry point (bin)
├── cli.ts                # Commander program setup
├── commands/
│   ├── run.ts            # Execute pipeline
│   ├── validate.ts       # Validate YAML
│   └── list.ts           # List packages
├── ai-invoker.ts         # AI invoker factory (CopilotSDKService + SessionPool)
├── logger.ts             # Console logger with color/spinner support
├── output-formatter.ts   # Result formatting (table/json/csv/markdown)
└── config.ts             # Config resolution (~/.pipeline-cli.yaml)
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Execution error |
| 2 | Config/validation error |
| 3 | AI service unavailable |
| 130 | Cancelled (SIGINT) |
