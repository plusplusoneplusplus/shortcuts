---
status: pending
---

# 003: Props-only component tests

## Summary
Add real `@testing-library/react` render tests for `TaskTreeItem` and `FileMoveDialog` — two components that receive all data via props and require no context providers or fetch mocking. This validates the jsdom test infra from commit 001 works end-to-end with actual React component rendering.

## Motivation
`TaskTreeItem` and `FileMoveDialog` are pure props-driven components with zero context hooks and zero fetch calls, making them the simplest possible first-render test targets. Testing them proves the vitest + jsdom + RTL pipeline works before tackling context-dependent components. The existing string-scanning tests in `spa-tasks-miller-nav.test.ts` (lines 68–204) and `spa-file-context-menu.test.ts` (lines 59–80) only verify source text contains keywords — these new tests verify actual runtime behaviour.

## Changes

### Files to Create
- `packages/coc/test/spa/react/task-tree-item.test.tsx` — Render tests for the `TaskTreeItem` component covering all prop-driven branches: folder vs file rendering, context file hiding/opacity, checkbox for non-context files, comment count badge, queue running indicator, folder arrow/count badge, click and context-menu handlers, archived styling, status icons, tooltip content.
- `packages/coc/test/spa/react/file-move-dialog.test.tsx` — Render tests for the `FileMoveDialog` component covering: open/close visibility, null sourceName guard, destination list from folder tree (via `buildDestinations`), selecting a destination, confirm callback with correct path, cancel calls onClose, Escape closes dialog, error display on rejection, submitting state.

### Files to Modify
(none expected)

### Files to Delete
(none)

## Implementation Notes

### TaskTreeItem considerations

1. **Type guard dependencies** — `TaskTreeItem` imports `isContextFile`, `isTaskFolder`, `isTaskDocumentGroup`, `isTaskDocument` from `useTaskTree`. These are pure type guards based on property existence (`'children' in node`, `'documents' in node`, `'fileName' in node`), so test fixtures just need the right shape — no mocking needed.

2. **AIActionsDropdown child** — `TaskTreeItem` renders `<AIActionsDropdown wsId={wsId} taskPath={path} />` for non-folder items with a path. This uses internal state (`useState`, `useRef`) and `ReactDOM.createPortal`. It does NOT consume any context. It should render fine in isolation without mocking, but if it causes issues (e.g., portal target), a simple `vi.mock` returning a stub `<span data-testid="ai-actions" />` is the clean fix.

3. **Test fixtures** — Build typed `TaskNode` objects directly:
   - **Folder fixture:** `{ name: 'feature1', relativePath: 'feature1', children: [], documentGroups: [], singleDocuments: [] }` → triggers `isTaskFolder` path (has `children` + `singleDocuments`)
   - **Single document fixture:** `{ baseName: 'task', fileName: 'task.md', relativePath: 'sub', isArchived: false, status: 'pending' }` → triggers `isTaskDocument` path
   - **Document group fixture:** `{ baseName: 'design', documents: [{ baseName: 'design', docType: 'spec', fileName: 'design.spec.md', relativePath: '', isArchived: false }], isArchived: false }` → triggers `isTaskDocumentGroup` path
   - **Context file fixture:** `{ baseName: 'README', fileName: 'README.md', relativePath: '', isArchived: false }` → `isContextFile('README.md')` returns true

4. **`data-testid` pattern** — Component uses `data-testid={`task-tree-item-${displayName}`}` where `displayName` comes from `getDisplayName()`: folder.name, group.baseName, or document.baseName (falling back to fileName).

5. **Conditional rendering** — Context files return `null` when `showContextFiles === false` (line 99). When shown, they get `opacity-50` class and no checkbox. Archived items get `opacity-60 italic`. Folders get arrow `▶` and count badge but no checkbox.

6. **Click handlers** — `handleClick` calls `onFolderClick(item as TaskFolder)` for folders, `onFileClick(path)` for files. `handleCheckboxChange` calls `onCheckboxChange(path, checked)`. Context menu handler checks `isFolder && onFolderContextMenu` or `canOpenFileContextMenu && onFileContextMenu`. The `canOpenFileContextMenu` variable is `!isFolder && (!isContext || isNestedContextDoc)`.

7. **Queue indicator** — Renders `"in progress"` span with `animate-pulse` only when `queueRunning > 0`. Also renders folder queue badge when `isFolder && (folderQueueCount ?? 0) > 0`.

8. **Tooltip** — Built by `buildFileTooltip(path, commentCount, status)` — includes path, status, and comment count lines joined by `\n`. Applied as `title` attribute on the `<li>`.

### FileMoveDialog considerations

1. **Dialog uses `ReactDOM.createPortal`** — `Dialog.tsx` portals into `document.body`. In jsdom this works fine as long as `document.body` exists (it does by default). No special setup needed.

2. **`buildDestinations` dependency** — Imported from `FolderMoveDialog.tsx`. Already tested in the existing `FolderMoveDialog.test.tsx` suite. In `FileMoveDialog`, it's called with `'\0'` as the source path (sentinel that won't match anything), so all folders are included. The test tree fixture should have nested folders to verify depth indentation.

3. **"Tasks Root" prepended** — The component manually prepends `{ label: 'Tasks Root', relativePath: '', depth: 0 }` to the options list. Verify it always appears first with `data-testid="file-move-dest-root"`.

4. **Selection + confirm flow** — `useState('')` means default selection is Tasks Root (empty string). Clicking a destination button calls `setSelected(opt.relativePath)`. Clicking "Move" calls `onConfirm(selected)`. The `onConfirm` prop is `Promise<void>` — use `vi.fn().mockResolvedValue(undefined)` for success, `vi.fn().mockRejectedValue(new Error(...))` for error.

