# Queue Buttons → Right-Click Context Menu

## Problem

The Queue tab in the CoC SPA dashboard shows inline action buttons (▲ Move Up, ⏬ Move to Top, ✕ Cancel) on every queued task item. With many queued tasks these buttons create visual clutter and make the list harder to scan. The user wants to move these actions behind a right-click context menu.

## Approach

Reuse the existing `ContextMenu` component from `tasks/comments/ContextMenu.tsx` (portal-based, viewport-clamped, dark/light theme support, keyboard navigation). Replace the inline buttons in `QueueTaskItem` with an `onContextMenu` handler that opens this menu.

## Scope

**In scope:**
- Remove inline ▲ ⏬ ✕ buttons from queued task items
- Add right-click context menu with "Move Up", "Move to Top", and "Cancel" actions
- Running tasks should only show "Cancel" in context menu
- Keep existing drag-and-drop reordering intact

**Out of scope:**
- Completed tasks section (no actions needed)
- Any server/API changes (handlers already exist)

## File Changes

### 1. `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

**a) Add context menu state** — Add `useState` for context menu position + task ID + status at the top of `RepoQueueTab`.

**b) Modify `QueueTaskItem`** — Remove the three inline `<button>` elements from the action div. Add an `onContextMenu` prop/handler on the `<Card>` that captures right-click position and opens the context menu.

**c) Render `ContextMenu`** — Conditionally render `<ContextMenu>` at the bottom of the component, building the `items` array dynamically based on task status:
  - Queued tasks: `[ { label: "Move Up", icon: "▲", onClick: handleMoveUp }, { label: "Move to Top", icon: "⏬", onClick: handleMoveToTop }, { separator: true }, { label: "Cancel", icon: "✕", onClick: handleCancel } ]`
  - Running tasks: `[ { label: "Cancel", icon: "✕", onClick: handleCancel } ]`

**d) Import `ContextMenu`** — Add import for `ContextMenu` and `ContextMenuItem` from `../tasks/comments/ContextMenu`.

### 2. Tests

Update or add tests in the existing test file for `RepoQueueTab` to verify:
- Inline buttons are no longer rendered
- Right-click on a queued task shows context menu with 3 actions
- Right-click on a running task shows context menu with only Cancel
- Clicking a context menu item calls the correct handler

## Tasks

1. ~~**remove-inline-buttons** — Remove the ▲ ⏬ ✕ inline buttons from `QueueTaskItem`~~
2. ~~**add-context-menu-state** — Add state variables for context menu (position, taskId, taskStatus) in `RepoQueueTab`~~
3. ~~**wire-context-menu-handler** — Add `onContextMenu` handler to `QueueTaskItem` Card element~~
4. ~~**render-context-menu** — Render `<ContextMenu>` conditionally with correct items based on task status~~
5. ~~**update-tests** — Update tests to cover the new right-click behavior~~

## Notes

- The existing `ContextMenu` component already handles viewport clamping, Escape-to-close, and click-outside-to-close — no need to reimplement.
- The `QueueTaskItem` `onClick` prop (for selecting a task to view details) must remain functional — only `onContextMenu` changes behavior.
- Drag-and-drop (`useQueueDragDrop` hook) is unrelated and should not be affected.
