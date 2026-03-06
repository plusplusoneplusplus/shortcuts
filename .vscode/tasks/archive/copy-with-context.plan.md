# Plan: Copy Content with Context

## Problem

When reviewing a markdown task file in the `reviewEditorView` preview, there is no quick way to copy a selected passage together with its source file path. Users must manually combine the file path and content when sharing context in prompts or comments.

## Proposed Solution

Add a **"Copy with context"** item to the selection popup context menu (alongside the existing "Add Comment" and "Ask AI" items). When clicked, it writes the following to the clipboard:

```
<relative file path>
```
<selected text>
```
```

If no text is selected, the entire document content is used instead.

## Affected Files

| File | Change |
|------|--------|
| `src/shortcuts/markdown-comments/webview-content.ts` | Add `#contextMenuCopyWithContext` `<li>` to the `#contextMenu` HTML |
| `src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts` | Wire click handler; format and dispatch clipboard message |
| `src/shortcuts/markdown-comments/webview-scripts/vscode-bridge.ts` | Add `copyWithContext(text, filePath)` bridge function |
| `src/shortcuts/markdown-comments/review-editor-view-provider.ts` | Handle `copyWithContext` message → `vscode.env.clipboard.writeText()` |

## Implementation Steps

### 1. ✅ Add HTML menu item — `webview-content.ts`

In the `<ul>` inside `<div id="contextMenu">`, after the existing "Add Comment" item, add:

```html
<li id="contextMenuCopyWithContext" class="context-menu-item">
  <span class="context-menu-icon">$(copy)</span>
  Copy with context
</li>
```

### 2. ✅ Add bridge function — `vscode-bridge.ts`

```typescript
export function copyWithContext(selectedText: string, filePath: string): void {
    state.transport.postMessage({
        type: 'copyWithContext',
        selectedText,
        filePath,
    });
}
```

### 3. ✅ Wire click handler — `dom-handlers.ts`

Inside `initDomHandlers()` (or equivalent init function), after existing context menu item bindings:

```typescript
document.getElementById('contextMenuCopyWithContext')?.addEventListener('click', () => {
    const selection = window.getSelection()?.toString() ?? '';
    const text = selection.trim() || state.markdownContent || '';
    copyWithContext(text, state.filePath);
    contextMenuManager.hide();
});
```

Also ensure the item is shown/hidden in `handleContextMenu()` when a selection is active (mirror the "Add Comment" visibility logic).

### 4. ✅ Handle message — `review-editor-view-provider.ts`

In the `onDidReceiveMessage` switch, add:

```typescript
case 'copyWithContext': {
    const { selectedText, filePath } = message;
    const formatted = `${filePath}\n\`\`\`\n${selectedText}\n\`\`\``;
    await vscode.env.clipboard.writeText(formatted);
    vscode.window.showInformationMessage('Copied with context.');
    break;
}
```

## Out of Scope

- Tree-item right-click context menu (can be a follow-up)
- Language-aware code fences (e.g., auto-detecting `typescript` vs plain text)
- Keyboard shortcut binding

## Notes

- `state.filePath` is the workspace-relative path already injected via the `update` message from the extension host — no additional wiring needed to get the file path.
- The existing `shared-context-menu` CSS should style the new item consistently without extra changes.
- Clipboard write is handled on the extension host side (via `vscode.env.clipboard.writeText`) rather than `navigator.clipboard` for consistency with the rest of the codebase and to avoid potential browser clipboard permission issues in the webview.
