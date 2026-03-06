# Plan: Add "Goto File" Button for Plan.md in Tasks Panel

## Problem

When viewing a file preview tooltip in the CoC dashboard chat (hovering over a `.plan.md` file path link), there is no way to navigate directly to that file in the Tasks panel. The user must manually find the file in the tree. A "goto file" button in the tooltip header (same area as the filename and line count) should trigger the same navigation as the existing "Reveal in Panel" context menu action.

## Approach

Add a clickable icon/button to the file preview tooltip header that dispatches a new `coc-reveal-in-panel` custom event. `TasksPanel` listens for this event and calls `setNavigateToFilePath(relativePath)`, which the existing `TaskTree` useEffect already handles (expanding folders, selecting the file, updating URL hash).

The button should only appear for files whose absolute path contains `.vscode/tasks/` (i.e., files that exist in the tasks tree).

## Affected Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/file-path-preview.ts` | Add goto button to tooltip header; dispatch `coc-reveal-in-panel` event |
| `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` | Add `useEffect` listener for `coc-reveal-in-panel` event → call `setNavigateToFilePath` |
| `packages/coc/src/server/spa/client/tailwind.css` | Add CSS for the goto button (`.file-preview-goto-btn`) |

## Implementation Details

### 1. `file-path-preview.ts` — Add goto button to tooltip header

In the tooltip rendering section (~L317–324), modify the header HTML to include a goto button when the file path contains `.vscode/tasks/`:

```ts
// Detect if this is a tasks-panel file
const isTaskFile = data.path.includes('.vscode/tasks/');

// Extract relative path for the tasks tree (everything after ".vscode/tasks/<workspace>/")
// The tasks tree uses paths relative to the tasks root, e.g., "coc/chat/file.plan.md"
const taskRelativePath = isTaskFile
    ? data.path.split('.vscode/tasks/').pop() || ''
    : '';

const gotoBtn = isTaskFile
    ? `<button class="file-preview-goto-btn" data-task-path="${escapeHtml(taskRelativePath)}" title="Reveal in Tasks Panel">⬈</button>`
    : '';

tip.innerHTML =
    '<div class="file-preview-tooltip-header">' +
    `<span class="file-preview-tooltip-filename">${escapeHtml(data.fileName)}</span>` +
    `<span class="file-preview-tooltip-info">${gotoBtn}${data.lines.length} lines${escapeHtml(totalLabel)}</span>` +
    '</div>' +
    ...;
```

Add a click handler for the goto button (alongside existing click handlers ~L426):

```ts
document.body.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest('.file-preview-goto-btn');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const taskPath = btn.getAttribute('data-task-path');
    if (!taskPath) return;
    hideTooltip();
    window.dispatchEvent(new CustomEvent('coc-reveal-in-panel', {
        detail: { filePath: taskPath },
    }));
});
```

### 2. `TasksPanel.tsx` — Listen for `coc-reveal-in-panel` event

Add a `useEffect` in `TasksPanel` that listens for the new custom event and calls `setNavigateToFilePath`:

```ts
// Near the existing navigateToFilePath state (~L159)
useEffect(() => {
    const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.filePath) {
            onSearchClear();
            setNavigateToFilePath(detail.filePath);
        }
    };
    window.addEventListener('coc-reveal-in-panel', handler);
    return () => window.removeEventListener('coc-reveal-in-panel', handler);
}, [onSearchClear]);
```

### 3. `tailwind.css` — Style the goto button

Add minimal styling for the button to appear as a small inline icon in the tooltip header:

```css
.file-preview-goto-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    padding: 0 4px;
    opacity: 0.6;
    color: inherit;
    vertical-align: middle;
}
.file-preview-goto-btn:hover {
    opacity: 1;
}
```

## Path Conversion

- `file-path-preview.ts` has `data.path` as absolute (e.g., `D:/projects/shortcuts/.vscode/tasks/coc/chat/file.plan.md`)
- `TaskTree` expects relative paths (e.g., `coc/chat/file.plan.md`)
- Conversion: split on `.vscode/tasks/` and take the suffix

## Edge Cases

- File path doesn't contain `.vscode/tasks/` → no button shown
- File not found in tasks tree (e.g., deleted) → TaskTree useEffect gracefully breaks out of the loop (existing behavior at L143)
- Multiple workspaces → the relative path includes the workspace-level folder prefix, which TaskTree already handles

## Testing

- Verify the button appears only on file paths containing `.vscode/tasks/`
- Verify clicking the button navigates to the correct file in the Tasks panel (folder columns expand, file is selected)
- Verify the button doesn't appear for non-task files (e.g., source code files)
- Verify tooltip still works correctly (hover show/hide, click-to-open)
