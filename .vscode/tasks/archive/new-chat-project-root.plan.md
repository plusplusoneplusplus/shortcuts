# Plan: Add "New Chat (Project Root)" Dropdown Option

## Problem

The "New Chat" split-button in the SPA (`RepoDetail.tsx`, `ChatSessionSidebar.tsx`)
currently shows two options:
- **New Chat** — starts a normal chat session
- **New Chat (Read-Only)** — starts a read-only chat session

Both options pass `workingDirectory: workspacePath` (`ws.rootPath`) in the queue
request, but this value is **silently ignored** for chat tasks.

### Root Cause

In `packages/coc/src/server/queue-executor-bridge.ts`, `getWorkingDirectory()` for
`isChatPayload` reads `task.payload.folderPath`, **not** `task.payload.workingDirectory`:

```ts
if (isChatPayload(task.payload)) {
    return task.payload.folderPath || this.defaultWorkingDirectory;  // ← uses folderPath
}
```

Meanwhile, `validateAndParseTask()` promotes `taskSpec.workingDirectory` →
`payload.workingDirectory`. Because the executor ignores this field for chat tasks,
all chat sessions fall back to `this.defaultWorkingDirectory` (the directory from
which `coc serve` was started), regardless of which workspace is selected.

## Goal

Add a **third dropdown option** — **"New Chat (Project Root)"** — that explicitly
launches the Copilot CLI with `ws.rootPath` as the working directory. The three
options become:

| Option | Type | CWD |
|--------|------|-----|
| New Chat | `chat` | global default (`defaultWorkingDirectory`) |
| New Chat (Read-Only) | `readonly-chat` | global default |
| **New Chat (Project Root)** | `chat` | `ws.rootPath` (project root) |

Existing option behaviour is **unchanged**.

## Approach

### 1 · `ChatPayload` — add `workingDirectory` field
**File:** `packages/coc-server/src/task-types.ts`

Add `workingDirectory?: string` to the `ChatPayload` interface so TypeScript and
downstream consumers can reference it explicitly.

### 2 · Executor fix — honour `workingDirectory` for chat
**File:** `packages/coc/src/server/queue-executor-bridge.ts`

Change the chat branch of `getWorkingDirectory()`:

```ts
if (isChatPayload(task.payload)) {
    // workingDirectory takes precedence over legacy folderPath
    return task.payload.workingDirectory
        || task.payload.folderPath
        || this.defaultWorkingDirectory;
}
```

This is a non-breaking change; tasks that don't set `workingDirectory` continue to
use `folderPath` or the global default.

### 3 · Trigger state — add `useProjectRoot` flag
**File:** `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

Extend the trigger state type:

```ts
{ count: number; readOnly: boolean; useProjectRoot: boolean }
```

Add a third handler and dropdown entry:

```tsx
onClick={() => { setNewChatDropdownOpen(false); handleNewChatFromTopBar(false, true); }}
>
    New Chat (Project Root)
```

### 4 · RepoChatTab — conditionally pass `workingDirectory`
**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

- Extend `newChatTrigger` prop type to carry `useProjectRoot`.
- In `handleNewChat(initialReadOnly, useProjectRoot)`:
  - Only include `workingDirectory: workspacePath` in the POST body when
    `useProjectRoot === true`.
  - Regular and read-only chats omit `workingDirectory`, preserving their current
    behaviour (global default CWD).

### 5 · ChatSessionSidebar — add third option
**File:** `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx`

- Update `onNewChat` prop signature:
  `onNewChat: (readOnly: boolean, useProjectRoot?: boolean) => void`
- Add the third dropdown button mirroring the style of the existing two.

### 6 · Tests
- `packages/coc/test/spa/react/RepoDetail.test.ts` — assert the third option renders
  and calls `handleNewChatFromTopBar(false, true)`.
- `packages/coc/test/spa/react/ChatSessionSidebar.test.ts` — assert third option
  renders and invokes `onNewChat(false, true)`.
- `packages/coc/test/server/queue-executor-bridge.test.ts` — assert that a chat task
  with `payload.workingDirectory` set returns that directory from `getWorkingDirectory`.

## Files Changed (summary)

| File | Change |
|------|--------|
| `packages/coc-server/src/task-types.ts` | Add `workingDirectory?: string` to `ChatPayload` |
| `packages/coc/src/server/queue-executor-bridge.ts` | Respect `payload.workingDirectory` for chat tasks |
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Third dropdown option + updated trigger type |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Handle `useProjectRoot`; send `workingDirectory` conditionally |
| `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` | Third dropdown option + updated callback signature |
| Test files (3) | Coverage for new option and executor fix |

## Out of Scope

- The VS Code extension's `copilot-cli-invoker.ts` `src/` heuristic — unrelated.
- `ChatSessionSidebar` in any context outside `RepoChatTab` (e.g., global chat page).
- Persisting the user's last-used chat mode.
