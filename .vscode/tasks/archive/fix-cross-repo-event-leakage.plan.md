# Fix: Cross-Repo Chat Event Leakage

## Problem

When multiple repository chats are open simultaneously in the CoC dashboard, users occasionally receive turn-completion updates and chat notifications that belong to a **different** repository's chat session. Switching between repos in the left sidebar can cause one repo's events to appear in another repo's chat view.

## Root Cause Analysis

### 1. No WebSocket Workspace Subscription from the Frontend
`useWebSocket.ts` only sends a `ping` on connect — it never sends `{ type: 'subscribe', workspaceId }`. The server's `broadcastProcessEvent` is designed to filter per-workspace _only if_ the client subscribed. Without a subscription every client receives **all** process/queue events from all workspaces.

**File:** `packages/coc/src/server/spa/client/react/hooks/useWebSocket.ts`
**File:** `packages/coc-server/src/websocket.ts` — `broadcastProcessEvent` (lines 234-254): clients with no `workspaceId` receive everything.

### 2. RepoChatTab is NOT Remounted on Workspace Switch
`RepoDetail.tsx` renders `<RepoGitTab key={ws.id} ...>` (remount on switch) but renders `<RepoChatTab workspaceId={ws.id} ...>` **without** a `key` prop. This means the chat tab is reused across workspace switches and relies solely on a cleanup `useEffect` (lines 349-359) to reset state. If the cleanup races against an in-flight queue event or SSE stream, stale `chatTaskId` from workspace A can leak into workspace B's view.

**File:** `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` (line ~483)

### 3. repoQueueMap Alias Resolution Can Lag or Fail
`App.tsx` handles `queue-updated` events by mapping `sha256 repoId → workspaceId` via `resolveWorkspaceIdForQueueMessage()` and stores the result in `repoIdAliasRef`. If a `queue-updated` arrives _before_ the alias is resolved (e.g., on reconnect), the dispatch uses only the raw sha256 key. `RepoChatTab` looks up `repoQueueMap[workspaceId]` — if the workspaceId key is not yet populated, the tab misses its own events. Worse, a stale alias could map the wrong repoId to the current workspace's key, injecting foreign events.

**File:** `packages/coc/src/server/spa/client/react/App.tsx` (lines 169-185)
**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` (line 364)

### 4. SSE Stream Lacks Workspace Validation
When `RepoChatTab` detects a running chat task in the queue and opens an SSE stream (`/processes/{pid}/stream`), it does **not** verify that the process belongs to the current `workspaceId`. A mis-keyed alias (root cause #3) or stale state (root cause #2) could cause the tab to stream from the wrong process.

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` (lines 377-421)

---

## Proposed Fix

### Task 1 — Add `key={ws.id}` to RepoChatTab in RepoDetail (Quick Win)
Mirror the pattern already used by `RepoGitTab`. Forces a clean remount when the active workspace changes, eliminating stale-state leakage entirely for root cause #2.

```tsx
// Before
<RepoChatTab workspaceId={ws.id} workspacePath={ws.rootPath} ... />
// After
<RepoChatTab key={ws.id} workspaceId={ws.id} workspacePath={ws.rootPath} ... />
```

### Task 2 — Send Workspace Subscription on Chat Mount
In `RepoChatTab` (or the parent), send `{ type: 'subscribe', workspaceId }` over the WebSocket when the chat tab mounts, and `{ type: 'unsubscribe' }` on unmount. This lets the server filter at the broadcast layer, preventing foreign events from ever reaching this client.

> Note: Only viable if the dashboard assumes **one active workspace at a time** (i.e., the same WS connection isn't used by both workspaces concurrently in the same tab). If both workspaces are simultaneously active (split-pane or background updates), this approach would suppress valid events for the non-subscribed workspace. In that case, prefer client-side filtering (Task 3) instead.

### Task 3 — Validate workspaceId on Queue-Triggered SSE Streams
Before opening an SSE stream in `RepoChatTab`, confirm that the triggering task's `workspaceId` matches the component's `workspaceId` prop. This guards against mis-keyed aliases (root cause #3).

```typescript
const hasChatTask = [...(repoQueue.running ?? []), ...]
  .filter(t => t.type === 'chat' && (!t.workspaceId || t.workspaceId === workspaceId))
  .some(Boolean);
```

### Task 4 — Harden alias resolution in App.tsx
Ensure that when `resolveWorkspaceIdForQueueMessage()` fails (returns undefined/null), the queue dispatch uses **only** the raw sha256 key and does NOT overwrite an existing workspaceId key with stale data. Add a guard so the alias ref is never updated with a bad value.

---

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Add `key={ws.id}` to `<RepoChatTab>` |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Filter queue tasks by workspaceId before streaming |
| `packages/coc/src/server/spa/client/react/App.tsx` | Guard alias resolution to prevent bad overwrites |
| `packages/coc/src/server/spa/client/react/hooks/useWebSocket.ts` | (Optional) Expose subscribe/unsubscribe helpers |

---

## Out of Scope

- Changes to `coc-server` WebSocket broadcast logic (server already supports workspace filtering; the bug is entirely on the client side)
- Multi-workspace simultaneous view support (current UX shows one workspace at a time)
