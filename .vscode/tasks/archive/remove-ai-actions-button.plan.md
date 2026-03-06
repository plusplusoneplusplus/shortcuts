# Plan: Remove ✨ AI Actions Button and Move Options to Right-Click Menu

## Problem

Each file row in the Tasks panel shows a small ✨ button (`data-testid="ai-actions-trigger"`) that opens a two-item dropdown:
- **Follow Prompt** — opens `FollowPromptDialog`
- **Update Document** — opens `UpdateDocumentDialog`

The button adds visual clutter to the row. Both options should instead appear in the existing right-click context menu for file items, which already contains Copy Path, Archive, Rename, Move, Delete.

## Proposed Approach

1. Add the two AI actions as menu items in the file right-click context menu (in `TasksPanel.tsx`).
2. Wire them to the same dialogs already used by `AIActionsDropdown` — no dialog logic changes needed.
3. Remove the `<AIActionsDropdown>` component from `TaskTreeItem.tsx`.
4. Update / remove tests that assert the button's presence and replace with tests for the context menu entries.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` | Add "Follow Prompt" and "Update Document" items to the **file** context menu builder. Wire to existing dialog state (`showFollowPromptDialog`, `showUpdateDocumentDialog`). |
| `packages/coc/src/server/spa/client/react/tasks/TaskTreeItem.tsx` | Remove `<AIActionsDropdown>` render (lines ~272-275). Remove the import if no longer used. |
| `packages/coc/src/server/spa/client/react/shared/AIActionsDropdown.tsx` | **Delete** — component is no longer used in the UI. Keep `FollowPromptDialog` and `UpdateDocumentDialog` if they are imported directly by `TasksPanel`. |
| `packages/coc/test/spa/react/AIActionsDropdown.test.tsx` | **Delete** — component is removed. |
| `packages/coc/test/spa/react/task-tree-item.test.tsx` | Remove assertions that the AI actions dropdown renders on file rows. |
| `packages/coc/test/e2e/ai-actions.spec.ts` | Rewrite to trigger the actions via right-click context menu instead of the ✨ button. |

## Detailed Steps

### 1. Update `TasksPanel.tsx` — file context menu

Locate the array/builder that produces file context menu items (around line 404–470). Append two new entries after the existing items:

```ts
{
  label: '✨ Follow Prompt',
  icon: '📝',
  onClick: () => {
    setFollowPromptTarget(selectedFilePath);
    setShowFollowPromptDialog(true);
  },
},
{
  label: '✨ Update Document',
  icon: '✏️',
  onClick: () => {
    setUpdateDocumentTarget(selectedFilePath);
    setShowUpdateDocumentDialog(true);
  },
},
```

The dialogs (`FollowPromptDialog`, `UpdateDocumentDialog`) are already rendered inside `TasksPanel`; only their trigger needs to move.

### 2. Update `TaskTreeItem.tsx` — remove button

Remove the block:
```tsx
{!isFolder && path && (
    <AIActionsDropdown wsId={wsId} taskPath={path} />
)}
```
Remove the import `AIActionsDropdown`.

### 3. Delete `AIActionsDropdown.tsx`

The component is now dead code. Delete it. Verify `FollowPromptDialog` and `UpdateDocumentDialog` are either:
- Already imported independently in `TasksPanel`, OR
- Need to be moved/re-exported from a new location.

### 4. Update tests

- Delete `packages/coc/test/spa/react/AIActionsDropdown.test.tsx`.
- In `task-tree-item.test.tsx`: remove any test that checks for `data-testid="ai-actions-trigger"` or `AIActionsDropdown` rendering.
- In `ai-actions.spec.ts`: update the E2E flow to right-click a file row and select "Follow Prompt" / "Update Document" from the context menu.

## Considerations

- **No logic change**: Dialogs, API calls, and state remain identical — only the entry point moves.
- **Context menu position**: The file context menu already has 6 items; adding 2 more is reasonable. A separator can be added before the AI items for grouping if desired.
- **Keyboard accessibility**: Right-click menus are accessible via Shift+F10; this is a net improvement over the ✨ button which had no keyboard shortcut.
- **Folder context menu**: Already has "Follow Prompt" and "Generate Task" items — no change needed there.

## Out of Scope

- Changes to `FollowPromptDialog` or `UpdateDocumentDialog` internals.
- Changes to any backend/API handlers.
- Adding AI actions to folder rows (already present).
