# Plan: Fix "← Tasks" Back Navigation to Restore Folder Context on Mobile

## Problem

In the mobile SPA tasks tab, the folder tree (`TaskTree`) is **conditionally rendered** — it unmounts when a markdown file is open and remounts when the user clicks "← Tasks". Because React component state is lost on unmount, the Miller-column navigation state (`columns`, `activeFolderKeys`) resets every time `TaskTree` remounts.

Additionally, `initialParams` in `TasksPanel` is captured **once** at mount time from the URL hash (line 79):
```ts
const [initialParams] = useState(() => parseTaskHashParams(location.hash, wsId));
```
So when `TaskTree` remounts after clicking back, it receives stale `initialFolderPath`/`initialFilePath` props that no longer reflect the user's current navigation depth — causing it to render from the root.

### Root Cause Summary

| File | Issue |
|------|-------|
| `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` line 830 | `TaskTree` is conditionally rendered (`{(!isMobile || !openFilePath) && ...}`), so it unmounts when a file opens on mobile. |
| `TasksPanel.tsx` line 79 | `initialParams` is frozen at mount time; not re-evaluated when hash changes during navigation. |
| `TasksPanel.tsx` line 865 | Back button handler only calls `setOpenFilePath(null)` — no folder path restoration or URL update. |

---

## Proposed Fix

### Primary Fix — CSS hide/show instead of conditional unmounting (TasksPanel.tsx)

Replace the conditional render of the `TaskTree` wrapper with a CSS visibility approach so the component **stays mounted** and its internal `columns` / `activeFolderKeys` state is preserved:

```tsx
// BEFORE (unmounts TaskTree on mobile when file is open):
{(!isMobile || !openFilePath) && (
    <div className="...tree-container-classes...">
        <TaskTree ... />
    </div>
)}

// AFTER (keeps TaskTree mounted; CSS hides it on mobile when file is open):
<div
    className="...tree-container-classes..."
    style={isMobile && openFilePath ? { display: 'none' } : undefined}
>
    <TaskTree ... />
</div>
```

This preserves all Miller-column state across open/close cycles without any other state management changes.

### Secondary Fix — Update URL hash on back navigation (TasksPanel.tsx)

When the user clicks "← Tasks", update the URL hash back to the parent folder of the open file so the URL stays consistent with the visible tree state:

```tsx
// BEFORE:
onClick={() => setOpenFilePath(null)}

// AFTER:
onClick={() => {
    if (openFilePath) {
        const parentFolder = openFilePath.includes('/')
            ? openFilePath.split('/').slice(0, -1).join('/')
            : '';
        const encoded = parentFolder
            ? parentFolder.split('/').map(encodeURIComponent).join('/')
            : '';
        history.replaceState(
            null, '',
            `#repos/${encodeURIComponent(wsId)}/tasks${encoded ? '/' + encoded : ''}`
        );
    }
    setOpenFilePath(null);
}}
```

---

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` | 1. Convert conditional render of `TaskTree` container to CSS `display:none`. 2. Update "← Tasks" button `onClick` to also revert URL hash to parent folder. |

No changes needed to `TaskTree.tsx`, `TaskContext.tsx`, or any other files.

---

## Testing

1. **Mobile viewport** — Navigate into a nested folder (2+ levels deep), open a `.md` file, click "← Tasks". Verify the correct parent folder column is visible, not the root.
2. **URL hash** — After clicking back, verify the URL hash reflects the parent folder path, not the file path.
3. **Desktop** — Verify no regression: both panes are always visible on desktop; tree state is unaffected.
4. **Refresh with file hash** — Refresh the page with a file hash (`#repos/wsId/tasks/A/B/file.md`); the file should still open automatically on mount (existing `initialParams` path still works for initial load).
5. **Back multiple times** — Open file → back → click another file → back. Each time the correct folder context is shown.
