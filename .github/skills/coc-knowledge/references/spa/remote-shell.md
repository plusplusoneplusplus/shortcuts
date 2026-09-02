# Dashboard SPA — Remote-first shell

How the dashboard presents workspaces owned by another CoC server: the feature gate,
the top-row headers, the scope switcher, repo groups, and remote workspace aggregation.
Which server a request actually reaches is [clone-routing.md](clone-routing.md).

## Feature gate

`useRemoteShellEnabled()` (`hooks/feature-flags/useRemoteShellEnabled.ts`) reads the live
`features.remoteShell` admin flag (runtime `remoteShellEnabled`, `isRemoteShellEnabled()`
in `utils/config.ts`), declared once in `ADMIN_SETTING_DEFINITIONS` as
`toggle-remote-shell-enabled`. Desktop-only, effective on reload; defaults in
[../admin-config.md](../admin-config.md).

## Shell headers

`TopBar` renders one of three top rows.

**`RemoteShellHeader`** — `remoteShellEnabled` + tab `repos` + a real repo selected +
non-mobile. `RemoteScopeCluster` holds the current-remote chip plus Work Items / Pull
Requests pills; the chip's dropdown lists recent remotes from the global preference
`recentRemotes` (MRU keys `groupKey(group)`, cap 8; default-group fallback before any
MRU), search over all remotes, and `AddFolderDialog` / `AddRepoDialog` /
`CloneRepoDialog`. Selecting a remote records the MRU entry and picks that remote's
remembered clone, else its first local-first clone. `WorkspaceTabsCluster` carries the
clone switcher, clone popover, clone-scoped tabs, overflow menu, and repo info/remove
dialogs. `header-new-btn` is the first right-side action, enqueuing for the active clone.
`ReposView` renders a `chromeless` `RepoDetail`.

**`VirtualWorkspaceShellHeader`** — `remoteShellEnabled` + desktop + tab `repos` + a
virtual workspace selected (`my_work`, `my_life`, or a repo group). Virtual workspaces
have no repo or git context, so they cannot flow through `RemoteScopeCluster` /
`WorkspaceTabsCluster`; each supplies a `VirtualWorkspaceHeaderConfig` of identity chip,
sub-tabs, and actions (`MY_WORK_HEADER_CONFIG` / `MY_LIFE_HEADER_CONFIG` exported from
`MyWorkView` / `MyLifeView`), driven by `useVirtualWorkspaceHeader`.
`VirtualWorkspaceInlineHeader` is the in-body variant those views render in the classic
shell and on mobile, gated on `!(remoteShell && !isMobile)`.

**`RepoTabStrip`** — the fallback when the flag is on but no repo or virtual workspace
can back a header (fresh window with no selection, or any tab other than Repos), so the
top row stays consistent.

## Scope slide switcher

`ScopeSlideSwitcher` is gated by `features.scopeSwitcher` (runtime
`scopeSwitcherEnabled`, `isScopeSwitcherEnabled()`, hook `useScopeSwitcherEnabled`;
remote-first desktop shell only). `E2E_SERVER_CONFIG_YAML` pins it off. With it on,
`TopBar` replaces the standalone My Work / My Life toggles and both headers' identity
chips with one segmented control (`data-testid="scope-switcher"`, segments
`scope-segment` with `data-scope="work|life|workspace"`).

The workspace segment embeds `WorkspaceIdentityChip`: status dot, provider badge,
remote name, `⧉N` clone badge, and a chevron opening `RepoPickerPopover` plus add/clone
dialogs. Its optional `groupIdentity={{ id, name }}` prop swaps in a repo group's
identity — group name only, no provider badge, no `⧉N`, none of which describe a group
— and emits `data-repo-group-id`, kept distinct from `data-remote-key` (git-remote
`RepoGroup` clustering).

### Pinned scope segments

`features.pinnedScopes` (runtime `pinnedScopesEnabled`, `isPinnedScopesEnabled()`, hook
`usePinnedScopesEnabled`; off by default, only meaningful with `scopeSwitcher`) adds
user-pinned segments between the virtual scopes and the workspace chip, bracketed by
`scope-pin-divider` on each side. A pin renders as `scope-segment` with
`data-scope="pin"`, `data-pin-id`, `data-pin-kind`, an unread badge
(`scope-pin-unseen-badge`), the shared pop-out icon, the shared right-click menu, and
hover controls `scope-pin-move-left` / `scope-pin-move-right` / `scope-pin-unpin`.
Below `xl` a pin drops to icon-only; below `lg` the whole strip
(`scope-pin-strip`) is hidden.