5. **Error state** — When `onConfirm` rejects, the error message is shown in `data-testid="file-move-error"`. The `submitting` state prevents double-clicks (button gets `loading={submitting}` which disables it via Button's `disabled={disabled || loading}`).

6. **Null sourceName guard** — If `sourceName` is null, the component returns null (line 50). Test this early-return.

7. **Existing test overlap** — `FolderMoveDialog.test.tsx` already has full RTL tests for the sibling component. Reuse the same `makeTree()` fixture pattern and test structure. `FileContextMenu.test.tsx` tests the integration path (TasksPanel → context menu → FileMoveDialog) but doesn't test FileMoveDialog in isolation.

### General patterns (match existing codebase conventions)

- Import from `'@testing-library/react'`: `render, screen, fireEvent, waitFor, cleanup`
- Use `afterEach(() => cleanup())` in every describe block
- Use `vi.fn()` for callback props
- Use `data-testid` attributes already in the components for queries
- Follow naming: `describe('ComponentName — aspect', () => { ... })`

## Tests

### task-tree-item.test.tsx

#### Folder rendering
- `renders folder with name, arrow indicator (▶), and md count badge`
- `renders folder icon 📁`
- `does not render checkbox for folders`
- `does not render AI actions dropdown for folders`
- `folder click calls onFolderClick with the folder item`
- `folder right-click calls onFolderContextMenu with coordinates`
- `folder renders folderQueueCount badge when > 0`
- `folder does not render folderQueueCount badge when 0 or undefined`

#### File (TaskDocument) rendering
- `renders file with name, checkbox, and AI actions area`
- `renders file icon 📝 for single documents`
- `renders checkbox for non-context file items`
- `checkbox checked state matches isSelected prop`
- `checkbox change calls onCheckboxChange with path and checked`
- `file click calls onFileClick with constructed path`
- `file right-click calls onFileContextMenu`

#### Document group rendering
- `renders document group with baseName and 📄 icon`
- `group click calls onFileClick using first document path`

#### Comment count badge
- `renders comment count badge when commentCount > 0`
- `does not render comment count badge when commentCount is 0`

#### Context file behaviour
- `returns null for context files when showContextFiles is false`
- `renders context file with opacity-50 when showContextFiles is true`
- `does not render checkbox for context files`
- `renders ℹ️ icon for context files`
- `does not fire onFileContextMenu for root-level context files`
- `fires onFileContextMenu for nested context.md (isNestedContextDoc)`

#### Queue running indicator
- `renders "in progress" badge when queueRunning > 0`
- `does not render queue indicator when queueRunning is 0`
- `queue indicator has animate-pulse class`

#### Status icons
- `renders ✅ icon for done status`
- `renders 🔄 icon for in-progress status`
- `renders ⏳ icon for pending status`
- `renders 📋 icon for future status`
- `renders no status icon when status is undefined`

#### Archived styling
- `renders archived file with opacity-60 and italic`
- `renders archive folder with opacity-60 and italic`

#### Tooltip
- `sets title attribute with path, status, and comment count`
- `title omits status line when status is undefined`

#### Shift+right-click
- `does not prevent default for Shift+contextmenu (native browser menu)`

### file-move-dialog.test.tsx

#### Visibility
- `renders dialog when open=true and sourceName is provided`
- `does not render when open=false`
- `does not render when sourceName is null`

#### Destination list
- `renders "Tasks Root" as first destination option`
- `renders folder destinations from tree prop`
- `renders nested folders with correct depth indentation`

#### Selection and confirm
- `default selection is Tasks Root (empty string) — confirm sends ""`
- `clicking a folder destination selects it (visual highlight)`
- `confirm calls onConfirm with the selected relativePath`
- `Move button shows loading state while onConfirm is pending`

#### Cancel and Escape
- `clicking Cancel calls onClose without calling onConfirm`
- `pressing Escape calls onClose`

#### Error handling
- `displays error message when onConfirm rejects`
- `error clears when selecting a new destination`

## Acceptance Criteria
- [ ] TaskTreeItem renders correctly for folder items (arrow, md count, 📁 icon, no checkbox)
- [ ] TaskTreeItem renders correctly for file items (checkbox, 📝 icon, AI actions area)
- [ ] TaskTreeItem renders document groups with 📄 icon
- [ ] TaskTreeItem shows/hides context files based on `showContextFiles` prop
- [ ] TaskTreeItem applies `opacity-50` class to context files when shown
- [ ] TaskTreeItem shows queue running indicator only when `queueRunning > 0`
- [ ] TaskTreeItem shows folder queue badge only when `folderQueueCount > 0`
- [ ] TaskTreeItem shows comment count badge only when `commentCount > 0`
- [ ] TaskTreeItem renders correct status icons (✅🔄⏳📋)
- [ ] TaskTreeItem click handlers fire with correct arguments
- [ ] TaskTreeItem context menu handlers fire with correct arguments
- [ ] FileMoveDialog displays folder destinations from tree prop
- [ ] FileMoveDialog calls `onConfirm` with correct relativePath on submit
- [ ] FileMoveDialog handles cancel, escape, and error states
- [ ] All tests run with jsdom environment and pass
- [ ] No context providers or fetch mocking needed (props-only)

## Dependencies
- Depends on: 001 (test infra: vitest jsdom config, @testing-library/react, jest-dom)

## Assumed Prior State
Commit 001 provides test infra (jsdom, jest-dom, test-utils). Commit 002 tested pure functions but is not a dependency for this commit. The existing `FolderMoveDialog.test.tsx` and `FileContextMenu.test.tsx` demonstrate the RTL patterns and tree fixture conventions to follow.
