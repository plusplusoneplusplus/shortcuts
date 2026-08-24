# Dashboard SPA — Remote-first shell

How the dashboard presents workspaces that live on another CoC server: the feature
gate, the three top-row headers, the scope switcher, repo groups, and remote workspace
aggregation. Which server a given request actually reaches is
[clone-routing.md](clone-routing.md).

## Feature gate

`useRemoteShellEnabled()` (`hooks/feature-flags/useRemoteShellEnabled.ts`) reads the
live `features.remoteShell` admin flag (runtime flag `remoteShellEnabled`,
`isRemoteShellEnabled()` in `utils/config.ts`). It is a global admin setting toggled at
**Admin → Configure → Features → Remote-first shell** (`toggle-remote-shell-enabled`),
defined once in `ADMIN_SETTING_DEFINITIONS`. Enabled by default, desktop-only, takes
effect on reload.

## Shell headers

`TopBar` renders one of three top rows.

### RemoteShellHeader

Renders when `remoteShellEnabled`, the active tab is `repos`, a real repo is selected,
and the viewport is not mobile.

`RemoteScopeCluster` shows a boxed current-remote chip plus Work Items / Pull Requests
pills. The chip opens a dropdown with recent remotes from the global preference
`recentRemotes` (MRU keys are `groupKey(group)`, capped at 8), a default-group fallback
before any MRU exists, search across all remotes, a Show all overflow, and add actions
for Add workspace folder (`AddFolderDialog`), Add specific repository (`AddRepoDialog`),
and Clone repository (`CloneRepoDialog`). Selecting a remote records it in the MRU and
picks that remote's remembered clone, otherwise the first local-first clone.

`WorkspaceTabsCluster` carries the clone switcher, clone popover, clone-scoped tabs,
overflow menu, repo info/remove dialogs, and toasts in the same row. `TopBar` also
renders `header-new-btn` as the first right-side action, before the WebSocket status
pill, opening the enqueue dialog for the active clone. `ReposView` renders a
`chromeless` `RepoDetail`.

### VirtualWorkspaceShellHeader

Renders when `remoteShellEnabled`, desktop, tab is `repos`, and the selected workspace
is virtual (`my_work` with My Work enabled, `my_life` with My Life enabled). Virtual
workspaces have no repo or git context, so they cannot flow through
`RemoteScopeCluster` / `WorkspaceTabsCluster`. Instead they describe themselves with a
`VirtualWorkspaceHeaderConfig` (`MY_WORK_HEADER_CONFIG` / `MY_LIFE_HEADER_CONFIG`,
exported from `MyWorkView` / `MyLifeView`): identity chip + sub-tabs
(Notes/Activity/Git/Schedules/Settings) + actions (Sync / Generate Summary). It mirrors
`RemoteShellHeader`'s visual shell and reuses `useVirtualWorkspaceHeader` for sub-tab
visibility, active tab, navigation, and actions.

The in-body variant `VirtualWorkspaceInlineHeader` renders inside `MyWorkView` /
`MyLifeView` in the classic shell and on mobile, where the TopBar header does not
apply; the view gates it on `!(remoteShell && !isMobile)`.

### RepoTabStrip fallback

When `features.remoteShell` is on but neither a real repo nor a virtual workspace can
back a header — a fresh desktop window with no selection, or any tab other than Repos —
`TopBar` falls back to the classic `RepoTabStrip`, so the top row stays consistent
across every page and repository navigation is always visible.

## Scope slide switcher

`ScopeSlideSwitcher` is gated by the experimental `features.scopeSwitcher` admin flag
(runtime flag `scopeSwitcherEnabled`, `isScopeSwitcherEnabled()` in `utils/config.ts`,
live hook `useScopeSwitcherEnabled`; default on; remote-first desktop shell only).
`E2E_SERVER_CONFIG_YAML` pins it off.

With it on, `TopBar` replaces the standalone My Work / My Life toggles and the identity
chips inside both header variants with one sliding segmented control —
`[💼 My Work] [🏠 My Life] [● workspace ⧉N ▾]` (`data-testid="scope-switcher"`, segments
`scope-segment` with `data-scope="work|life|workspace"`, animated thumb measured via
refs plus `ResizeObserver`).

The workspace segment embeds `WorkspaceIdentityChip`: status dot, provider badge,
remote name, `⧉N` clone badge, and a chevron opening `RepoPickerPopover` plus
add/clone dialogs. Its optional `groupIdentity={{ id, name }}` prop swaps repo identity
for a repo-group virtual workspace's — 🗂️ plus group name, neutral dot, no provider
badge, no `⧉N`, since none of those describe a group — and adds `data-repo-group-id`,
kept separate from `data-remote-key` (which means git-remote `RepoGroup` clustering).