Pins persist in the global preference `pinnedScopes` (cap 8, same shape as
`recentRemotes`). Each entry is a prefixed, discriminated key because the two things the
UI calls a "repo group" have separate key spaces: `repo:<groupKey>` is a git-remote
`RepoGroup`, `group:<workspaceId>` a repo-group virtual workspace. `pinnedScopes.ts`
holds the pure model (`parsePinnedScope` splits on the first colon so a
`repo:workspace:<id>` key survives; `resolvePinnedScopes` drops pins whose target is
missing from the rendered set only, never from storage). `usePinnedScopes.ts` is a
module-level store rather than per-hook state so the pin toggles on the picker rows
(`scope-pin-toggle`, `data-pin-kind` / `data-pin-key`, in `WorkspaceIdentityChip`) and
the segments in `ScopeSlideSwitcher` stay in sync without a common owner.

An active pin takes the thumb from the workspace segment (`data-active-pin` on the
container). Because a pin and the chip must never show the same identity twice: a
pinned *group* suppresses the chip's `groupIdentity`, so the chip falls back to the
remembered repo with the usual switch-back split button; a pinned *remote* sets
`identitySuppressed`, collapsing the chip to a bare chevron picker trigger
(`data-identity-suppressed`).

### Pinned scope segments

`features.pinnedScopes` (runtime `pinnedScopesEnabled`, `isPinnedScopesEnabled()`, hook
`usePinnedScopesEnabled`; off by default, only meaningful with `scopeSwitcher`) adds
user-pinned segments between the virtual scopes and the workspace chip, bracketed by
`scope-pin-divider` on each side. A pin renders as `scope-segment` with
`data-scope="pin"`, `data-pin-id`, `data-pin-kind`, an unread badge
(`scope-pin-unseen-badge`), the shared pop-out icon, the shared right-click menu, and
hover controls `scope-pin-move-left` / `scope-pin-move-right` / `scope-pin-unpin`.
Below `xl` a pin drops to icon-only; below `lg` the whole strip
(`scope-pin-strip`) is hidden.

Pins persist in the global preference `pinnedScopes` (cap 8, same shape as
`recentRemotes`). Each entry is a prefixed, discriminated key because the two things the
UI calls a "repo group" have separate key spaces: `repo:<groupKey>` is a git-remote
`RepoGroup`, `group:<workspaceId>` a repo-group virtual workspace. `pinnedScopes.ts`
holds the pure model (`parsePinnedScope` splits on the first colon so a
`repo:workspace:<id>` key survives; `resolvePinnedScopes` drops pins whose target is
missing from the rendered set only, never from storage). `usePinnedScopes.ts` is a
module-level store rather than per-hook state so the pin toggles on the picker rows
(`scope-pin-toggle`, `data-pin-kind` / `data-pin-key`, in `WorkspaceIdentityChip`) and
the segments in `ScopeSlideSwitcher` stay in sync without a common owner.

An active pin takes the thumb from the workspace segment (`data-active-pin` on the
container). Because a pin and the chip must never show the same identity twice: a
pinned *group* suppresses the chip's `groupIdentity`, so the chip falls back to the
remembered repo with the usual switch-back split button; a pinned *remote* sets
`identitySuppressed`, collapsing the chip to a bare chevron picker trigger
(`data-identity-suppressed`).

`RemoteScopeCluster` renders the chip itself unless `hideIdentity` is set; both headers
forward `hideIdentity` so identity renders exactly once. Virtual-scope navigation
(`goToMyWork` / `goToMyLife`, saved-note-path restore) lives in shared
`hooks/useScopeNavigation.ts`, used by the switcher and the standalone toggles alike.

## Shared shell model

`shellModel.ts` and `repoGrouping.ts` hold the shared behavior. Aggregated remote
checkouts fold into the matching local origin's tab by normalized git URL; a
remote-only repo gets its own group. `groupReposByRemote` sorts clones **local-first**,
so the default clone is local when one exists. `partitionShellTabs` keeps Work Items and
Pull Requests remote-scoped.

