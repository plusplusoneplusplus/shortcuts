# Bug: Archiving a Chat Causes It to Be Pinned

## Problem

When a user archives a chat that is **not currently pinned**, the chat becomes pinned instead of simply being archived. This is a regression in the "archive" UX — archiving should never affect pin state for an unpinned session.

## Root Cause

### The wiring (`RepoChatTab.tsx` lines 77–78)

`useArchivedChats` accepts an `onUnpin` callback meant to auto-unpin a session when it gets archived (so a session can't be both pinned and archived simultaneously):

```ts
const { pinnedIds, togglePin } = usePinnedChats(workspaceId);
const { archiveSet, toggleArchive } = useArchivedChats(workspaceId, togglePin);
//                                                                    ^^^^^^^^^^
//                              togglePin passed directly as the onUnpin callback
```

### The toggle mis-fire (`useArchivedChats.ts` line 70–72)

When archiving, the hook calls `onUnpin(id)` unconditionally:

```ts
if (!isCurrentlyArchived && onUnpin) {
    onUnpin(id);   // <-- calls togglePin(id)
}
```

### Why it pins instead of unpins (`usePinnedChats.ts` line 56–57)

`togglePin` is a **toggle** — it adds the ID if not present, removes it if present:

```ts
const isPinned = prev.includes(id);
const next = isPinned ? prev.filter(p => p !== id) : [id, ...prev];
//                                                    ^^^^^^^^^^^^
//                    if NOT pinned → adds it (BUG: archiving pins the chat!)
```

When archiving an **unpinned** chat, `togglePin` finds the ID absent from `pinnedIds` and **adds** it — pinning the session.

## Acceptance Criteria

- [x] Archiving an **unpinned** chat does not pin it.
- [x] Archiving a **pinned** chat unpins it (existing intentional behavior preserved).
- [x] Unarchiving a chat does not change its pin state.
- [x] `useArchivedChats` does not expose a dependency on `togglePin`'s toggle semantics.

## Proposed Fix

### Option A — Guard in `useArchivedChats` (minimal, preferred)

Only call `onUnpin` when the session is actually pinned. This requires `useArchivedChats` to also receive the current pin state or an `isPinned` predicate:

**`RepoChatTab.tsx`** — pass `isPinned` as well:
```ts
const { pinnedIds, isPinned, togglePin } = usePinnedChats(workspaceId);
const { archiveSet, toggleArchive } = useArchivedChats(workspaceId, togglePin, isPinned);
```

**`useArchivedChats.ts`** — add `isPinnedFn` parameter and guard the call:
```ts
export function useArchivedChats(
    workspaceId: string,
    onUnpin?: (id: string) => void,
    isPinnedFn?: (id: string) => boolean,   // NEW
): UseArchivedChatsResult

// inside toggleArchive:
if (!isCurrentlyArchived && onUnpin) {
    // Only unpin if the session is actually pinned
    if (!isPinnedFn || isPinnedFn(id)) {
        onUnpin(id);
    }
}
```

### Option B — Dedicated `unpin` function in `usePinnedChats`

Add an `unpin(id)` function (no-op if already unpinned) alongside `togglePin` and pass that as `onUnpin` instead of `togglePin`.

Option A is preferred because it's minimal, backwards-compatible, and self-documenting.

## Subtasks

1. **Reproduce** — confirm the bug: open a chat page, have an unpinned session, archive it, observe it becomes pinned.
2. **Fix `useArchivedChats.ts`** — add optional `isPinnedFn` parameter; guard `onUnpin` call.
3. **Fix `RepoChatTab.tsx`** — pass `isPinned` from `usePinnedChats` as third argument to `useArchivedChats`.
4. **Unit test** — add/update tests for `useArchivedChats` covering: archive unpinned, archive pinned, unarchive.
5. **Manual verify** — exercise all four combinations: archive pinned, archive unpinned, unarchive pinned, unarchive unpinned.

## Affected Files

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/chat/useArchivedChats.ts` | Add `isPinnedFn` guard |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Pass `isPinned` to `useArchivedChats` |

## Notes

- The auto-unpin-on-archive behaviour is intentional design (a session should not be both pinned and archived). Only the case where the session is **not pinned** is broken.
- No backend changes needed — bug is entirely in frontend hook logic.
- Both `useArchivedChats` and `usePinnedChats` use fire-and-forget `PATCH /api/preferences`; fixing the guard means the spurious `pinnedChats` patch for unpinned sessions will also stop being sent.
