---
status: pending
---

# 008: Add server client to VS Code extension

## Summary
Connect the VS Code extension to the standalone AI execution web server (`pipeline serve`) so that AI processes are mirrored to the server in real time. The extension remains local-first — the server is an optional write-only sync target.

## Motivation
AIProcessManager currently stores processes via VS Code Memento API (workspaceState), scoped per window. There is no way for multiple workspaces or external dashboards to observe process activity. By adding a lightweight HTTP client that listens to the existing `onDidChangeProcesses` event and forwards mutations to the server's REST API, we enable a centralized dashboard without changing any local persistence behaviour.

## Design Decisions
- **Fire-and-forget**: Server sync is fully asynchronous and never blocks extension operations (command handlers, process registration, tree refresh).
- **Local-first**: Extension works identically when server URL is empty or unreachable — Memento storage is unchanged.
- **Eventual consistency**: A queue accumulates updates while the server is unreachable; queued items are flushed with exponential back-off when connectivity resumes.
- **No server-to-extension push**: The extension is write-only to the server. The browser dashboard receives real-time updates via WebSocket from the server side.
- **Workspace identity**: Each workspace is identified by a deterministic SHA-256 hash of the first workspace folder's `fsPath`, giving the server a stable key for grouping processes.

## Changes

### Files to Create

#### `src/shortcuts/ai-service/workspace-identity.ts`
Generate a deterministic workspace identifier.

```typescript
import * as crypto from 'crypto';
import * as vscode from 'vscode';

export interface WorkspaceInfo {
    id: string;        // SHA-256 hash of rootPath (first 16 hex chars)
    name: string;      // workspace folder name
    rootPath: string;  // absolute path
}

export function getWorkspaceInfo(): WorkspaceInfo | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return undefined; }
    const folder = folders[0];
    const rootPath = folder.uri.fsPath;
    const id = crypto.createHash('sha256').update(rootPath).digest('hex').substring(0, 16);
    return { id, name: folder.name, rootPath };
}
```

- Pure function, no side effects.
- Returns `undefined` when no workspace is open (headless/untitled window).
- Truncate hash to 16 hex chars — sufficient for uniqueness, readable in logs.

#### `src/shortcuts/ai-service/server-client.ts`
HTTP client using only Node.js built-in `http`/`https` modules (zero new dependencies).

**Class: `ServerClient`**

| Method | HTTP | Endpoint | Notes |
|---|---|---|---|
| `registerWorkspace(info: WorkspaceInfo)` | POST | `/api/workspaces` | Called once on activation |
| `submitProcess(process: AIProcess, workspace: WorkspaceInfo)` | POST | `/api/processes` | Body includes `workspaceId` |
| `updateProcess(id: string, updates: Partial<AIProcess>)` | PATCH | `/api/processes/:id` | Partial update |
| `removeProcess(id: string)` | DELETE | `/api/processes/:id` | |
| `cancelProcess(id: string)` | POST | `/api/processes/:id/cancel` | |
| `healthCheck()` | GET | `/api/health` | Returns `boolean` |

**Connection management:**

```
┌──────────────┐     enqueue      ┌───────────┐    flush     ┌────────┐
│  Extension   │ ───────────────▶ │   Queue   │ ──────────▶  │ Server │
│  (event)     │                  │ (in-mem)  │              │ :4000  │
└──────────────┘                  └───────────┘              └────────┘
                                       │ on failure
                                       ▼
                                  retry with exponential
                                  back-off (1s → 2s → 4s … 30s cap)
```

- Every public method pushes a `QueueItem` (verb + path + body) onto an internal array.
- A `flushQueue()` loop drains items sequentially; on HTTP error it stops and schedules a retry via `setTimeout`.
- Back-off doubles from 1 s to a 30 s cap; resets on successful flush.
- Queue is bounded (default 500 items); oldest items are dropped when full (prevents unbounded memory growth).
- `dispose()` cancels pending timers.

**Constructor:**

```typescript
constructor(serverUrl: string)
```

- Parses URL to determine `http` vs `https` module.
- Stores parsed `host`, `port`, `protocol` for request building.

### Files to Modify

#### `package.json` — Add settings schema

Add two new properties under `contributes.configuration.properties`:

```jsonc
"workspaceShortcuts.aiService.server.url": {
    "type": "string",
    "default": "",
    "markdownDescription": "URL of the AI execution server (e.g. `http://localhost:4000`). Leave empty to disable server sync."
},
"workspaceShortcuts.aiService.server.autoSync": {
    "type": "boolean",
    "default": true,
    "description": "Automatically push AI process changes to the configured server."
}
```

Place them after the existing `workspaceShortcuts.aiService.sdk.loadMcpConfig` entry to keep the `aiService` settings grouped.

#### `src/shortcuts/ai-service/ai-process-manager.ts` — Add server sync hooks

Add an optional `setServerClient(client: ServerClient)` method and a private `serverClient` field. Wire up the event listener inside this method:

```typescript
private serverClient?: ServerClient;
private serverSyncDisposable?: vscode.Disposable;

