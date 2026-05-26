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
const { items } = await coc.workItems.list(workspaceId);
```

## Runtime notes

- Node.js 24+ has a global `fetch`, which the client uses by default.
- Browser usage can omit `baseUrl` for same-origin requests.
- Node tools that use realtime APIs should inject `WebSocket` or `EventSource` constructors when the runtime does not provide them globally.
- Repo-scoped APIs require an explicit workspace or repo ID. IDs are encoded as path segments, so IDs containing `/` are safe.
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
| Workspaces/repos | `coc.workspaces`, `coc.repos` | list, register, discover, update, delete, git info, history deletion |
| Preferences | `coc.preferences` | global and per-repo preferences, skill usage |
| Memory | `coc.memory`, `coc.memoryV2` | bounded memory, explore cache, Memory V2 facts, review queue, episodes, export, wipe |
| Realtime | `coc.events` | process WebSocket connection helper |

## Examples

### Work items

```ts
const item = await coc.workItems.create(workspaceId, {
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
