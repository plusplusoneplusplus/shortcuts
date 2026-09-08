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
clone via the shared `pickCloneForGroup` (`repos/cloneIdentity.ts`): the clone last
used for that cluster when it still exists, else the cluster's first local-first
clone. That memory is `AppContextState.lastCloneByRemote` — keyed by
`groupKey(group)`, valued with a repo selection id, written by the
`RECORD_REMOTE_CLONE` reducer case and persisted to localStorage
(`coc-last-clone-by-remote`), since which machine's clone you were viewing is
per-device. `ScopeSlideSwitcher` records it (deciding the cluster needs the full
repo list and the grouping pass, which the reducer lacks). `WorkspaceTabsCluster` carries the
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
`usePinnedScopesEnabled`; on by default, only meaningful with `scopeSwitcher`) adds
user-pinned segments between the virtual scopes and the workspace chip, bracketed by
`scope-pin-divider` on each side. A pin renders as `scope-segment` with
`data-scope="pin"`, `data-pin-id`, `data-pin-kind`, an unread badge
(`scope-pin-unseen-badge`), the shared pop-out icon, the shared right-click menu, and
the hover control `scope-pin-unpin`. The hover controls (unpin and pop-out) are
revealed with `hidden group-hover:inline-flex group-focus-within:inline-flex`, so an
idle pin collapses to dot + label + badge and reserves no width for them. Reordering
lives in the right-click menu as `scope-pin-move-left` / `scope-pin-move-right`, each
item omitted when that direction is unavailable (first / last pin).
Below `xl` a pin drops to icon-only; below `lg` the whole strip
(`scope-pin-strip`) is hidden.

Pins persist in the global preference `pinnedScopes` (cap 8, same shape as
`recentRemotes`). Each entry is a prefixed, discriminated key because the two things the
UI calls a "repo group" have separate key spaces: `repo:<groupKey>` is a git-remote
`RepoGroup`, `group:<workspaceId>` a repo-group virtual workspace. `pinnedScopes.ts`
holds the pure model (`parsePinnedScope` splits on the first colon so a
`repo:workspace:<id>` key survives; `resolvePinnedScopes` drops pins whose target is
missing from the rendered set only, never from storage). A `repo:` pin's `targetId` /
`workspaceId` come from the same `pickCloneForGroup` the picker uses, fed
`lastCloneByRemote` through `PinnedScopeResolveContext` so the module stays pure — so
clicking or popping out a pin lands on the clone you were last on, not the cluster's
primary. `usePinnedScopes.ts` is a
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
`usePinnedScopesEnabled`; on by default, only meaningful with `scopeSwitcher`) adds
user-pinned segments between the virtual scopes and the workspace chip, bracketed by
`scope-pin-divider` on each side. A pin renders as `scope-segment` with
`data-scope="pin"`, `data-pin-id`, `data-pin-kind`, an unread badge
(`scope-pin-unseen-badge`), the shared pop-out icon, the shared right-click menu, and
the hover control `scope-pin-unpin`. The hover controls (unpin and pop-out) are
revealed with `hidden group-hover:inline-flex group-focus-within:inline-flex`, so an
idle pin collapses to dot + label + badge and reserves no width for them. Reordering
lives in the right-click menu as `scope-pin-move-left` / `scope-pin-move-right`, each
item omitted when that direction is unavailable (first / last pin).
Below `xl` a pin drops to icon-only; below `lg` the whole strip
(`scope-pin-strip`) is hidden.

Pins persist in the global preference `pinnedScopes` (cap 8, same shape as
`recentRemotes`). Each entry is a prefixed, discriminated key because the two things the
UI calls a "repo group" have separate key spaces: `repo:<groupKey>` is a git-remote
`RepoGroup`, `group:<workspaceId>` a repo-group virtual workspace. `pinnedScopes.ts`
holds the pure model (`parsePinnedScope` splits on the first colon so a
`repo:workspace:<id>` key survives; `resolvePinnedScopes` drops pins whose target is
missing from the rendered set only, never from storage). A `repo:` pin's `targetId` /
`workspaceId` come from the same `pickCloneForGroup` the picker uses, fed
`lastCloneByRemote` through `PinnedScopeResolveContext` so the module stays pure — so
clicking or popping out a pin lands on the clone you were last on, not the cluster's
primary. `usePinnedScopes.ts` is a
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
`PickerRow` also takes an optional `className`, which the mobile list uses for the
shared `.repo-item` hook and a 44px touch target.

### Shared picker model

`features/remote-shell/useScopePickerModel.tsx` is the headless model behind **every**
scope picker surface — the desktop dropdown (`WorkspaceIdentityChip`), the mobile sheet
(`ScopePickerSheet`) and the mobile list (`MobileScopeList`). It composes four sections
once so the shells cannot drift:

