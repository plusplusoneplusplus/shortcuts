# Plan: Replace "New Chat (Project Root)" with "New Chat (Terminal)"

## Problem

The existing "New Chat (Project Root)" option still goes through `CopilotSDKService.sendMessage()` — it is not meaningfully different from "New Chat" (it only changes the working directory). The intended behaviour is to **replace it** with an option that spawns the `copilot` CLI directly in a terminal window, the same way the existing "Resume in Terminal" button works — but for a **fresh session**.

## Approach

**Replace**, not add. "New Chat (Project Root)" becomes **"New Chat (Terminal)"**:

- The `useProjectRoot` flag and the working directory override in the queue POST are **removed**
- Instead, clicking the option calls a new backend endpoint that spawns a terminal
- The **chat session list / sidebar does not know about it** — terminal sessions are fully external to CoC

Reuse and extend the existing `process-resume-handler.ts` infrastructure:
- `buildResumeCommand()` → add `buildFreshChatCommand()` (same logic, omit `--resume <sessionId>`)
- `launchResumeCommandInTerminal()` → add `launchFreshChatInTerminal()` (same spawn logic, different command)
- Add a new REST endpoint `POST /api/chat/launch-terminal`

Clicking "New Chat (Terminal)":
1. POSTs to `/api/chat/launch-terminal` with `{ workingDirectory: workspacePath }`
2. Shows inline success/error feedback in the top-bar area (toasts or brief status text)
3. Does **not** create a queue task, does **not** update any `newChatTrigger` state

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/process-resume-handler.ts` | Add `buildFreshChatCommand()`, `launchFreshChatInTerminal()`, and `registerFreshChatTerminalRoutes()` with `POST /api/chat/launch-terminal` |
| `packages/coc/src/server/index.ts` | Call `registerFreshChatTerminalRoutes()` after existing `registerProcessResumeRoutes()` |
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Replace "New Chat (Project Root)" item with "New Chat (Terminal)"; remove `useProjectRoot` from `newChatTrigger` state shape; add `handleLaunchInTerminal()` that POSTs to the new endpoint |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Remove `useProjectRoot` state and the `workingDirectory` override in the queue POST body |
| `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` | Remove the "New Chat (Project Root)" menu item; no terminal option added here |

## Todos

1. **`backend-endpoint`** — Add `buildFreshChatCommand`, `launchFreshChatInTerminal`, and `POST /api/chat/launch-terminal` in `process-resume-handler.ts`
2. **`backend-register`** — Register the new route in `packages/coc/src/server/index.ts`
3. **`ui-repochat`** — Remove `useProjectRoot` state and working-directory override in `RepoChatTab.tsx`
4. **`ui-sidebar`** — Remove "New Chat (Project Root)" from `ChatSessionSidebar.tsx` dropdown
5. **`ui-repodetail`** — Replace "New Chat (Project Root)" with "New Chat (Terminal)" in `RepoDetail.tsx`; add `handleLaunchInTerminal()`
6. **`tests`** — Unit-test `buildFreshChatCommand` and the new endpoint handler

## Dependency Order

```
backend-endpoint
  ├── backend-register
  ├── ui-repochat
  ├── ui-sidebar
  ├── ui-repodetail
  └── tests
```

## Key Design Decisions

- **Replace, not add** — only three options remain in the dropdown: "New Chat", "New Chat (Read-Only)", "New Chat (Terminal)"
- **No session list entry** — the terminal process is fully outside CoC's awareness; no chat session is created
- **Working directory**: always `workspacePath` (the repo root), resolved server-side from `workspaceId` as fallback
- **`useProjectRoot` removed entirely** — from `RepoChatTabProps`, `newChatTrigger` state, and `RepoChatTab` internals
- **Platform support**: Windows (`cmd.exe`), macOS (osascript → Terminal.app), Linux (gnome-terminal / xterm / alacritty) — same as existing resume handler
