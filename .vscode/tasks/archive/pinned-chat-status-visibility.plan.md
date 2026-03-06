# Pinned Chat Status Visibility

## Problem

In the CoC Chat sidebar, pinned chats replace the status icon (🔄 ✅ ❌ ⏳) with the pin icon (📌). This makes it impossible to tell at a glance whether a pinned chat is still running, completed, or failed — which is the exact information users want most for chats they've pinned.

## Proposed Approach

Show **both** the status icon and the pin indicator for pinned cards. The pin button moves to the trailing end of the title row (consistent with how unpinned cards show it on hover), freeing the leading slot for the status icon.

---

## UI Specification

### Current Layout (pinned card)
```
[ 📌 ] [ title text .......................... ]
       [ 3 turns · just now                    ]
```

### Proposed Layout (pinned card)
```
[ 🔄 ] [ title text .................. ] [ 📌 ]
       [ 3 turns · just now               ]
```

- **Leading slot** — always shows `statusIcon(session.status)` (same as non-pinned cards)
- **Trailing slot** — shows the active pin button (📌, blue `#0078d4`, `title="Unpin chat"`) permanently visible (not hover-gated)
- The hover-only grey pin button (currently on non-pinned cards) is unchanged

### Status Icon Reference
| Status | Icon | Meaning |
|--------|------|---------|
| `running` | 🔄 | Chat is actively processing |
| `completed` | ✅ | Chat finished successfully |
| `failed` | ❌ | Chat failed / expired |
| `cancelled` | 🚫 | Chat was cancelled |
| `queued` | ⏳ | Chat is waiting to start |
| _(unknown)_ | _(empty)_ | No icon shown |

---

## File Changes

### 1. `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx`

**Lines 152–181** — `renderCard()` title row.

Replace the ternary that picks *either* pin button *or* status icon with logic that always renders the status icon in the leading slot, and moves the active-pin button to the trailing slot:

```tsx
// BEFORE (lines 152–181)
<div className="flex items-start gap-1.5 text-sm md:text-xs ...">
    {isPinned ? (
        <button className="flex-shrink-0 text-[#0078d4] ..." ...>📌</button>
    ) : (
        <span className="flex-shrink-0">{statusIcon(session.status)}</span>
    )}
    {/* unread dot */}
    <span className="truncate">…title…</span>
    {!isPinned && onTogglePin && (
        <button className="… opacity-0 group-hover:opacity-100 …" title="Pin chat" …>📌</button>
    )}
</div>

// AFTER
<div className="flex items-start gap-1.5 text-sm md:text-xs ...">
    <span className="flex-shrink-0">{statusIcon(session.status)}</span>
    {/* unread dot — unchanged */}
    <span className="truncate">…title…</span>
    {isPinned && onTogglePin && (
        <button
            className="flex-shrink-0 ml-auto text-[#0078d4] cursor-pointer"
            title="Unpin chat"
            data-testid="pin-icon-active"
            onClick={(e) => { e.stopPropagation(); onTogglePin(session.id); }}
        >📌</button>
    )}
    {!isPinned && onTogglePin && (
        <button
            className={cn(
                'flex-shrink-0 ml-auto transition-opacity text-[#848484] hover:text-[#0078d4] cursor-pointer',
                isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
            title="Pin chat"
            data-testid="pin-icon-hover"
            onClick={(e) => { e.stopPropagation(); onTogglePin(session.id); }}
        >📌</button>
    )}
</div>
```

**Key delta:** remove the `isPinned` ternary at the leading slot; move the active-pin `<button>` from the leading slot to the trailing slot (after the title `<span>`), keeping `ml-auto`.

---

## Tests

No existing test file for `ChatSessionSidebar` was found. A new test file should be created:

**`packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.test.tsx`**

Cover these cases:
1. Non-pinned card with `status='running'` → leading icon is 🔄, no pin icon visible
2. Pinned card with `status='running'` → leading icon is 🔄 AND trailing pin button (📌, `data-testid="pin-icon-active"`) is visible
3. Pinned card with `status='completed'` → leading icon is ✅ AND trailing pin button visible
4. Non-pinned card hover → grey pin button (`data-testid="pin-icon-hover"`) appears
5. Clicking trailing pin button on pinned card calls `onTogglePin` with correct id

---

## Out of Scope

- No changes to `statusIcon()` in `format.ts`
- No changes to `usePinnedChats.ts` or server-side code
- No changes to non-chat sidebar components