1. `pinnedRows` — `usePinnedScopes` + `resolvePinnedScopes`
2. `virtualRows` — My Work / My Life, gated on their flags
3. `groupRows` — `group-*` virtual workspaces (local + `remoteGroupWorkspaces`)
4. `remoteRows` — recent (or search-matching) git-remote clusters; `buildRemoteRow`
   builds one row for a caller-supplied ordering

It also owns `chooseGroup` / `selectScope` (both through `useShellNavigation`), the
`RECORD_REMOTE_CLONE` bookkeeping, the pin toggles, the row/group `ContextMenu` item
builders, `footerActions` (add folder / add repo / clone / new repo group), and a single
`dialogs` node holding every dialog, confirm and toast a row can open. Search is one
predicate per section: `groupMatchesSearch` for clusters, `repoGroupMatchesSearch` for
groups, name-match for the virtual scopes — OR-ed, with headers kept so results stay
attributable. Icons and badges live in `scopePickerGlyphs.tsx` (inline SVG, never emoji).

`test/spa/react/remote-shell/ScopePickerSheet.test.tsx` asserts model↔desktop-picker
row parity, so a row added to one surface cannot silently skip the other.

Row helpers `getServerName` / `isRepoOffline` / `shortPath` sit in
`repos/repoPickerModel.ts` with group markers `getGroupWsl` (all-or-nothing `WSL` pill)
and `getGroupRemoteServers` (any-semantics: deduped sorted server names behind a group's
remote clones, empty when local-only). The latter drives `RemoteServerBadge`
(`remote-server-badge`) on groups holding at least one clone served by another CoC
server; server names stay in the hover and accessible label, never in row text.

## Repo groups

A repo group is a virtual workspace whose id carries the `group-` prefix
(`isRepoGroupWorkspaceId`, `repos/virtualWorkspaceIds.ts`).

