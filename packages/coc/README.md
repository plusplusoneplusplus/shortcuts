# CoC (Copilot of Copilot)

A standalone Node.js CLI for executing YAML-based AI pipelines outside VS Code.

## Installation

```bash
npm install -g @plusplusoneplusplus/coc
```

## Quick Start

```bash
# Run a pipeline
coc run ./my-pipeline/

# Validate pipeline YAML
coc validate ./my-pipeline/pipeline.yaml

# List available pipelines
coc list ./pipelines/

# Start the AI Execution Dashboard
coc serve
```

## Commands

### `coc run <path>`
Execute a pipeline from a YAML file or package directory.

### `coc validate <path>`
Validate pipeline YAML without executing.

### `coc list [dir]`
List pipeline packages in a directory.

### `coc serve`
Start the AI Execution Dashboard web server (default port 4000).

## Features

### YAML Pipeline Execution

Define AI-powered data processing pipelines in YAML with map-reduce style workflows. See the [Pipeline YAML Guide](../../CLAUDE.md#yaml-pipeline-framework) for full syntax.

### Task Commenting

Add inline comments to task results for review, notes, and AI-assisted analysis:

- **Keyboard Shortcut**: Select text and press `Cmd+Shift+M` (macOS) or `Ctrl+Shift+M` (Windows/Linux)
- **Comment Categories**: Bug, Question, Suggestion, Praise, Nitpick, General
- **Persistence**: Comments saved per workspace in `{dataDir}/tasks-comments/{workspaceId}/`
- **Filtering**: Filter comments by category and status (open/resolved)
- **Anchor Tracking**: Comments stay anchored to text even after content changes via fuzzy matching
- **AI Integration**: Generate AI prompts from comments for automated review

See the [Task Comments Guide](../../docs/coc-task-comments.md) for full documentation.

### AI Execution Dashboard

A web-based dashboard for monitoring AI processes across workspaces:

- Real-time process tracking via WebSocket
- SSE streaming for individual process output
- Multi-workspace support with workspace-scoped filtering
- Dark/light/auto theme support

Start with `coc serve` and open `http://localhost:4000`.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Shift+M` | Add comment on selected text |

## Configuration

CoC reads persistent defaults from `~/.coc.yaml`. CLI flags override config file values.

```yaml
# ~/.coc.yaml
model: gpt-4
parallelism: 5
outputFormat: table
timeout: 300
serve:
  port: 4000
  open: true
```

## Data Storage

CoC stores task data and comments locally:

- **Task Results**: Managed by the pipeline execution engine
- **Comments**: `{dataDir}/tasks-comments/{workspaceId}/{sha256(filePath)}.json`
- **Processes**: `~/.coc/processes.json` (when using `coc serve`)
- **Configuration**: `~/.coc.yaml`

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Execution error |
| 2 | Config/validation error |
| 3 | AI unavailable |
| 130 | SIGINT (user interrupt) |

## Development

```bash
cd packages/coc
npm run build
npm link
coc run <path>
```

## Testing

```bash
cd packages/coc
npm run test:run
```

## License

See [LICENSE](../../LICENSE) in the repository root.