`computeCloneStatusMap` / `cloneStatusColor` drive clone dots: local clones are
queue-derived; remote clones blend connection-first via `blendRemoteCloneStatus`
(`offline`/`failed` → offline, `connecting`/not-yet-online → connecting, online → remote
queue state). Offline remote rows stay visible but disabled, marked `data-offline="true"`
with `clone-offline-badge`. Clone tabs use a hidden measurement mirror plus
`ResizeObserver` feeding `computeVisibleTabKeys`, collapsing the tail into the overflow
menu while the active tab stays inline.

### Shared picker chrome

The remote picker (`RemoteScopeCluster`, rows = remote groups) and the virtual repo
picker (`VirtualWorkspaceShellHeader`, rows = individual repos) share the presentational
`RepoPickerPopover` (`PickerSection` / `PickerRow` / `PickerEmpty`) and the interaction
hook `useDropdownPopover` (open state, outside-click, Escape-close-and-refocus-trigger,
search auto-focus). They differ in the remote picker's Add-repository footer and remote
sub-tabs versus the virtual picker's identity chip and navigation-only rows; offline is
per-repo in the virtual picker only, group rows show the aggregate dot.

Row helpers `getServerName` / `isRepoOffline` / `shortPath` sit in
`repos/repoPickerModel.ts` with group markers `getGroupWsl` (all-or-nothing `WSL` pill)
and `getGroupRemoteServers` (any-semantics: deduped sorted server names behind a group's
remote clones, empty when local-only). The latter drives `RemoteServerBadge`
(`remote-server-badge`) on groups holding at least one clone served by another CoC
server; server names stay in the hover and accessible label, never in row text.

## Repo groups

A repo group is a virtual workspace whose id carries the `group-` prefix
(`isRepoGroupWorkspaceId`, `repos/virtualWorkspaceIds.ts`).

**In the picker.** `WorkspaceIdentityChip` builds a "Repo groups" `PickerSection` (rows
`repo-group-item`, icon `repo-group-icon`) from the **full AppContext workspace list** —
`repos` cannot be the source because `ReposContext` strips virtual workspaces. The
footer's `remote-new-repo-group-option` opens `repos/RepoGroupDialog.tsx`: name, Server
dropdown, checkbox multi-select of that server's registered repos; free-form paths are
never offered, and edit prefills from `GET /api/repo-groups/:id`, badging stale members.
The row ⋮ menu (`repo-group-row-menu`) offers Edit and Delete
(`repo-group-delete-confirm-btn` → `DELETE /api/repo-groups/:id`), which deregisters
only — the group's data dir stays on disk. Selecting a row goes through
`useShellNavigation().selectClone`.

**Ownership.** A group lives in exactly **one** server's registry — the local
dashboard's or an online ssh/devtunnel CoC server's — and its members are always ids from
that same registry.

- `repos/repoGroupService.ts` wraps the REST surface with an optional trailing `baseUrl`
  routed via `getCocClientFor(baseUrl)` (omitted ⇒ local origin), so the dashboard talks
  to the remote's `/api/repo-groups` at its `effectiveUrl`. There is no server-side proxy;
  the remote's own `normalizeMembers` validation is the source of truth and surfaces
  inline in the dialog.
- `listRepoGroupServerOptions()` builds `repo-group-server-select` from `/api/servers`:
  `Local` plus every `online` remote with an `effectiveUrl`; an unreachable registry
  degrades to Local-only.
- `repos/useServerSelection.ts` reuses the same option list for the **Server** dropdown in
  `AddRepoDialog` / `AddFolderDialog` / `CloneRepoDialog` (`add-repo-server-select`,
  `clone-repo-server-select`). The selected option's `baseUrl` routes browse, clone, and
  register; switching server clears every path-scoped field and re-roots the browser at
  the new box's `~`. `describeServerFailure` appends the server label to remote errors.
  `CloneRepoDialog` runs `POST /api/git/clone` on the selected server, then registers the
  cloned path there; only a **local** clone dispatches `WORKSPACE_REGISTERED` and
  navigates — a remote id is routable only after `aggregateRemoteWorkspaces` re-runs.