**In the picker.** `useScopePickerModel` builds the "Repo groups" `PickerSection` (rows
`repo-group-item`, icon `repo-group-icon`) from the **full AppContext workspace list** —
`repos` cannot be the source because `ReposContext` strips virtual workspaces. All three
picker surfaces (desktop dropdown, mobile sheet, mobile scope list) render those rows. The
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
feature flag. It exposes Workspace (chat, key `chats`, `RepoChatTab`), Git
(`RepoGroupGitTab`), Notes (`NotesView`, notes root = the group's own workspace dir),
and Settings (`repos/RepoGroupSettingsTab.tsx`, `Alt+C`).
`getRepoGroupHeaderConfig(workspaceId, label)` supplies the
`VirtualWorkspaceHeaderConfig` (`testIdPrefix: 'repo-group'`, `defaultTab: 'chats'`, no
actions), labeled with the registered workspace name (id fallback while loading).

### Group Git

`RepoGroupGitTab` hosts one member's standalone `RepoGitTab`, keyed by member id
to isolate panel state. `RepoGroupGitMemberPicker` is a native dropdown passed
through `RepoGitTab.repositorySelector` into `GitPanelHeader`; the selector also
stays available during loading and errors. Options include Git status from
`useRepoGroupMemberGitInfo`; stale members are disabled with a reason. Git calls
use the selected member's clone-routed workspace id.

**The group owns the page, the member owns the data.** `RepoGitTab` takes
`routeWorkspaceId` (the group) alongside `workspaceId` (the member), so its URLs
read `#repos/<groupId>/git/member/<memberId>[/<sha|branch-range>[/<file>]]` and
the group stays the selected workspace while you browse a member's history.
`layout/gitRoute.ts` is the single parser/builder for that shape (and the plain
`#repos/<repoId>/git/...` form); the `member` marker is structural only for
`group-` ids, so a member id is never read as a SHA. `dashboardRoutes` publishes
the whole route in one `SET_GIT_ROUTE` action — page owner, data member,
revision and file — into `AppContext.gitRouteScope` + the existing
`selectedGitCommitHash` / `selectedGitFilePath` fields, and records the full
member path as the GROUP's remembered route suffix.

A member in the URL always beats the remembered preference. The host waits for
membership, then: validates an explicit member (persisting it into
`repoGroupGitMemberState`), or resolves a bare `/git` entry — and any older
`/git/<sha>` link — against that preference and `history.replaceState`s the
explicit form (dispatching the matching route effect by hand, since
`replaceState` emits no `hashchange`). An explicit member that is stale or no
longer in the group renders `repo-group-git-unavailable-member`: the group stays
open with a usable picker and no git request is made against another repo.
Changing member is a navigation to that member's history route, so the previous
commit/file is cleared before the keyed panel mounts.

### Group settings

`features/repo-settings/SettingsShell.tsx` supplies the same sidebar
and content-panel chrome used by `RepoSettingsTab`. A group renders one selected sidebar
item, **Repos**, with no filter or group heading. `RepoGroupMemberList` sits directly in
the section body: one row per member (name, `rootPath`, stale badge) with an
inline-editable description. Editing is type / Enter-or-blur to save, Escape to cancel;
the save is optimistic and rolls back with a per-row error message when
`PATCH /api/repo-groups/:id` (`{ descriptions: { [id]: next } }`) fails. Membership
itself stays in `RepoGroupDialog`, which edits the same descriptions.

A group's root has no Git repository, MCP config, per-repo preferences, or `SettingsSection` sub-route.
`#repos/<groupId>/settings` (no section suffix) is its canonical URL.
`buildWorkspaceSubTabSuffix(workspaceId, tab, state, taskId)` in
`layout/dashboardRoutes.ts` returns a bare `/settings` for a `group-*` id and otherwise
delegates to `buildRepoSubTabSuffix`. Every navigator that knows its target id calls it
(`Router`'s Alt-shortcut handler, `useVirtualWorkspaceHeader`, `useShellNavigation`,
`resolveWorkspaceRouteSuffix`). `GlobalStatusDock` exempts groups from its settings
stand-down because the group shell has no docked sidebar footer.
Members come from `useRepoGroupMembers(workspaceId, baseUrl, enabled)`
(`repos/useRepoGroupMembers.ts`), enabled when Settings, Git, or the right dock
needs membership.

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

## Mobile scope shell (`breakpoint === 'mobile'`, < 768px)

The narrow shell does **not** turn on `remoteShell` — `RemoteShellHeader`,
`ScopeSlideSwitcher` and `WorkspaceTabsCluster` are width-hungry by construction. It
gets its own presentation over the same model modules instead.

**`repos/MobileScopeList.tsx`** replaces `ReposGrid` in `ReposView`'s mobile branch
(`ReposGrid` stays the desktop hamburger popover's surface). One scroll container,
sections Pinned → Scopes → Repo groups → Repositories, all from `useScopePickerModel`.
Cluster ordering and expansion stay shared with the desktop grid: the same
`gitGroupOrder` preference and the same `coc-git-group-expanded-state` key. A
single-clone cluster navigates straight into the clone; a multi-clone cluster expands
into clone rows (`scope-list-clone`) that carry the desktop clone contract —
`data-offline="true"` plus `clone-offline-badge`, disabled. Header holds the title, a
search box, and a `+` sheet with the model's footer actions plus Reorder. Footer stats
name groups: `11 repos · 2 clones in 1 remote · 3 groups · 1 running`
(`buildScopeListFooterText`). With nothing registered it falls back to
`ReposEmptyState`. Row actions open through the shared `ContextMenu`, which already
renders as a bottom sheet on mobile.

**`layout/MobileScopeBar.tsx`** (40px, `mobile-scope-bar`) replaces `BottomNav` on the
repos tab: the active scope chip (`mobile-scope-chip` — status dot, group glyph or
virtual-scope emoji, name, `⧉N`, unseen badge, chevron) plus a `⋯` button whose sheet
holds the admin destinations. The chip names `selectedRepoId ?? lastWorkspaceRepoId` and
opens `ScopePickerSheet`. Both bars publish their height as `--bottom-nav-height`, and
exactly one is mounted: `BottomNav` now returns null on the repos tab, and the scope bar
returns null everywhere else and once a workspace is selected. The shared destination
list lives in `layout/navDestinations.tsx` so neither component imports the other. Every
one of those destinations is an admin-shell tab, so the sheet is how they are reached
from the repos tab.

**`features/remote-shell/ScopePickerSheet.tsx`** is the same four sections and footer as
the desktop dropdown in a `BottomSheet` (`scope-picker-sheet`, search
`scope-picker-search`). Pin toggles are always visible here — a hover-revealed control is
unreachable on touch.

**`features/remote-shell/VirtualWorkspaceMobileTabBar.tsx`** gives every virtual
workspace the mobile skin repos already had. `RepoGroupView`, `MyWorkView` and
`MyLifeView` render it instead of `VirtualWorkspaceInlineHeader` when `isMobile`:
`MobileTabBar` with `config.tabs`, `config.actions` folded into the `···` sheet, and a
leading back-to-scope-list slot (`<prefix>-name-back`) mirroring `repo-name-back`. A
repo group pins `chats · git · notes` and keeps Settings in the overflow; My Work / My
Life pin their first three visible tabs. Before this a mobile user who landed on a group
had no way back.

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
