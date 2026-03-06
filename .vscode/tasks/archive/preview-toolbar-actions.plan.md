# Plan: Add AI Action Buttons to Task Preview Toolbar

## Problem

When a markdown file is open in the CoC task panel's right-side preview, the "Follow Prompt" and "Update Document" AI actions are only accessible via right-clicking the file in the tree. Users want to trigger these actions directly from the preview panel without navigating back to the context menu.

## Proposed Approach

Add "Follow Prompt" and "Update Document" buttons to the **mode-toggle toolbar** inside the `MarkdownReviewEditor`, next to the existing Preview / Source tabs. The buttons should appear to the right of the Source button (and any Save button) but before the close (✕) button.

Since the `MarkdownReviewEditor` is a shared component (also used by process-conversation dialogs), the buttons should be injected **from `TaskPreview`** rather than hard-coded into the shared editor. This keeps the shared component clean.

### Design

```
[ Preview ] [ Source ] [ Save? ]   ... gap ...   [📝 Follow Prompt] [✏️ Update] [✕]
```

- Two small styled buttons with icons/labels
- Clicking them opens the same `FollowPromptDialog` / `UpdateDocumentDialog` used by the context menu
- The dialog state is managed locally in `TaskPreview` (it already has access to `wsId` and `filePath`)

## Todos

### 1. Add AI action buttons via `toolbarRight` in `TaskPreview.tsx`
**File:** `packages/coc/src/server/spa/client/react/tasks/TaskPreview.tsx`

- Import `FollowPromptDialog` and `UpdateDocumentDialog` from `../shared/`
- Add local state: `aiDialogType` (`'follow-prompt' | 'update-document' | null`)
- Derive `taskName` from `filePath` (extract filename without extension, same pattern used in `TasksPanel`)
- Expand the `toolbarRight` prop passed to `MarkdownReviewEditor` to include two action buttons before the existing close button:
  - **📝 Follow Prompt** — sets `aiDialogType` to `'follow-prompt'`
  - **✏️ Update Document** — sets `aiDialogType` to `'update-document'`
- Render `FollowPromptDialog` / `UpdateDocumentDialog` conditionally based on `aiDialogType`, passing `wsId`, `taskPath={filePath}`, `taskName`, and `onClose` to reset the state

### 2. Style the toolbar action buttons
**File:** Inline styles or existing utility classes in the toolbar

- Buttons should use `Button` component with `variant="ghost" size="sm"` (consistent with the existing close button)
- Add a visual separator (thin border or gap) between the AI action buttons and the close button
- On small screens / mobile, consider using icon-only buttons (drop labels) to save space

### 3. Add tests
**File:** New or existing test file for `TaskPreview`

- Test that "Follow Prompt" and "Update Document" buttons render in the toolbar
- Test that clicking each button opens the corresponding dialog
- Test that the dialog's onClose callback resets state

## Files to Modify

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/tasks/TaskPreview.tsx` | Add dialog state, action buttons in `toolbarRight`, render dialogs |

## Notes

- The `MarkdownReviewEditor` already supports a `toolbarRight` prop (rendered with `ml-auto` inside `.mode-toggle`). No changes needed to the shared component.
- `FollowPromptDialog` and `UpdateDocumentDialog` are already standalone dialog components accepting `wsId`, `taskPath`, `taskName`, `onClose`. They can be reused directly.
- The context menu actions in `TasksPanel` should remain as-is — this is an additive surface, not a replacement.
