# Mobile Chat: Two-Level Navigation (Match Queue UX)

## Problem

On mobile, the **queue tab** uses a clean two-level navigation pattern: a full-screen task list that transitions to a full-screen detail view with a "← Back" button. The **chat tab** instead uses a slide-in sidebar (`ResponsiveSidebar`) triggered by a hamburger menu, which feels inconsistent and doesn't provide a clear "back to list" affordance.

## Proposed Approach

Replace the chat tab's `ResponsiveSidebar` overlay pattern on mobile with the same conditional full-screen rendering used by the queue tab — show either the session list **or** the conversation, never both simultaneously on mobile.

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Chat tab layout — currently uses `ResponsiveSidebar` on mobile |
| `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` | Session list sidebar component |
| `packages/coc/src/server/spa/client/react/shared/ResponsiveSidebar.tsx` | Slide-in drawer (to be **removed from chat**, kept for other consumers) |
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Reference implementation — `mobileShowDetail` pattern |
| `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` | Reference — "← Back" button implementation |

## Acceptance Criteria

1. **Mobile chat shows full-screen session list** when no session is selected (or user taps back).
2. **Selecting a session** transitions to a full-screen conversation view.
3. **"← Back" button** appears in the conversation header on mobile, returning to the session list.
4. **No slide-in sidebar / hamburger menu** on mobile for chat anymore.
5. **Desktop layout is unchanged** — sidebar + conversation side-by-side.
6. **Tablet layout** follows mobile (consistent with queue tab behavior via `useBreakpoint`).
7. **Deep-link support** — navigating to `#repos/{id}/chat/{sessionId}` opens the detail view directly; back button still works.
8. **New session creation** from the list view navigates to the conversation view.
9. **Existing tests pass** — no regressions in chat or queue functionality.

## Subtasks

### 1. Add `mobileShowDetail` state to `RepoChatTab`
- Add `const [mobileShowDetail, setMobileShowDetail] = useState(false)` mirroring queue pattern.
- When a chat session is selected (or created), set `mobileShowDetail = true` on mobile.
- When session selection is cleared, reset to `false`.

### 2. Refactor mobile layout in `RepoChatTab`
- Replace the `ResponsiveSidebar` conditional block (lines ~1060-1069) with a two-level conditional render:
  - `mobileShowDetail && selectedSessionId` → full-screen conversation view
  - Otherwise → full-screen session list (`sidebarContent`)
- Remove `mobileSidebarOpen` state and hamburger button references on mobile.

### 3. Add "← Back" button to chat conversation header
- In the mobile conversation view, add a back button styled consistently with queue's `QueueTaskDetail` back button.
- `onClick` → `setMobileShowDetail(false)`.
- Place in the chat header area (near session title / model selector).

### 4. Remove mobile hamburger menu from chat
- Remove the `☰ Sessions` button from the start screen header (lines ~744-752).
- Remove any other hamburger triggers specific to mobile chat.
- Clean up `mobileSidebarOpen` state if no longer used.

### 5. Handle deep links and session creation
- On initial load with a session ID in the URL hash, set `mobileShowDetail = true`.
- When "New Chat" is triggered from the list, auto-navigate to conversation view.

### 6. Update tests
- Update any existing tests that reference `chat-mobile-sessions-btn-start` or `ResponsiveSidebar` usage in chat.
- Add test coverage for the new back button (`chat-detail-back-btn`) and mobile list/detail toggle.

## Notes

- The `ResponsiveSidebar` component itself should **not** be deleted — it may be used elsewhere. Only remove its usage within `RepoChatTab` on mobile.
- The queue uses `useBreakpoint()` to get `isMobile` — chat already imports this, so no new dependency needed.
- No CSS animations in the queue pattern — it's instant conditional rendering. If a subtle transition is desired, it can be added later as a follow-up.
- The chat start screen (empty state when no session exists) should remain as-is but without the hamburger button.
