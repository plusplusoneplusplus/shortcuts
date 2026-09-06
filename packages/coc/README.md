# CoC (Copilot of Copilot)

A standalone Node.js CLI and dashboard for executing YAML-based AI workflows.

## Prerequisites

- Node.js ≥ 24
- [GitHub Copilot](https://github.com/features/copilot) subscription

CoC depends on `@github/copilot-sdk` → `@github/copilot` for AI features. Both
are installed automatically as npm dependencies. You must authenticate with the
Copilot CLI (`copilot` → `/login`) before using AI features — see the
[root README](../../README.md#prerequisites--setup) for setup instructions.

## Installation

```bash
npm install -g @plusplusoneplusplus/coc
```

## Quick Start

```bash
# Run a workflow
coc run ./my-workflow/

# Validate workflow YAML
coc validate ./my-workflow/workflow.yaml

# List available workflows
coc list ./workflows/

# Start the AI Execution Dashboard
coc serve
```

## Run with Docker

See the [repo README → Run with Docker](../../README.md#run-with-docker) for full Docker instructions, Compose recipe, and the per-tenant managed pattern in [`deploy/tenant/`](../../deploy/tenant/README.md).

## Commands

### `coc run <path>`
Execute a workflow from a YAML file or package directory.

### `coc validate <path>`
Validate workflow YAML without executing.

### `coc list [dir]`
List workflow packages in a directory.

### `coc serve`
Start the AI Execution Dashboard web server (default port 4000).

> By default, `coc serve` binds to `127.0.0.1` (localhost only). To accept
> connections from other machines on the network, use:
>
> ```bash
> coc serve --host 0.0.0.0
> ```
>
> Or set it permanently in `~/.coc/config.yaml`:
>
> ```yaml
> serve:
>   host: 0.0.0.0
> ```

## Features

### YAML Workflow Execution

Define AI-powered data processing workflows in YAML with map-reduce style orchestration.

### Task Commenting

Add inline comments to task results for review, notes, and AI-assisted analysis:

- **Keyboard Shortcut**: Select text and press `Cmd+Shift+M` (macOS) or `Ctrl+Shift+M` (Windows/Linux)
- **Comment Categories**: Bug, Question, Suggestion, Praise, Nitpick, General
- **Persistence**: Comments saved per workspace in `{dataDir}/tasks-comments/{workspaceId}/`
- **Filtering**: Filter comments by category and status (open/resolved)
- **Anchor Tracking**: Comments stay anchored to text even after content changes via fuzzy matching
- **AI Integration**: Generate AI prompts from comments for automated review

### AI Execution Dashboard

A web-based dashboard for monitoring AI processes across workspaces:

- Real-time process tracking via WebSocket
- SSE streaming for individual process output
- Multi-workspace support with workspace-scoped filtering
- Dark/light/auto theme support

Start with `coc serve` and open `http://localhost:4000`.

### Client Library

Use `@plusplusoneplusplus/coc-client` from Node tools or browser integrations to call a running CoC server without copying dashboard transport code:

```ts
import { CocClient } from '@plusplusoneplusplus/coc-client';

const coc = new CocClient({ baseUrl: 'http://localhost:4000' });
const health = await coc.health.get();
const { items } = await coc.workItems.listForOrigin(originId);
```

The client covers core REST domains and realtime process events. Repo-scoped calls require an explicit workspace ID, and follow-up routing remains server-authoritative.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Shift+M` | Add comment on selected text |

## Configuration

CoC reads persistent defaults from `~/.coc/config.yaml`. CLI flags override config file values.

```yaml
# ~/.coc/config.yaml
defaultModel: gpt-4
serve:
  port: 4000
```

## Data Storage

CoC stores task data and comments locally:

- **Task Results**: Managed by the workflow execution engine
- **Comments**: `{dataDir}/tasks-comments/{workspaceId}/{sha256(filePath)}.json`
- **Processes**: SQLite database at `~/.coc/processes.db` (when using `coc serve`)
- **Configuration**: `~/.coc/config.yaml`

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
