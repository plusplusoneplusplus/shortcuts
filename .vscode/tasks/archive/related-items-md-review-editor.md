# Open Related Markdown Files with Review Editor

## Problem

When clicking on a related item file in the Tasks Viewer, markdown files open with the default VS Code editor (`vscode.open`) instead of the Markdown Review Editor (`reviewEditorView`).

**Current behavior:** All related files open with `vscode.open` command
**Expected behavior:** Markdown files (`.md`) should open with `reviewEditorView` for consistency with TaskItem and TaskDocumentItem

## Location

`src/shortcuts/tasks-viewer/related-items-tree-items.ts` - `RelatedFileItem` class (lines 66-107)

## Proposed Solution

Modify the `RelatedFileItem` constructor to check if the file is a markdown file and use `vscode.openWith` with `reviewEditorView` instead of `vscode.open`.

### Code Change

```typescript
// In RelatedFileItem constructor (around line 95-104)
if (item.path) {
    const filePath = vscode.Uri.file(
        item.path.startsWith('/') ? item.path : `${workspaceRoot}/${item.path}`
    );
    
    // Check if it's a markdown file
    const isMarkdown = item.path.toLowerCase().endsWith('.md');
    
    this.command = isMarkdown ? {
        command: 'vscode.openWith',
        title: 'Open Document',
        arguments: [filePath, 'reviewEditorView']
    } : {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [filePath]
    };
    this.resourceUri = filePath;
}
```

## Work Plan

- [x] Update `RelatedFileItem` class to detect markdown files
- [x] Use `vscode.openWith` with `reviewEditorView` for `.md` files
- [x] Keep `vscode.open` for non-markdown files
- [x] Add/update unit tests in `tasks-related-items.test.ts`
- [ ] Verify behavior manually

## Impact

- **Minimal change:** Only affects `RelatedFileItem` class
- **Backward compatible:** Non-markdown files continue to open normally
- **Consistent UX:** Aligns with TaskItem and TaskDocumentItem behavior

## References

- `TaskItem` (task-item.ts:26-30) - Uses `vscode.openWith` with `reviewEditorView`
- `TaskDocumentItem` (task-document-item.ts:33-37) - Uses `vscode.openWith` with `reviewEditorView`