- `repos/useServerSelection.ts` reuses the same option list for the **Server** dropdown in
  `AddRepoDialog` / `AddFolderDialog` / `CloneRepoDialog` (`add-repo-server-select`,
  `clone-repo-server-select`). The selected option's `baseUrl` routes browse, clone, and
  register; switching server clears every path-scoped field and re-roots the browser at
  the new box's `~`. `describeServerFailure` appends the server label to remote errors.
  `CloneRepoDialog` runs `POST /api/git/clone` on the selected server, then registers the
  cloned path there; only a **local** clone dispatches `WORKSPACE_REGISTERED` and
  navigates — a remote id is routable only after `aggregateRemoteWorkspaces` re-runs.
- `AddRepoDialog`'s inline filesystem browser (`path-browser`) treats browsing as
  selecting: every successful `navigateTo` writes the shown directory into `repo-path`
  and, while the name still holds the value the browser derived, re-derives `repo-alias`
  from the path leaf. A name the user types is never overwritten. The tree has no confirm
  of its own — `path-browser-close` only dismisses it (the path stays), and the dialog's
  `add-repo-submit` is the single confirm, which also closes the tree.
- Switching server clears checked members — their ids mean nothing in the new registry —
  and the dropdown is **disabled while editing**, because a group's server is fixed at
  creation. `RepoGroupDialog` takes `groupBaseUrl` so load and save route to the owner.
- A 404 from create/save means a remote predating the feature; there is no GET-list
  endpoint to probe with, so the message is reworded rather than retried.

