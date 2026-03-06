# Plan: Double-Click Markdown File → Opens Larger Dialog

## Problem

In the CoC SPA Tasks panel, **single-clicking** a markdown file in the task tree opens an inline `TaskPreview` panel beside the tree. There is **no double-click behavior** — the user wants double-clicking a markdown file to open the **full-screen `MarkdownReviewDialog`** (95vw × 92vh modal), the same dialog that already appears when clicking a file path link in chat.

Today, two separate surfaces reuse `MarkdownReviewEditor` but have disconnected entry points:

| Surface | Trigger | Opens |
|---------|---------|-------|
| Tasks tree single-click | `handleFileClick()` → `setOpenFilePath(path)` | Inline `TaskPreview` panel |
| Chat file-path link click | `coc-open-markdown-review` CustomEvent → `App.tsx` listener | `MarkdownReviewDialog` modal |

The user wants a **third trigger** (double-click in tasks tree) that reuses the chat's dialog path.

---

## Proposed Approach

**Reuse the existing `coc-open-markdown-review` CustomEvent mechanism.** On double-click of a file item in the tasks tree, dispatch the same event that chat file-path links use. `App.tsx` already listens for this event and opens `MarkdownReviewDialog` — no changes needed there.

### Flow

```
TaskTree file item double-click
  → dispatch CustomEvent('coc-open-markdown-review', { detail: { filePath } })
  → App.tsx listener (already exists)
  → setReviewDialog({ open: true, wsId, filePath, ... })
  → <MarkdownReviewDialog> renders with <MarkdownReviewEditor>
```

---

## Key Files

| File | Role | Change Needed |
|------|------|---------------|
| `packages/coc/src/server/spa/client/react/tasks/TaskTreeItem.tsx` | Renders each tree item | Add `onDoubleClick` prop + handler |
| `packages/coc/src/server/spa/client/react/tasks/TaskTree.tsx` | Tree container, passes handlers to items | Wire double-click handler that dispatches event |
| `packages/coc/src/server/spa/client/react/shared/MarkdownReviewDialog.tsx` | Full-screen dialog | No changes needed |
| `packages/coc/src/server/spa/client/react/App.tsx` | Event listener for `coc-open-markdown-review` | No changes needed |
| `packages/coc/src/server/spa/client/react/shared/file-path-preview.ts` | Dispatches same event from chat | No changes (reference only) |

---

## Tasks

### 1. Add `onDoubleClick` handler to `TaskTreeItem`

**File:** `TaskTreeItem.tsx`

- Accept an optional `onDoubleClick?: (path: string) => void` prop on the component
- On the `<li>` element that wraps each file item (line ~200), add an `onDoubleClick` handler
- Only fire for file items (not folders) — check `!isFolder` before calling the prop
- The handler should call `props.onDoubleClick(path)` when the item is a file

### 2. Wire double-click in `TaskTree` to dispatch `coc-open-markdown-review`

**File:** `TaskTree.tsx`

- Create a `handleFileDoubleClick(path: string, colIndex: number)` callback
- Resolve the full/absolute path for the file (the tasks API uses relative paths; the event handler in `App.tsx` resolves workspace via `resolveWorkspaceForPath` which needs an absolute path — OR pass the relative path and let the resolver handle it)
- Dispatch: `window.dispatchEvent(new CustomEvent('coc-open-markdown-review', { detail: { filePath: absolutePath } }))`
- Pass `handleFileDoubleClick` as `onDoubleClick` prop to each `<TaskTreeItem>`

### 3. Verify workspace resolution works for task-relative paths

**File:** `App.tsx` (lines 266-301)

- The existing `coc-open-markdown-review` listener uses `resolveWorkspaceForPath()` to find the workspace, then `toTaskRelativePath()` to convert back to a relative path for the tasks API
- Verify this works correctly when the event originates from the tasks tree (where the path is already relative to the workspace `.vscode/tasks/` directory)
- If the tree only has relative paths, the handler may need to prepend the workspace root before dispatching, OR the App.tsx handler needs a fallback for relative paths
- If adjustment is needed, add `wsId` to the event detail so App.tsx can skip workspace resolution

### 4. Handle single-click vs double-click interaction

- Browser fires `click` before `dblclick` — single-click will still fire and open the inline preview
- This is acceptable UX: single-click selects + shows inline preview, double-click additionally opens the full dialog
- No debouncing needed — both behaviors complement each other

### 5. Add tests

- Add a test in the tasks tree test file that double-clicking a file item dispatches the `coc-open-markdown-review` event
- Verify the event detail contains the correct file path
- Verify folders do not trigger the double-click handler

---

## Edge Cases

- **Folders:** Double-click on a folder should NOT open the dialog — only files
- **Non-markdown files:** The `MarkdownReviewDialog` uses `MarkdownReviewEditor` which renders markdown. For non-`.md` files it may show source-only mode, which is still useful
- **Already-open dialog:** If the dialog is already open and user double-clicks another file, the event should update the dialog to show the new file (App.tsx `setReviewDialog` already handles this by updating state)
- **Path format:** Ensure Windows backslash paths are handled (the event listener in App.tsx already uses `normalizePath()`)

---

## Estimated Scope

~30 lines of code across 2 files (`TaskTreeItem.tsx`, `TaskTree.tsx`). No new components, no new APIs, no new event types. Pure reuse of existing infrastructure.
