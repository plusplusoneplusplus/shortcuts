# Fix: Pin Chat from Chat Tab No Longer Works

## Problem

Pinning a chat session from the Chat tab is broken because the frontend hooks
(`usePinnedChats`, `useArchivedChats`) send and read `pinnedChats` / `archivedChats`
as flat `string[]`, but the backend stores and validates them as
`Record<string, string[]>` (keyed by workspace ID within `PerRepoPreferences`).

**Root cause:** Type mismatch between frontend and backend.

| | Frontend (`usePinnedChats.ts`) | Backend (`PerRepoPreferences`) |
|---|---|---|
| **Read** | `prefs?.pinnedChats ?? []` → expects `string[]` | Returns `Record<string, string[]>` |
| **Write** | `{ pinnedChats: next }` where `next: string[]` | Validation rejects arrays (`!Array.isArray`) |

When `togglePin` fires a PATCH with `{ pinnedChats: ['id-a', 'id-b'] }`:
1. Backend validation sees an array, drops the field entirely.
2. Response returns `{}` with no `pinnedChats`.
3. UI state appears updated locally but is never persisted.
4. On next reload, pins are gone.

`useArchivedChats.ts` has the identical bug for `archivedChats`.

## Chosen Fix

Update the **frontend** to use `workspaceId` as the inner key, matching the
existing backend `Record<string, string[]>` contract:

- **Read:** `prefs?.pinnedChats?.[workspaceId] ?? []`
- **Write:** `{ pinnedChats: { [workspaceId]: next } }`

This is the minimal change — the backend, its tests, and the disk format are
correct and untouched.

## Acceptance Criteria

1. After clicking the pin button, the chat session appears under "Pinned" on
   page reload (pins persist in `~/.coc/preferences.json`).
2. After unpinning, the session no longer appears under "Pinned" on reload.
3. PATCH `/api/workspaces/:id/preferences` response body includes `pinnedChats`
   with the updated IDs when at least one pin exists.
4. PATCH with an empty pin list removes `pinnedChats` from the response body.
5. Archive/unarchive works the same way (same fix applied to `useArchivedChats`).
6. All existing backend and frontend tests pass.
7. New unit tests cover: initial load reads workspace-keyed value; togglePin
   sends correct Record shape; read on empty preferences returns `[]`.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/chat/usePinnedChats.ts` | Fix read (`?.[workspaceId]`) and write (`{ [workspaceId]: next }`) |
| `packages/coc/src/server/spa/client/react/chat/useArchivedChats.ts` | Same fix for `archivedChats` |
| `packages/coc/test/spa/react/usePinnedChats.test.ts` | Update/add tests for correct Record shape |
| `packages/coc/test/spa/react/useArchivedChats.test.ts` | Update/add tests (if file exists) |

## Subtasks

1. **Fix `usePinnedChats.ts`** — update `setPinnedIds` read and `togglePin` write
2. **Fix `useArchivedChats.ts`** — update `setArchivedIds` read and `toggleArchive` write
3. **Update tests** — adjust `usePinnedChats.test.ts` assertions; add coverage for
   workspace-keyed read/write; check `useArchivedChats.test.ts`
4. **Verify** — run `npm run test:run` in `packages/coc` to confirm all tests green

## Notes

- The `workspaceId` passed to both hooks is the repo/workspace ID (same value
  used in the URL `/api/workspaces/:workspaceId/preferences`). Using it as the
  inner `Record` key preserves future multi-workspace isolation.
- The backend `isEmptyObjectBody` / `pinnedChats: {}` → delete logic is correct
  and does not need changes; sending `{ [workspaceId]: [] }` vs `{}` should still
  trigger the clear path (empty arrays are filtered out by validation).
  Test that `{ pinnedChats: { ws1: [] } }` results in `{}` (no `pinnedChats`).
- `useArchivedChats` also calls `onUnpin` on archive — that flow is unaffected by
  this fix.
- Relevant context from bug report: `lastModel: "claude-sonnet-4.6"`,
  `lastEffort: "medium"`, `recentFollowPrompts` contains `impl` skill — these are
  in the preferences response body and are unrelated to the pin bug.
