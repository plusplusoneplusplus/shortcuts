# Fix: Generate Button Should Not Jump to Tasks Tab

## Problem

When clicking the "✨ Generate" button in the repo detail header, the UI forcibly switches to the Tasks tab before opening the Generate dialog. This is disruptive — users may be on the Queue tab (or any other tab) and lose their context.

The same issue does **not** apply to the post-success Queue tab switch, which is intentional (navigating to where the queued item will appear).

## Root Cause

In `RepoDetail.tsx` line 69–72, `handleOpenGenerateDialog` explicitly switches to the Tasks tab:

```tsx
const handleOpenGenerateDialog = useCallback((targetFolder?: string) => {
    if (activeSubTab !== 'tasks') switchSubTab('tasks');  // ← unwanted tab switch
    setGenerateDialog({ open: true, targetFolder });
}, [activeSubTab]);
```

The Generate dialog is a **modal overlay** — it doesn't need the Tasks tab to be active underneath it.

## Approach

Remove the `switchSubTab('tasks')` call from `handleOpenGenerateDialog`. The dialog is a modal and works independently of the active tab. After successful generation, the existing logic in `GenerateTaskDialog` already switches to the Queue tab (`SET_REPO_SUB_TAB`, `'queue'`), so the user lands in the right place.

Single-line change in one file.

## Todos

### 1. Remove tab switch from `handleOpenGenerateDialog`
- **File**: `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`
- **Lines**: 69–72
- Remove `if (activeSubTab !== 'tasks') switchSubTab('tasks');`
- The `activeSubTab` dependency in the `useCallback` deps array can also be removed since it's no longer used

### 2. Verify no regressions
- Build the SPA and confirm:
  - Generate dialog opens from any tab without switching
  - After successful generation, UI switches to Queue tab as before
  - Opening Generate from the Tasks tab still works normally
