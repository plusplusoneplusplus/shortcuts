# Share AI Toolbar Buttons Between TaskPreview and MarkdownReviewDialog

## Problem
`MarkdownReviewEditor` is shared, but the "Follow Prompt" (📝) and "Update Document" (✏️)
AI toolbar buttons only exist in `TaskPreview`. `MarkdownReviewDialog` (chat popup) has no
AI buttons at all, even though it shows the same markdown files.

## Approach (Option A)
Move the AI button state + buttons + dialogs **into** `MarkdownReviewEditor` behind a
`showAiButtons` prop. Both consumers simply opt in with one prop — no local state duplication.

## Files to Change

| File | Change |
|------|--------|
| `shared/MarkdownReviewEditor.tsx` | Add `showAiButtons?` prop, move AI state+buttons+dialogs inside |
| `tasks/TaskPreview.tsx` | Remove local AI state, buttons, dialog JSX; add `showAiButtons={true}` |
| `processes/MarkdownReviewDialog.tsx` | Add `showAiButtons={true}` to the `<MarkdownReviewEditor>` call |

## Detailed Steps

### 1. Update `MarkdownReviewEditorProps` interface
Add two new optional props:
```ts
/** When true, renders Follow Prompt + Update Document AI buttons in the toolbar. */
showAiButtons?: boolean;
```
`taskName` can be derived internally from `filePath` (same logic already in TaskPreview):
```ts
const taskName = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? filePath;
```

### 2. Move AI state into `MarkdownReviewEditor`
Add inside the component body (guarded — only when `showAiButtons` is true):
```ts
const [aiDialogType, setAiDialogType] = useState<'follow-prompt' | 'update-document' | null>(null);
```

### 3. Move toolbar buttons into `MarkdownReviewEditor`
In the toolbar's `ml-auto` slot, prepend the two AI buttons **before** `toolbarRight` when
`showAiButtons` is true:
```tsx
{showAiButtons && (
  <>
    <Button variant="ghost" size="sm"
      data-testid="task-preview-follow-prompt"
      title="Follow Prompt"
      onClick={() => setAiDialogType('follow-prompt')}>📝</Button>
    <Button variant="ghost" size="sm"
      data-testid="task-preview-update-document"
      title="Update Document"
      onClick={() => setAiDialogType('update-document')}>✏️</Button>
    <span className="w-px h-4 bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center" aria-hidden="true" />
  </>
)}
{toolbarRight && <div className="ml-auto flex items-center">{toolbarRight}</div>}
```

### 4. Move dialogs into `MarkdownReviewEditor`
Add at the bottom of the component's return JSX (outside the scrollable area, as siblings):
```tsx
{showAiButtons && aiDialogType === 'follow-prompt' && (
  <FollowPromptDialog wsId={wsId} taskPath={filePath} taskName={taskName}
    onClose={() => setAiDialogType(null)} />
)}
{showAiButtons && aiDialogType === 'update-document' && (
  <UpdateDocumentDialog wsId={wsId} taskPath={filePath} taskName={taskName}
    onClose={() => setAiDialogType(null)} />
)}
```
Add imports: `FollowPromptDialog`, `UpdateDocumentDialog`, `Button`.

### 5. Simplify `TaskPreview`
- Remove `useState` for `aiDialogType`
- Remove `FollowPromptDialog` + `UpdateDocumentDialog` imports
- Remove the two AI buttons + separator from `toolbarRight` JSX (close button ✕ stays)
- Add `showAiButtons={true}` to `<MarkdownReviewEditor>`

### 6. Opt in `MarkdownReviewDialog`
- Add `showAiButtons={true}` to the `<MarkdownReviewEditor wsId={wsId} filePath={filePath} ...>` call

## Notes
- `toolbarRight` prop is kept as-is — the close button in TaskPreview still lives there
- The separator (`<span w-px .../>`) moves inside the editor so it appears between AI buttons and close button naturally
- `fetchMode` stays separate from `showAiButtons` — the dialog uses `fetchMode='auto'` and will now also show AI buttons
- No API changes needed; dialog components are reused as-is
