---
"@plusplusoneplusplus/coc": minor
---

Make the unified right panel the workspace's only right panel

- Remove the `features.unifiedRightPanel` setting, its admin toggle, and the `unifiedRightPanelEnabled` runtime flag. A config still carrying the key loads fine — it is ignored, and no migration runs.
- Delete the legacy `WorkspaceRightDock` body (its view tabs, target picker, and direct Terminal / Explorer / Notes mounts). What is left of it is the state controller, now `useWorkspaceDock.ts`; the panel's open / width / target storage keys and formats are unchanged.
- Repo and repo-group workspaces render `UnifiedRightPanel` whenever the right panel slot is available (`features.splitWorkspacePanel` on a desktop viewport), with no flag branch.
- `ExplorerPanel` now requires an explicit `mode`; it no longer infers one from `onOpenFile`.

A stored right-dock view (`terminal` / `explorer` / `notes`) is no longer read; the panel restores its own tab set instead.
