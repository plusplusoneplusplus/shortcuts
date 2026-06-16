# @plusplusoneplusplus/coc-client

Framework-free TypeScript client for the CoC server API. The client wraps a running `coc serve` instance; it does not start the server or execute AI work on its own.

## Install

```bash
npm install @plusplusoneplusplus/coc-client
```

CoC normally runs at `http://localhost:4000`, but callers should pass the actual server URL.

```ts
import { CocClient } from '@plusplusoneplusplus/coc-client';

const coc = new CocClient({ baseUrl: 'http://localhost:4000' });

const health = await coc.health.get();
const { items } = await coc.workItems.listForOrigin(originId);
```

## Runtime notes

- Node.js 24+ has a global `fetch`, which the client uses by default.
- Browser usage can omit `baseUrl` for same-origin requests.
- Node tools that use realtime APIs should inject `WebSocket` or `EventSource` constructors when the runtime does not provide them globally.
- Persistent Work Item APIs use an explicit origin ID. Workspace-root-dependent actions still require a workspace ID. IDs are encoded as path segments, so IDs containing `/` are safe.
- Persistent Pull Request sidecar APIs such as recent-opened entries, Team roster, chat bindings, and review progress use explicit origin IDs. Provider and filesystem operations still require a concrete workspace/repo route.
- Follow-up routing, queue transitions, and storage paths remain server-authoritative.

## Supported domains

| Domain | Property | Coverage |
| --- | --- | --- |
| Health/OpenAPI | `coc.health` | `/api/health`, `/api/openapi.json` |
| Models | `coc.models` | model list and enabled-model configuration |
| Processes | `coc.processes` | list, summaries, detail, create, update, delete, cancel, follow-up message, output, stream helper |
| Queue | `coc.queue` | list, stats, history, enqueue, pause/resume, cancel |
| Schedules | `coc.schedules` | repo-scoped list, create, update, enable/disable, move, delete, run, history |
| Work items | `coc.workItems` | list, grouped list, create, get, update, delete, plan, execute |
| Pull requests | `coc.pullRequests` | provider PR data, origin-scoped recent-opened, Team roster, chat bindings, classifications, review progress, suggestions |
| Workspaces/repos | `coc.workspaces`, `coc.repos` | list, register, discover, update, delete, git info, history deletion |
| Servers | `coc.servers` | remote server CRUD, health, reconnect, patch-transfer cherry-pick orchestration |
| Preferences | `coc.preferences` | global and per-repo preferences, skill usage |
| Memory | `coc.memory`, `coc.memoryV2` | bounded memory, explore cache, Memory V2 facts, review queue, episodes, export, wipe |
| Git | `coc.git` | commits, diffs, branch operations, working-tree changes, operation history, patch-transfer export/apply |
| Realtime | `coc.events` | process WebSocket connection helper |

## Examples

### Work items

```ts
const item = await coc.workItems.createForOrigin(originId, {
  title: 'Add retry telemetry',
  description: 'Track retry counts in queue task metadata.',
  priority: 'normal',
});

await coc.workItems.updatePlan(workspaceId, item.id, 'Implementation plan...');
```

### Process follow-up

```ts
await coc.processes.sendMessage(processId, {
  content: 'Continue with the next failing test.',
  deliveryMode: 'enqueue',
}, { workspace: workspaceId });
```

### WebSocket events

```ts
const connection = coc.events.connect({
  workspaceId,
  onMessage: event => console.log(event.type),
  onStatusChange: status => console.log(status),
});

connection.close();
```

OpenAPI is a useful contract target for the server, but this client is hand-authored and validated with representative real-server contract tests.
