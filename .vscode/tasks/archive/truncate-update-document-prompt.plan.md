# Truncate Default Prompt in "Update Document" Dialog

## Problem
When clicking "Update Document" in the markdown review editor, the prompt textarea is pre-filled with a long default message:

```
Update the document at "<path>" based on the current state of the codebase. Review the task file and update its status, notes, and checklist items to reflect the latest changes.
```

Users frequently have to delete the tail portion to write a custom instruction, making the pre-filled text more of a burden than a convenience.

## Proposed Change
Shorten the default prompt to only include the path reference, leaving the user free to append their own instruction:

```
Update the document at "<path>"
```

## File to Change
`packages/coc/src/server/spa/client/react/shared/UpdateDocumentDialog.tsx`

Change the `setPrompt(...)` call so it only sets:
```ts
setPrompt(`Update the document at "${resolvedPath}" `);
```

## Acceptance Criteria
- [ ] Opening the "Update Document" dialog pre-fills the prompt with only `Update the document at "<path>" ` (trailing space so the cursor is positioned right after the path).
- [ ] No other dialog text or behaviour is changed.
- [ ] Existing tests (if any) that assert the old default prompt string are updated.

## Subtasks
1. Edit `UpdateDocumentDialog.tsx`: shorten `setPrompt(...)` default value.
2. Search for test files that assert the old prompt string and update them.

## Notes
- The trailing space after the closing `"` is intentional — it lets the user start typing immediately without adding a separator manually.
- No model, workspace selector, or submit logic needs to change.