The chip was extracted from `RemoteScopeCluster`, which now renders it itself unless
`hideIdentity` is set; `RemoteShellHeader` and `VirtualWorkspaceShellHeader` forward
`hideIdentity` so identity renders exactly once. Virtual-scope navigation (`goToMyWork`
/ `goToMyLife`, saved-note-path restore) lives in the shared `hooks/useScopeNavigation.ts`,
used by both the switcher and the legacy toggles.

## Shared shell model

`shellModel.ts` and `repoGrouping.ts` hold the shared behavior. Aggregated remote
checkouts fold into the matching local origin's tab by normalized git URL; a
remote-only repo gets its own group. `groupReposByRemote` sorts group clones
**local-first**, so the default clone is local when one exists. `partitionShellTabs`
keeps Work Items and Pull Requests remote-scoped.

`computeCloneStatusMap` and `cloneStatusColor` drive clone dots: local clones stay
queue-derived, while remote clones blend connection-first via `blendRemoteCloneStatus`
(`offline`/`failed` → grey offline, `connecting`/not-yet-online → blue connecting,
online → remote queue state). Offline remote rows stay visible but disabled and greyed
with `data-offline="true"` and `clone-offline-badge`; online and connecting rows stay
interactive. Clone tabs use a hidden measurement mirror plus `ResizeObserver` feeding
`computeVisibleTabKeys`, so as many tabs as fit stay inline and the tail collapses into
the overflow menu while the active tab stays visible.

### Shared picker chrome

The remote-picker dropdown (`RemoteScopeCluster`, rows = remote groups) and the virtual
repo-picker dropdown (`VirtualWorkspaceShellHeader`, rows = individual repos) share one
presentational shell `RepoPickerPopover` (fixed width, search box, scroll area, plus
`PickerSection` / `PickerRow` / `PickerEmpty` primitives) and one interaction hook
`useDropdownPopover` (open state, outside-click, Escape-close-and-refocus-trigger,
search auto-focus).