setServerClient(client: ServerClient): void {
    this.serverSyncDisposable?.dispose();
    this.serverClient = client;
    this.serverSyncDisposable = this.onDidChangeProcesses((event) => {
        if (!this.serverClient) { return; }
        const ws = getWorkspaceInfo();
        if (!ws) { return; }
        switch (event.type) {
            case 'process-added':
                if (event.process) {
                    this.serverClient.submitProcess(event.process, ws);
                }
                break;
            case 'process-updated':
                if (event.process) {
                    this.serverClient.updateProcess(event.process.id, event.process);
                }
                break;
            case 'process-removed':
                if (event.process) {
                    this.serverClient.removeProcess(event.process.id);
                }
                break;
            case 'processes-cleared':
                // Batch clear handled by server workspace endpoint
                break;
        }
    });
}
```

- Add `this.serverSyncDisposable` to the existing `dispose()` method.
- No changes to any existing method signatures or event firing.

#### `src/extension.ts` — Initialize server client on activation

During activation, after AIProcessManager is initialized:

1. Read `workspaceShortcuts.aiService.server.url` from settings.
2. If non-empty and `autoSync` is true, create `ServerClient` and call `aiProcessManager.setServerClient(client)`.
3. Call `client.registerWorkspace(getWorkspaceInfo())` (fire-and-forget).
4. Register a `vscode.workspace.onDidChangeConfiguration` listener to recreate/dispose client when URL changes.
5. Register `shortcuts.aiService.openDashboard` command — opens `${serverUrl}` in external browser via `vscode.env.openExternal`.
6. Register `shortcuts.aiService.configureServer` command — shows InputBox for URL, writes to settings.
7. Create a status bar item (priority 100, alignment left):
   - Text: `$(globe) AI Server` when connected; hidden when no server configured.
   - Tooltip: connection status + URL.
   - Command: `shortcuts.aiService.openDashboard`.

## Implementation Notes

- `ServerClient` must strip `childProcess` from the AIProcess body before serializing to JSON (it contains circular refs and is irrelevant to the server). Use the existing `serializeProcess()` helper from `pipeline-core`.
- The `healthCheck()` method is used once at startup and then on each back-off retry to decide whether to flush the queue.
- Status bar updates are driven by a simple boolean `connected` flag toggled inside `ServerClient`; expose via a `readonly onDidChangeConnection: vscode.Event<boolean>` so `extension.ts` can update the status bar.
- All HTTP requests use a 5-second timeout to avoid blocking the queue flush loop.
- Request bodies are JSON with `Content-Type: application/json`.

## Tests

All tests go in `src/test/suite/server-client.test.ts` (Mocha, matching existing extension test pattern).

| # | Test | Asserts |
|---|---|---|
| 1 | ServerClient serializes and submits process | `submitProcess` builds correct POST body with `workspaceId` field and calls internal `enqueue` |
| 2 | ServerClient handles server unavailability | Queue grows; no thrown errors; public method resolves immediately |
| 3 | Workspace ID generation is deterministic | Same `fsPath` → same 16-char hex ID across calls |
| 4 | Workspace ID differs for different paths | Two distinct paths produce different IDs |
| 5 | Queue flushes on reconnect | Simulate: enqueue 3 items → fail → succeed → assert queue empty |
| 6 | Queue drops oldest when full | Enqueue 501 items with max 500 → first item dropped |
| 7 | Extension works when server URL is empty | `setServerClient` never called; all AIProcessManager operations succeed unchanged |
| 8 | `setServerClient` can be called multiple times | Previous disposable is cleaned up; no duplicate event listeners |
| 9 | Status bar hidden when no server URL | Status bar item `.hide()` called |
| 10 | `openDashboard` command opens correct URL | Spy on `vscode.env.openExternal` |

## Acceptance Criteria
- [ ] `ServerClient` class created with all 6 HTTP methods
- [ ] Zero new npm dependencies added
- [ ] `workspace-identity.ts` exports `WorkspaceInfo` type and `getWorkspaceInfo()` function
- [ ] AIProcessManager fires existing events → ServerClient receives and enqueues them
- [ ] Queue bounded at 500 items with oldest-drop policy
- [ ] Exponential back-off from 1s to 30s cap on server failure
- [ ] Extension activates and operates normally when `server.url` is empty string
- [ ] Extension activates and operates normally when server is unreachable
- [ ] Two new VS Code settings registered in `package.json`
- [ ] `openDashboard` and `configureServer` commands registered
- [ ] Status bar item shows/hides based on server configuration
- [ ] All new tests pass; all existing 6900+ extension tests unaffected

## Dependencies
- Depends on: Commits 001–007 (server REST API must exist for integration, but client is testable in isolation with mocks)
- Depended on by: Commit 009+ (WebSocket upgrade, bidirectional sync)