**View.** A `group-<slug>` id renders `repos/RepoGroupView.tsx`, a branch in `ReposView`
recognized by id **prefix** (unlike My Work / My Life's id-equality checks) with no
feature flag. It exposes three tabs — Workspace (chat, key `chats`, `RepoChatTab`), Notes
(`NotesView`, notes root = the group's own workspace dir), and Settings
(`repos/RepoGroupSettingsTab.tsx`, `Alt+C`); git-dependent tabs are absent by
construction. `getRepoGroupHeaderConfig(workspaceId, label)` supplies the
`VirtualWorkspaceHeaderConfig` (`testIdPrefix: 'repo-group'`, `defaultTab: 'chats'`, no
actions), labeled with the registered workspace name (id fallback while loading).

**Settings tab.** A group has no git, no MCP config and no per-repo preferences, so it
does *not* reuse `RepoSettingsTab` or the `SettingsSection` sub-route machinery — it is a
single scrolling pane of cards, and `#repos/<groupId>/settings` (no section suffix) is
its canonical URL. `buildWorkspaceSubTabSuffix(workspaceId, tab, state, taskId)` in
`layout/dashboardRoutes.ts` is what enforces that: it returns a bare `/settings` for a
`group-*` id and otherwise delegates to `buildRepoSubTabSuffix`. Every navigator that
knows its target id calls it (`Router`'s Alt-shortcut handler, `useVirtualWorkspaceHeader`,
`useShellNavigation`, `resolveWorkspaceRouteSuffix`). `GlobalStatusDock` also exempts
groups from its settings stand-down, since there is no nav-sidebar footer to defer to.

The pane's only card today is **Member repos** — `RepoGroupMemberList`, one row per
member (name, `rootPath`, stale badge) with an inline-editable description. Editing is
type / Enter-or-blur to save, Escape to cancel; the save is optimistic and rolls back with
a per-row error message when `PATCH /api/repo-groups/:id` (`{ descriptions: { [id]: next } }`)
fails. Membership itself stays in `RepoGroupDialog`, which edits the same descriptions.
Members come from `useRepoGroupMembers(workspaceId, baseUrl, enabled)`
(`repos/useRepoGroupMembers.ts`), gated on the tab being visible so a group nobody opens
Settings on costs no request.

**Right dock.** On desktop with `splitWorkspacePanel` on, `RepoGroupView` also renders
`features/repo-detail/WorkspaceRightDock` as the outermost-right column (same gate as
`RepoDetail`). The dock's open/view/width/target state scopes to the **group**, while a
`workspace-dock-target-picker` in its header row chooses which workspace its Terminal and
Explorer point at. Options come from `getRepoGroup(groupId, baseUrl)` (baseUrl from
`remoteGroupWorkspaces` for a remote group): the group root first — offered so a terminal
can match the chat's cwd, but never the default, since it holds only `group.json` — then
every member repo, with stale members listed but disabled. Notes stays on the group.
Because available views derive from the *target*, picking a member brings Explorer back
and picking the group root drops it. The open/close toggle is
`WorkspaceDockToggleButton` in the TopBar next to the virtual header; My Work / My Life
get no dock. See `features/repo-detail/AGENTS.md` for the dock's own contract.

Group selections never overwrite `lastWorkspaceRepoId` (an AppContext guard).
`ScopeSlideSwitcher` gives an active group the workspace segment
(`data-active-scope="group"`), resolving its label with
`resolveRepoGroupName(selectedRepoId, state.workspaces, remoteGroupWorkspaces)` and
passing it as `groupIdentity`; that derivation stays in the switcher because it is gated
on the repos tab. The chevron's picker is the only way out of an active group.

## Remote workspace aggregation

With the flag on, `ReposContext.fetchRepos` also calls `aggregateRemoteWorkspaces()`
(`repos/remoteWorkspaceAggregation.ts`) in parallel with the local `listWorkspaces()`
plus git-info batch. For each `online` registry server (`/api/servers`) it fetches
`/api/workspaces`, the git-info batch, and `queue.repos()` **directly** at the server's
`effectiveUrl` through a self-contained `CocClient` — it does not reuse
`getSpaCocClient` routing. With the flag off it returns empty and issues no remote
fetch.

Each remote workspace carries a `remote` marker
`{ baseUrl, serverId, serverLabel, offline, connection, queue }` plus a top-level
`baseUrl`, the routing key. There are no composite IDs and no serverId namespace; local
workspaces carry neither, so `isRemoteWorkspace()` separates them. `connection` mirrors
the registry runtime status (`online`/`connecting`/`offline`/`failed`/`idle`) so the dot
can tell connecting from offline; `queue` (`running`/`queued`/`paused`/`idle`, from
`remoteQueueStatusFromRepo` keyed by `repoId` = workspace id) falls back to `'idle'`
when offline or when the resilient queue fetch fails — a queue failure never drops the
server.

Remote rows merge into the same `RepoData[]` as local ones with git info pre-resolved
from the per-server batch, and are skipped by the local Phase-2 git-info update.
Offline or unreachable servers contribute their last-known list from a two-layer
(in-memory + `localStorage['coc-remote-workspace-cache']`) per-server cache
(`repos/remoteWorkspaceCache.ts`), each entry flagged `offline` with the real
`connection` preserved. `ReposContext` retains aggregation warnings so target pickers
can explain skipped servers while leaving healthy repos usable.

`ReposContext` loads workspace topology, summaries, and the initial git-info batch
together; process lifecycle traffic never repeats that path. Its WebSocket handler
applies `process-added`/`-updated`/`-removed` to `AppContext`, and repository-card counts
derive from that live in-memory process index. Full discovery runs only for initial load,
`workspace-topology-changed`, `server-topology-changed`, post-first-connection reconnect
recovery, or explicit refresh; `git-changed` requests git info for only that workspace
through the clone registry.

## Sub-tab taxonomy

`features/repo-detail/repoSubTabs.ts` owns `SUB_TABS`, `VISIBLE_SUB_TABS`,
`TAB_GROUP_INDEX`, and `computeVisibleSubTabs`, shared by `RepoDetail` and the shell so
the two stay behaviorally identical; selection and routing reuse `buildRepoSubTabSuffix`
through `useShellNavigation`.

`SHOW_WIKI_TAB` and `SHOW_MEMORY_TAB` live in a lightweight `navFlags.ts` (read by
`repoSubTabs.ts`, re-exported from `TopBar` for `BottomNav` and `Router`), kept out of
the heavily-mocked `featureFlags.ts` so partial test mocks of it do not break on a
missing export.

With `features.splitWorkspacePanel` on, `RepoDetail` and `WorkspaceTabsCluster` pass the
flag into `computeVisibleSubTabs`, hiding the clone-scoped standalone Git tab and
relabeling the chat tab Workspace; Git stays available inside `SplitWorkspacePanel`.