Row helpers `getServerName` / `isRepoOffline` / `shortPath` live in
`repos/repoPickerModel.ts` alongside the group markers `getGroupWsl` (all-or-nothing
`WSL` pill) and `getGroupRemoteServers` (any-semantics: deduped sorted server names
behind a group's remote clones, empty when local-only). The latter drives
`RemoteServerBadge`, a cloud glyph (`remote-server-badge`) on group rows whose
collection includes at least one clone served by another CoC server; server names stay
in the hover and accessible label, never in row text.

The two callers keep their genuine differences — the remote picker's Add-repository
footer and remote sub-tabs, the virtual picker's identity chip and navigation-only
rows. Offline is surfaced per-repo in the virtual picker only; group rows show the
aggregate status dot.

## Repo groups

### In the picker

`WorkspaceIdentityChip` renders a "Repo groups" `PickerSection` (rows
`repo-group-item`, icon `repo-group-icon`) from the **full AppContext workspace list**
filtered by `isRepoGroupWorkspaceId(id)` (`repos/virtualWorkspaceIds.ts`, prefix
`group-`). `repos` cannot be the source because `ReposContext` strips virtual
workspaces.

The footer gains "New repo group…" (`remote-new-repo-group-option`) opening
`repos/RepoGroupDialog.tsx` — create/edit with a name, a Server dropdown, and a
checkbox multi-select of that server's registered repos. Free-form paths are never
offered; edit prefills from `GET /api/repo-groups/:id` and badges stale members
`path missing` / `removed`. Each row's ⋮ menu (`repo-group-row-menu`) offers Edit and
Delete; delete confirms via a Dialog (`repo-group-delete-confirm-btn`) then calls
`DELETE /api/repo-groups/:id`, which deregisters only — the group's data dir stays on
disk. Clicking a group row navigates through `useShellNavigation().selectClone`.

### On a remote server

A group lives in exactly **one** server's registry — the local dashboard's, or an online
ssh/devtunnel CoC server's — and its members are always ids from that same registry.
`repos/repoGroupService.ts` wraps the REST surface with an optional trailing `baseUrl`
routed through `getCocClientFor(baseUrl)` (omitted ⇒ local origin client), so the
dashboard talks to the remote's `/api/repo-groups` at its `effectiveUrl` directly.
There is no server-side proxy route, and the remote's own `normalizeMembers` validation
stays the source of truth, its errors surfacing inline in the dialog.

`listRepoGroupServerOptions()` builds the Server dropdown (`repo-group-server-select`)
from `/api/servers`: `Local` plus every remote whose runtime status is `online` with an
`effectiveUrl`. Offline servers are never offered and an unreachable registry degrades
to Local-only. Switching server clears the checked members, whose ids mean nothing in
the new registry, and the dropdown is **disabled while editing** because a group's
server is fixed at creation. `RepoGroupDialog` takes `groupBaseUrl` for the group under
edit so load and save both route to its owner. A 404 from create/save is reworded to
"This server doesn't support repo groups." — a remote predating the feature has no such
route, and there is no GET-list endpoint to probe with.

### Group virtual workspace view

Selecting a `group-<slug>` id renders `repos/RepoGroupView.tsx` (a branch in
`ReposView`, recognized by id **prefix** via `isRepoGroupWorkspaceId` — unlike My Work /
My Life's id-equality checks, and with no feature flag). The view exposes only a
Workspace tab (chat, key `chats`, `RepoChatTab`) and a Notes tab (`NotesView`, notes
root = the group's own workspace dir); every git-dependent tab is absent by
construction.

`getRepoGroupHeaderConfig(workspaceId, label)` builds the per-group
`VirtualWorkspaceHeaderConfig` (`testIdPrefix: 'repo-group'`, `defaultTab: 'chats'`, no
actions). TopBar picks it for `VirtualWorkspaceShellHeader` with the registered
workspace name as label (id fallback while loading); the classic shell and mobile
render `VirtualWorkspaceInlineHeader` in-body.

Group selections never overwrite `lastWorkspaceRepoId` (an AppContext guard), and
`ScopeSlideSwitcher` gives an active group the workspace segment
(`data-active-scope="group"`, `aria-selected`, thumb in a distinct green accent). It
resolves the label with `resolveRepoGroupName(selectedRepoId, state.workspaces,
remoteGroupWorkspaces)` and passes it as the chip's `groupIdentity`; that derivation
stays in the switcher because it is gated on the repos tab. Pop-out and right-click
target the group, and no switch-back is offered while a group is active — the pill
reads the group's name, so the chevron's picker is the way out.

## Remote workspace aggregation

With `features.remoteShell` on, `ReposContext.fetchRepos` also calls
`aggregateRemoteWorkspaces()` (`repos/remoteWorkspaceAggregation.ts`) in parallel with
the local `listWorkspaces()` plus git-info batch. For each `online` registry server
(`/api/servers`) it fetches `/api/workspaces`, the git-info batch, and the queue
(`queue.repos()`) **directly** at the server's `effectiveUrl` through a self-contained
`CocClient` — it does not reuse `getSpaCocClient` routing.

Each remote workspace is tagged with a `remote` marker
`{ baseUrl, serverId, serverLabel, offline, connection, queue }` plus a top-level
`baseUrl`, the routing key. There are no composite IDs and no serverId namespace. Local
workspaces carry neither, so `isRemoteWorkspace()` distinguishes them. `connection`
mirrors the registry runtime status (`online`/`connecting`/`offline`/`failed`/`idle`)
so the status dot can tell connecting from offline; `queue` is the remote queue state
(`running`/`queued`/`paused`/`idle`, from `remoteQueueStatusFromRepo` keyed by
`repoId` = workspace id), falling back to `'idle'` when offline or when the resilient
queue fetch fails — a queue failure never drops the server.

Remote rows merge into the same `RepoData[]` as local ones with git info pre-resolved
from the per-server batch, and are skipped by the local Phase-2 git-info update.
Offline or unreachable servers contribute their last-known list from a two-layer
(in-memory + `localStorage['coc-remote-workspace-cache']`) per-server cache
(`repos/remoteWorkspaceCache.ts`), each entry flagged `offline` with the real
`connection` preserved. `ReposContext` retains aggregation warnings so target pickers
can explain skipped servers while leaving healthy repos usable. With the flag off,
`aggregateRemoteWorkspaces()` returns empty and performs no remote fetch.

`ReposContext` loads workspace topology, summaries, and the initial git-info batch
together, but process lifecycle traffic never repeats that path. Its WebSocket handler
applies `process-added`, `process-updated`, and `process-removed` to `AppContext`, and
repository-card counts derive from that live in-memory process index. Full discovery
runs only for initial load, `workspace-topology-changed`, `server-topology-changed`,
reconnect recovery after the first connection, or an explicit refresh. A `git-changed`
event requests git info for only that workspace through the clone-routing registry.

## Sub-tab taxonomy

`features/repo-detail/repoSubTabs.ts` owns `SUB_TABS`, `VISIBLE_SUB_TABS`,
`TAB_GROUP_INDEX`, and `computeVisibleSubTabs`, shared by both `RepoDetail` and the
shell so the two stay behaviorally identical. Selection and routing reuse
`buildRepoSubTabSuffix` through `useShellNavigation`.

`SHOW_WIKI_TAB` and `SHOW_MEMORY_TAB` live in a dedicated lightweight `navFlags.ts`
(read by `repoSubTabs.ts`, re-exported from `TopBar` for `BottomNav` and `Router`),
kept out of the heavily-mocked `featureFlags.ts` so partial test mocks of it do not
break on a missing export.

With `features.splitWorkspacePanel` enabled, both `RepoDetail` and the remote-shell
`WorkspaceTabsCluster` pass the flag into `computeVisibleSubTabs`, hiding the
clone-scoped standalone Git tab and relabeling the chat tab Workspace, while Git stays
available inside `SplitWorkspacePanel`.
