# CoC (Copilot of Copilot)

A standalone Node.js CLI and dashboard for executing YAML-based AI workflows.

## Prerequisites

- Node.js ≥ 24
- [GitHub Copilot](https://github.com/features/copilot) subscription

CoC depends on `@github/copilot-sdk` and its platform-specific runtime package
for AI features. Authenticate with `COPILOT_GITHUB_TOKEN`/`GH_TOKEN` or an
existing login under `~/.copilot`. A separately installed Copilot CLI can create
that login with `copilot` → `/login`; see the
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

### Teams Direct Messages

CoC can send to an **existing one-on-one Teams chat** through IC3 using its
normal Teams connection. Configure and enable the bridge in **Connections →
Teams**, authenticate its Microsoft Teams MCP endpoint, and configure the
account's explicit IC3 region (`amer`, `emea`, or `apac`). Save region changes
and reconnect. Ordinary direct sends require no separate feature flag.

Connection settings are server-global, stored in `teams-messaging.json` under
the CoC data directory, and managed through `/api/messaging/teams/config`.
They are separate from `config.yaml`. Channel reads and channel writes retain
their existing Graph/MCP routes; sending a DM does not change inbound routing.

#### Send an existing 1:1 message

1. Obtain the existing chat ID and intended recipient's Entra object ID through
   authorized Teams discovery. Do not guess IDs, use an email address as the
   object ID, or create a chat for this operation.
2. Read `GET /api/messaging/teams/status` from the owning CoC server. The bridge
   must be enabled and connected, with an explicit `ic3Region`. Use its current
   `connectionId`; reconnecting invalidates earlier connection references.
3. Send one `POST /api/messaging/teams/direct-message` request with
   `Content-Type: application/json`:

   ```json
   {
     "chatId": "19:existing-direct@thread.v2",
     "recipientId": "00000000-0000-0000-0000-000000000003",
     "connectionId": "<current-connection-id>",
     "content": "Hello from CoC.",
     "contentType": "text"
   }
   ```

   These identifiers are synthetic placeholders. `contentType` must be `text`
   or `html`; text is escaped, HTML preserves its markup, and CoC adds assistant
   attribution without changing the authenticated Teams sender identity.

Before dispatch, CoC uses MCP `GetChat` and `ListChatMembers` to verify the exact
existing `oneOnOne` chat and complete membership: the authenticated account and
the distinct intended recipient. Missing tools, metadata, or access reject the
send explicitly. IC3 uses a separate audience-specific Azure CLI credential
pinned to the MCP account; this operation does not request additional Graph chat
consent. Verification, credentials, and the single write share a ten-second
deadline and cancel when the connection stops or the HTTP caller disconnects.

#### Delivery outcomes and limitations

| Response | Meaning |
|----------|---------|
| `201` | Accepted, with a typed receipt containing `message.messageId`, backend, destination and connection identity |
| `400` | Invalid destination, message body or unsupported options |
| `409` | Unavailable configuration/access/connection, or a definitive rejection; inspect `code` and `outcome` |
| `502` | Unknown delivery; the message may already have arrived |

Inspect the response's `outcome` (`accepted`, `not-attempted`, `rejected`, or
`unknown`). **Never automatically replay an unknown delivery.** Reconcile it
through authorized Teams reads before deciding whether another send is needed.
CoC does not retry, fall back to Graph/MCP, guess a region, or replay across regions.
IC3 is an experimental private protocol; availability can vary by account and region.

This endpoint does not support chat creation, group/channel destinations, replies,
mentions, inbound DM commands, self destinations, or a dashboard DM composer.

Connector callers select `operationRoutes: { chatSend: 'ic3' }` in MCP mode and
use `TeamsBot.sendMessage({ kind: 'chat', chatId, recipientId,
connectionId: bot.getConnectionId() }, { content, contentType })`. The raw
`send(target, text)` method is not the ordinary IC3 entry point.

#### Connector self sends

IC3 self sends are always supported without an enablement flag or admin toggle.
In MCP mode, select `operationRoutes: { selfSend: 'ic3' }` when constructing
`TeamsBot`, then send explicitly:

```ts
await bot.sendMessage(
  { kind: 'self' },
  { content: 'A note from CoC.', contentType: 'text' },
);
```

The destination maps to the current account's `48:notes`, not an ordinary chat ID.
The configured region, pinned account, deadline, cancellation and no-replay checks
still apply; replies and mentions are unsupported. Selecting IC3 self routing
does not send a connection probe or discover an inbound DM target. Default
connector self routing uses MCP unless an IC3 route is selected. This is a
connector API, not a self-send mode of `/api/messaging/teams/direct-message`.

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
