# Move To Other Repo Instance — Implementation Plan

## Problem
Users with multiple local clones of the same git repository want to move task folders or individual markdown files between these clones from the Tasks panel context menu.

## Approach
Extend the **existing** `POST /api/workspaces/:id/tasks/move` endpoint with an optional `destinationWorkspaceId` field. Add a **"Move To Other Repo"** context menu item with a submenu listing sibling repo instances (same normalized remote URL).

## Backend Change (Minimal)

In `tasks-handler.ts`, the existing move handler gets ~15 lines added:

```
Body: { sourcePath, destinationFolder, destinationWorkspaceId? }
```

- When `destinationWorkspaceId` is absent → existing behavior (same workspace)
- When present → resolve destination against the target workspace's tasks folder
- `resolveAndValidatePath()` applied independently per workspace (no path traversal)
- `fs.promises.rename()` with EXDEV fallback (recursive copy + delete) for cross-drive moves

## Frontend Changes

1. **RepoDetail → TasksPanel**: Pass `repos: RepoData[]` prop
2. **TasksPanel**: Compute `siblingRepos` via `normalizeRemoteUrl()` (already exists in `repoGrouping.ts`)
3. **Context menus**: Add "Move To Other Repo" with `children` submenu (existing pattern from "Queue All Tasks") for both folder and file menus
4. **Action hooks**: Add `moveToOtherRepo()` calling existing move endpoint with `destinationWorkspaceId`

## Todos

1. **backend-extend-move** — Extend existing move endpoint to accept `destinationWorkspaceId`
2. **frontend-pass-repos** — Pass `repos` prop from RepoDetail to TasksPanel, compute sibling repos
3. **frontend-menu-items** — Add "Move To Other Repo" submenu to folder and file context menus
4. **frontend-api-call** — Add `moveToOtherRepo()` in useFolderActions and useFileActions hooks
5. **tests** — Backend: cross-workspace move, EXDEV fallback, collisions. Frontend: submenu rendering.

## Notes
- Reuse `normalizeRemoteUrl()` from `repoGrouping.ts` for sibling detection
- Reuse existing `ContextMenu` submenu pattern (`children` prop)
- Cross-drive moves need copy+delete fallback since `fs.rename` throws EXDEV across drives
- Hide/disable menu item when no sibling repos exist
