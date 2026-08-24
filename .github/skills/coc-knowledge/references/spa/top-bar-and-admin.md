# Dashboard SPA — Top Bar & Admin

## Top Bar

Right-hand action cluster:
`[Connected pill | NotificationBell | AgentProviderQuotaIndicator | Admin | Theme]`.
The quota indicator is hidden below the `md` breakpoint; the mobile top bar does
not render the quota dropdown trigger. The mobile CoC/hostname link is a
shrinkable truncated flex item so optional My Work/My Life shortcuts and the
fixed right-hand action cluster stay reachable on narrow phones.

The legacy "Tools" popover has been migrated into the Admin page's left
sidebar, but there is no longer a generic Tools group. The Admin sidebar is
grouped by user task: Configure, Knowledge, Connections, Operations, and
Developer / Internals. Embedded tool rows keep stable ids (`memory-toggle`,
`skills-toggle`, `dreams-admin-toggle`, `logs-toggle`, `stats-toggle`,
`servers-toggle`) and `data-tab` still carries the matching dashboard route;
Servers is shown only when `isServersEnabled()` is true. The Knowledge group's
**Dreams** row (`dreams-admin-toggle`, route `#dreams-admin`) renders
`features/dreams/DreamsView.tsx` and is the admin home for global Dreams config:
the live `dreams.enabled` toggle, `dreams.idleCheckIntervalMs` edited in minutes
with a restart hint, idle-run defaults for provider, model, and timeout
(`dreams.provider`, `dreams.model`, `dreams.timeoutMs`), and the relocated
**Dreams provider activity** queue + history section
(`features/dreams/ProviderActivitySection.tsx`); that section no longer lives on
the AI Provider page. It is distinct from the per-workspace `DreamsPanel`.

Clicking an embedded tool row dispatches `SET_ACTIVE_TAB` and updates
`location.hash` to the corresponding top-level route (`#memory`, `#skills`,
`#dreams-admin`, `#logs`, `#stats`, `#servers`). Every one of those hashes plus
`'admin'` itself opens the **admin overlay dialog** — see "Admin as an overlay
dialog" below — so the admin shell (sidebar + breadcrumb + right pane) stays
mounted across navigation.
`AdminPanel` switches on `state.activeTab` — when it matches an embedded tool
route, the right pane mounts the corresponding View embedded inside an
`.ar-tool-embed` flex column (instead of the standard `.ar-page` card grid).
The breadcrumb reads `<Group> / <Label>` while a view is embedded.

Clicking an admin/settings row resets the dashboard tab back to `'admin'`,
unmounts the embed, and renders the standard admin card content.
Each tool's internal sub-tab/hash scheme (e.g. `#skills/installed`,
`#logs?sessionId=…`) is unchanged.

### Admin as an overlay dialog

Admin is a dialog, not a page. The gear (`#admin-toggle` in the topbar cluster,
`sidebar-admin-toggle` in the docked sidebar cluster) sets `location.hash` to
`#admin`; nothing navigates away.

- `admin/adminDialogRoute.ts` is the pure policy: `ADMIN_SHELL_TABS` (the seven
  tabs the shell owns — `admin`, `memory`, `skills`, `logs`, `stats`, `servers`,
  `dreams-admin`), `isAdminShellTab`, `isAdminShellHash`, and
  `resolveAdminCloseHash`.
- `admin/useAdminDialogRoute.ts` **derives** `open` from `state.activeTab` rather
  than holding React state, so deep links (`#admin/settings/appearance`,
  `#admin/database/processes?page=2`) and browser back/forward drive the dialog
  for free. It records the last non-admin `location.hash` and `close()` restores
  it, falling back to `#repos` on a cold deep link.
- `App.tsx` lazy-mounts `<AdminDialog>` (keeping the large admin shell out of the
  initial bundle); `admin/AdminDialog.tsx` puts `AdminPanel` inside `ui/Dialog`
  with `max-w-[1100px] h-[85vh]`, `dense`, and a `renderHeader` that is just a
  `×` row — `AdminPanel` owns all interior chrome.
- `layout/Router.tsx` has **no** admin branch. While an admin hash is routed it
  keeps rendering the last non-admin tab, so the chat/notes/repo view underneath
  stays mounted and keeps its scroll position, and is simply revealed on close.
  That tab comes from `layout/useVisibleDashboardTab.ts`, the shared "what is
  actually on screen" hook (last non-admin tab, seeded with `repos`).
- Status dock: the admin sidebar hosts **no** `DockedStatusFooter` any more — the
  page behind the dialog keeps its own dock, and `GlobalStatusDock` therefore has
  no admin stand-down. Its remaining sub-tab stand-downs are evaluated against
  `useVisibleDashboardTab()`, not `state.activeTab`, so opening admin over Notes
  (or Settings / Git / PRs) doesn't flip them off and paint a second dock.

Hash parsing is untouched: `dashboardRoutes.ts` (`parseAdminSubTab`,
`parseSettingsSubTabFromHash`, `parseAdminDatabaseDeepLink`) and
`adminNavigation.ts` still own routing and nav policy.

**Writing tests against admin.** Two consequences of admin being modal trip up
E2E specs written for the old full page (`test/e2e/admin-dialog.spec.ts` covers
the dialog itself):

- While the dialog is open the page chrome — topbar tabs, hamburger, bottom nav —
  is behind the backdrop and cannot be clicked. Leaving admin means Escape, the
  `×`, a backdrop click, or setting `location.hash` directly.
- Any admin-shell hash (`#logs`, `#skills`, `#memory`, …) already has the dialog
  open, so clicking `#admin-toggle` to "go to admin" times out. Guard the gear
  click with `if (await page.locator('#view-admin').isVisible()) return;`.
- Opening admin no longer unmounts the view underneath — that is the whole point
  — so it can't be used to make another view go away. Navigate to a real
  non-admin tab (`location.hash = '#wiki'`) instead.

Below the shell's 600px container breakpoint the sidebar collapses into
`.ar-mobile-tab-select`; the nav buttons still exist but are hidden, so at phone
width sections are reached with `selectOption('settings:appearance')` etc.

### Skills Config panel & folder-source grouping

The Skills route's **Config** sub-tab (`features/skills/SkillsConfigPanel.tsx`)
renders five ordered sections: **Global Skills Directory** (read-only managed
install dir, falls back to `~/.coc/skills/` when the server omits
`globalSkillsDir`), **Global Extra Skill Folders** (chips with add/remove/Enter +
dedupe guard; persists `globalExtraFolders` via `skills.updateGlobalConfig`),
**Detected Skill Folders** (an auto-detect checkbox toggling
`autoDetectDefaultFolders`, the auto-detected entries from
`skills.getEffectivePaths()`, a concise "No OneDrive skill folders detected."
empty state, and skipped roots hidden in a collapsed `<details>` diagnostics
row), **Effective Search Order** (a read-only `<ol>` from
`getEffectivePaths()` called with NO workspaceId — global-only, with a "Showing
global paths only" note so repo-local/per-repo paths aren't claimed to apply
globally), and **Globally Disabled Skills** (unchanged; writes send only
`{ globalDisabledSkills }` so existing tests pass). Source badges: `managed-global
→ Managed`, `configured → Configured`, `auto-detected → Auto-detected`,
`repo`/`repo-extra → Repo`, `bundled → Bundled`. Status badges:
`available → Available`, `missing → Missing`, `no-skills → No skills`,
`skipped → Skipped`.

The skill-source taxonomy is defined by the server `SkillInfo.source`
(`skill-handler.ts`) and coc-client `SkillSource` (`contracts/skills.ts`); SPA
skill views consume the coc-client `SkillInfo` type. Repo Settings → Agent
Skills keeps pure source grouping, filtering, source presentation, and
resolution rows in `features/skills/skills-ui-model.ts`. A
`global-extra-folder` forms its own non-removable group (`🌐 <folderPath>`)
placed after global/repo and before per-repo extras because the Config tab owns
those folders.

`useWorkspaceSkillsController.ts` owns workspace list/config/detail loading,
toggle/delete mutations, extra folders, linked-repo preferences, optimistic
rollback, refresh, and visible errors. `RepoSettingsTab` injects
`getCocClientForWorkspace`; `RepoCopilotTab` injects the default SPA client, so
both hosts share behavior without losing clone routing. The panel composes
`SkillsSourceRail`, `SkillsResolutionOrder`, `WorkspaceSkillCard`,
`SkillFilePreview`, `LinkSkillSourcePopover`, and `InstallSkillsDialog`.
`useSkillInstallController` uses coc-client scan/install contracts rather than
local loose shapes. Request generations guard workspace/config/detail loads,
file previews, batched linked-repo probes, and install loads/scans so late
responses cannot replace the active workspace, card, source, or repo-list state.

### Remote-first shell

The remote-first navigation model is gated by `useRemoteShellEnabled()`
(`hooks/feature-flags/useRemoteShellEnabled.ts`), which reads the live
`features.remoteShell` admin flag (runtime flag `remoteShellEnabled`,
`isRemoteShellEnabled()` in `utils/config.ts`). It is a **global admin setting**
toggled in **Admin -> Configure -> Features -> Remote-first shell**
(`toggle-remote-shell-enabled`), defined once in `ADMIN_SETTING_DEFINITIONS`.
Enabled by default; desktop-only; takes effect on reload.

- **Single-row shell (`RemoteShellHeader`)** renders inside `TopBar` when
  `remoteShellEnabled`, the active tab is `repos`, a real repo is selected, and
  the viewport is not mobile. `RemoteScopeCluster` renders a boxed current-remote
  chip plus Work Items / Pull Requests pills; the chip opens a dropdown with
  recent remotes from global preference `recentRemotes` (MRU keys are
  `groupKey(group)`, capped at 8), default-group fallback before any MRU exists,
  search across all remotes, a Show all overflow, and add actions for Add
  workspace folder (`AddFolderDialog`), Add specific repository
  (`AddRepoDialog`), and Clone repository (`CloneRepoDialog`). Selecting a remote
  records it in the MRU and picks that remote's remembered clone when available,
  otherwise the first local-first clone. `WorkspaceTabsCluster` renders the
  existing clone switcher, clone popover, clone-scoped tabs, overflow menu, repo
  info/remove dialogs, and toast behavior in the same row. `TopBar` also renders
  `header-new-btn` as the first right-side action before the WebSocket status
  pill; it opens the enqueue dialog for the active clone. `ReposView` renders a
  `chromeless` `RepoDetail` for the active repo.
- **Virtual-workspace shell (`VirtualWorkspaceShellHeader`)** renders inside
  `TopBar` when `remoteShellEnabled`, desktop, the active tab is `repos`, and the
  selected workspace is a virtual one (`my_work` with My Work enabled, `my_life`
  with My Life enabled). Virtual workspaces have no real repo/git context, so they
  can't flow through `RemoteScopeCluster` / `WorkspaceTabsCluster`; instead they
  describe themselves with a `VirtualWorkspaceHeaderConfig` (`MY_WORK_HEADER_CONFIG`
  / `MY_LIFE_HEADER_CONFIG`, exported from `MyWorkView` / `MyLifeView`): identity
  chip + sub-tabs (Notes/Activity/Git/Schedules/Settings) + action buttons
  (Sync / Generate Summary). It mirrors `RemoteShellHeader`'s visual shell and
  reuses `useVirtualWorkspaceHeader` for sub-tab visibility, active-tab, tab
  navigation, and running the actions. The matching in-body variant
  (`VirtualWorkspaceInlineHeader`) renders inside `MyWorkView` / `MyLifeView`
  themselves in the classic shell and on mobile (where the TopBar header doesn't
  apply); the view gates it on `!(remoteShell && !isMobile)`.
- When `features.remoteShell` is on but neither a real repo nor a virtual
  workspace can back a header (a fresh desktop window with no selection, or any
  tab other than Repos such as Admin / Wiki), `TopBar` falls back to the classic
  `RepoTabStrip` so the top row stays consistent across every page and repository
  navigation is always visible. `RemoteShellHeader` (repos tab + real clone
  selected) and `VirtualWorkspaceShellHeader` (repos tab + virtual workspace)
  replace the strip; everywhere else the strip renders.
- **Scope slide switcher (`ScopeSlideSwitcher`)** — gated by the experimental
  `features.scopeSwitcher` admin flag (runtime flag `scopeSwitcherEnabled`,
  `isScopeSwitcherEnabled()` in `utils/config.ts`, live hook
  `useScopeSwitcherEnabled`; default **on**; remote-first desktop shell only).
  When on, `TopBar` replaces the standalone 💼 My Work / 🏠 My Life toggles and
  the identity chips inside both header variants with one sliding segmented
  control: `[💼 My Work] [🏠 My Life] [● workspace ⧉N ▾]`
  (`data-testid="scope-switcher"`, segments `scope-segment` with
  `data-scope="work|life|workspace"`, animated thumb measured via refs +
  `ResizeObserver`). The workspace segment embeds `WorkspaceIdentityChip` —
  the identity pill (status dot, provider badge, remote name, `⧉N` clone badge,
  chevron → `RepoPickerPopover` + add/clone dialogs). Its optional
  `groupIdentity={{ id, name }}` prop swaps that repo identity for a repo-group
  virtual workspace's: 🗂️ + group name, neutral dot, no provider badge, no `⧉N`
  (none of which describe the group), plus `data-repo-group-id` — kept separate
  from `data-remote-key`, which means the git-remote `RepoGroup` clustering. The
  chip was extracted from
  `RemoteScopeCluster`, which now renders that chip itself unless its
  `hideIdentity` prop is set (`RemoteShellHeader` and
  `VirtualWorkspaceShellHeader` forward `hideIdentity` so identity renders
  exactly once). Virtual-scope navigation (`goToMyWork` / `goToMyLife`,
  saved-note-path restore) lives in the shared `hooks/useScopeNavigation.ts`,
  used by both the switcher and the legacy toggles. Pinned off in
  `E2E_SERVER_CONFIG_YAML`.
- **Shared shell behavior** comes from `shellModel.ts` and `repoGrouping.ts`.
  Aggregated remote checkouts fold into the matching local origin's tab (by
  normalized git URL); a remote-only repo gets its own group. Group clones are
  sorted **local-first** by `groupReposByRemote`, so the default clone is local
  when one exists. `partitionShellTabs` keeps Work Items and Pull Requests
  remote-scoped. `computeCloneStatusMap` and `cloneStatusColor` drive clone dots:
  local clones stay queue-derived; remote clones blend connection-first via
  `blendRemoteCloneStatus` (`offline`/`failed` -> grey offline,
  `connecting`/not-yet-online -> blue connecting, online -> remote queue state).
  Offline remote rows stay visible but disabled/greyed with `data-offline="true"`
  and `clone-offline-badge`; online and connecting rows stay interactive. Clone
  tabs use a hidden measurement mirror plus `ResizeObserver` feeding
  `computeVisibleTabKeys`, so as many tabs as fit stay inline and the tail
  collapses into the overflow menu while keeping the active tab visible.
- **Shared repo-picker chrome.** The remote-picker dropdown (`RemoteScopeCluster`,
  rows = remote groups) and the virtual repo-picker dropdown
  (`VirtualWorkspaceShellHeader`, rows = individual repos) share one presentational
  shell `RepoPickerPopover` (fixed width, search box, scroll area, plus `PickerSection`
  / `PickerRow` / `PickerEmpty` primitives) and one interaction hook
  `useDropdownPopover` (open state + outside-click + Escape-close-and-refocus-trigger
  + search auto-focus). Row helpers `getServerName` / `isRepoOffline` / `shortPath`
  live in `repos/repoPickerModel.ts`, alongside the group markers `getGroupWsl`
  (all-or-nothing `WSL` pill) and `getGroupRemoteServers` (any-semantics: the
  deduped, sorted server names behind a group's remote clones, empty when
  local-only). The latter drives `RemoteServerBadge` — a tiny cloud glyph
  (`remote-server-badge`) on group rows whose collection includes at least one
  clone served by another CoC server; server names stay in the hover/accessible
  label, never in row text. The two callers keep their genuine differences
  (the remote picker's Add-repository footer + remote sub-tabs; the virtual picker's
  identity chip + navigation-only rows). Offline is surfaced per-repo in the virtual
  picker only; group rows show the aggregate status dot instead.
- **Repo groups in the picker.** `WorkspaceIdentityChip` renders a "Repo groups"
  `PickerSection` (rows `repo-group-item`, stacked-layers icon `repo-group-icon`)
  from the FULL AppContext workspace list filtered by
  `isRepoGroupWorkspaceId(id)` (`repos/virtualWorkspaceIds.ts`, prefix `group-`)
  — `repos` can't be the source because ReposContext strips virtual workspaces.
  The footer gains a "New repo group…" action (`remote-new-repo-group-option`)
  opening `repos/RepoGroupDialog.tsx` (create/edit: name + a Server dropdown +
  checkbox multi-select of that server's registered repos; free-form paths are
  never offered; edit prefills from `GET /api/repo-groups/:id` and badges stale
  members `path missing` / `removed`). Each group row's ⋮ menu
  (`repo-group-row-menu`) offers Edit group / Delete group; delete confirms via a
  Dialog (`repo-group-delete-confirm-btn`) then calls `DELETE /api/repo-groups/:id`
  (deregister only — the group's data dir stays on disk). Clicking a group row
  navigates to the group workspace via `useShellNavigation().selectClone` (rows
  mark `data-active` when selected).
- **Repo groups on a remote server.** A group lives in exactly ONE server's
  registry — the local dashboard's, or an online ssh/devtunnel CoC server's — and
  its members are always ids from that same server. `repos/repoGroupService.ts`
  wraps the REST surface with an optional trailing `baseUrl` routed through
  `getCocClientFor(baseUrl)` (omitted ⇒ the local origin client), so the dashboard
  talks to the remote's `/api/repo-groups` at its `effectiveUrl` directly — there
  is no server-side proxy route, and the remote's own `normalizeMembers`
  validation stays the source of truth (its errors surface inline in the dialog).
  `listRepoGroupServerOptions()` builds the dialog's Server dropdown
  (`repo-group-server-select`) from `/api/servers`: `Local` plus every remote
  whose runtime status is `online` with an `effectiveUrl` — offline servers are
  never offered, and an unreachable registry degrades to Local-only. Switching
  server clears the checked members (their ids mean nothing in the new registry),
  and the dropdown is DISABLED while editing because a group's server is fixed at
  creation. `RepoGroupDialog` takes `groupBaseUrl` for the group under edit so
  load and save both route to its owner. A 404 from create/save is reworded to
  "This server doesn't support repo groups." — a remote predating the feature has
  no such route, and there is no GET-list endpoint to probe it with.
- **Repo-group virtual workspace view.** Selecting a `group-<slug>` id renders
  `repos/RepoGroupView.tsx` (branch in `ReposView`, recognized by id PREFIX via
  `isRepoGroupWorkspaceId` — unlike My Work / My Life's id-equality checks, and
  with no feature flag). The view exposes ONLY a Workspace (chat, key `chats`,
  `RepoChatTab`) tab and a Notes tab (`NotesView`, notes root = the group's own
  workspace dir) — all git-dependent tabs are absent by construction.
  `getRepoGroupHeaderConfig(workspaceId, label)` builds the per-group
  `VirtualWorkspaceHeaderConfig` (`testIdPrefix: 'repo-group'`, `defaultTab:
  'chats'`, no actions); TopBar picks it for the `VirtualWorkspaceShellHeader`
  (label = registered workspace name, id fallback while loading), classic
  shell/mobile render `VirtualWorkspaceInlineHeader` in-body. Group selections
  never overwrite `lastWorkspaceRepoId` (AppContext guard), and
  `ScopeSlideSwitcher` gives an active group the workspace segment
  (`data-active-scope="group"`, `aria-selected`, thumb under it in a distinct
  green accent). It resolves the label with `resolveRepoGroupName(selectedRepoId,
  state.workspaces, remoteGroupWorkspaces)` and passes it as the chip's
  `groupIdentity`; the derivation stays in the switcher because it is gated on
  the repos tab. Pop-out / right-click target the group, and no switch-back is
  offered while a group is active — the pill reads the group's name, so the
  chevron's picker is the way out.

**Remote workspace aggregation** (gated by `features.remoteShell`): when the flag
is ON, `ReposContext.fetchRepos` also calls `aggregateRemoteWorkspaces()`
(`repos/remoteWorkspaceAggregation.ts`) in parallel with the local
`listWorkspaces()` + git-info batch. For each registry server (`/api/servers`)
that is `online`, it fetches `/api/workspaces` + the git-info batch + the queue
(`queue.repos()`) DIRECTLY at the server's `effectiveUrl` via a self-contained
`CocClient` (it does NOT reuse `getSpaCocClient` routing). Each remote workspace
is tagged with a `remote` marker `{ baseUrl, serverId, serverLabel, offline,
connection, queue }` plus a top-level `baseUrl` (the routing key — no composite
IDs, no serverId namespace); local workspaces carry neither, so
`isRemoteWorkspace()` distinguishes them. `connection` mirrors the registry's
runtime status (`online`/`connecting`/`offline`/`failed`/`idle`) so the status
dot can tell connecting from offline; `queue` is this workspace's remote queue
state (`running`/`queued`/`paused`/`idle`, from `remoteQueueStatusFromRepo` keyed
by `repoId` = workspace id), `'idle'` when offline or the resilient queue fetch
fails (a queue failure never drops the server). Remote rows are merged into the
same `RepoData[]` as local ones (git-info pre-resolved from the per-server batch)
and are skipped by the local Phase-2 git-info update. Offline / unreachable
servers contribute their last-known list from a two-layer (in-memory +
`localStorage['coc-remote-workspace-cache']`) per-server cache
(`repos/remoteWorkspaceCache.ts`), each entry flagged `offline` (with the real
`connection` preserved). `ReposContext` also retains the aggregation warnings so
target pickers can explain skipped or unavailable remote servers while leaving
healthy local and remote repositories usable. When the flag is
OFF, `aggregateRemoteWorkspaces()` returns empty and performs no remote fetch, so
the classic flow is unchanged.

`ReposContext` loads workspace topology, summaries, and the initial Git-info
batch together, but process lifecycle traffic never repeats that path. Its
WebSocket handler applies `process-added`, `process-updated`, and
`process-removed` payloads to `AppContext`; repository-card counts are derived
from that live process index in memory. Full discovery runs only for initial
load, `workspace-topology-changed`, `server-topology-changed`, reconnect recovery
after the first socket connection, or an explicit UI refresh. A `git-changed`
event requests Git info
for only that workspace through the clone-routing registry, so remote clones
stay on their owning server.

**Per-clone request routing**: a remote clone's REST + WS can be routed to its
server's `baseUrl` via opt-in primitives; the default `getSpaCocClient()`
singleton and the repos-list/git-info aggregation stay on the page origin.
`getCocClientFor(baseUrl?)` (`api/cocClient.ts`) returns the default singleton
when `baseUrl` is omitted, else a per-`baseUrl`-cached `CocClient` whose REST
(`/api` base) and `events` WebSocket target that origin.
`resolveCloneBaseUrl(ref, repos)` (`repos/cloneRouting.ts`) maps a workspace
object, workspace id, or remote clone key to its remote `baseUrl` (or
`undefined` when local) using the AC-01 remote markers. WS URL construction goes
through `cloneWsUrl(path, baseUrl?)`
(`api/wsUrl.ts`): with a `baseUrl` it derives `ws(s)://{host:port}{path}`
(http→ws, https→wss) keeping the path+query verbatim; without one it reproduces
the legacy `window.location` behavior. The shared `/ws` process-event stream
(`useWebSocket` → `getSpaCocClient().events`) is already baseUrl-aware through the
SDK's `buildWebSocketUrl`.

**Clone→baseUrl lookup registry + per-tab wiring (AC-07)**: every in-scope tab
(Activity/Chats, Git, Terminal, Explorer, Schedules, Pull Requests, Work Items,
Notes) loads and writes against a selected remote clone's own server, never the
local one. The seam is `repos/cloneRegistry.ts` — a module-level
`cloneKey → baseUrl` map plus `workspaceId → cloneKeys` index (remote workspaces
only) that `aggregateRemoteWorkspaces` populates on every repo refresh via
`registerCloneBaseUrls` (full replace, covering online AND cached/offline rows;
cleared when the flag is OFF or the registry is unavailable). Remote markers
carry `remote.cloneKey = remote:${encodeURIComponent(serverId)}:${encodeURIComponent(workspaceId)}`;
`repos/cloneIdentity.ts` centralizes clone-key build/parse, selection ids, and
old path-only fallback resolution: `#repos/ws-*` links that no longer match a
registered workspace are matched by the legacy root-path hash to the migrated
local workspace, or to a single unambiguous remote clone key. Unique remote
workspace ids still resolve directly; when cached/legacy rows collide on
workspace id, `ReposContext` records the selected clone key with
`setActiveCloneForRouting(...)` so bare workspace-id service calls from the
selected `RepoDetail` resolve to the chosen server instead of the other clone.
The registry exposes `lookupCloneBaseUrl(workspaceIdOrCloneKey)`,
`getCocClientForWorkspace(workspaceIdOrCloneKey)` (= `getCocClientFor(lookupCloneBaseUrl(id))`,
falling back to `getSpaCocClient()` for a local/unknown id so local behavior is
byte-for-byte unchanged), `cloneApiBase(workspaceIdOrCloneKey)` (absolute remote
REST base for hand-built URLs like the `EventSource` process stream),
`cloneWsUrlForWorkspace(path, workspaceIdOrCloneKey)`,
`remoteCloneApiBase(workspaceIdOrCloneKey)` (absolute remote REST base, or
`undefined` for a local id, so call sites that hard-code a relative `/api/...`
URL — e.g. the NoteEditor image URLs — keep that literal locally), and
`requestForWorkspace(workspaceIdOrCloneKey, url, options?)` (clone-routed analog
of `requestSpaApi` that fetches a RELATIVE api path against the clone — same
`toSpaCocRequestOptions`/error-translation as `requestSpaApi`, used by the git
diff-viewing layer which builds a bare path and then fetches it). The routing hooks
(`useResolveCloneBaseUrl()`, `useCocClient(ref?)`, `useCloneWsUrl(ref?)`) resolve a
bare workspace id through this registry (no `ReposContext` dependency, so they are
safe in deep per-tab components and unit tests) and a workspace **object** from its
own marker.

**Path→workspace resolution must fold remote rows back in.** `ReposContext`
dispatches only the LOCAL `listWorkspaces()` result into `AppContext`; remote
workspaces are merged into the repos list only. Any surface that resolves a
clicked file path (docked source canvas + its tree + note editor, the floating
markdown-review dialog) therefore goes through
`repos/workspacesWithRemote.ts`: `useWorkspacesWithRemote()` inside
`<ReposProvider>`, or the non-hook `withRemoteWorkspaces(workspaces)` above it
(App.tsx's `coc-open-markdown-review` handler), which reads the module-level
snapshot `getRemoteWorkspacesSnapshot()` published by
`aggregateRemoteWorkspaces`. Skipping this makes a remote `.md` link resolve to
no workspace ("No matching workspace found"). Both NoteEditorIO adapters
(`tasks/TasksNoteEditorIO.ts`, `tasks/WorkspaceFileNoteEditorIO.ts`) then route
load/save/upload through `getCocClientForWorkspace(workspaceId)` and prefix
image URLs with `remoteCloneApiBase(workspaceId)`.

Wiring is at the per-feature HOOK/SERVICE seam where a `workspaceId` is already
the input:
- React components/hooks call `useCocClient(workspaceId)` and use the returned
  client for all clone-scoped REST: `useGitInfo`, `TerminalView` (terminal
  list/pin), `ChatDetail` (every `processes`/`queue`/`notes`/`canvases`/`skills`
  call), `RepoSchedulesTab` (schedule CRUD + notes-git status),
  `WorkItemSection` + `WorkItemHierarchyTree` (list/tree/mutations),
  `WorkItemExecuteDialog` (skill-list load),
  `PullRequestsTab` (list/suggestions/roster/classification), and
  `NativeCliSessionsPanel` (native CLI session list + detail, which read the
  host machine's session store off `workspace.rootPath`).
- **`QuickOpen` (Ctrl+P) searches on the server.** It fetches nothing when the
  dialog opens, debounces keystrokes (`SEARCH_DEBOUNCE_MS`, 40 ms) into a single
  aborted-on-change `explorerApi.searchFiles` call, and renders the server's
  ranking as-is. Highlighting uses the `indices` each result carries — the
  positions the scorer actually matched — via `splitIndices` + `highlightMatches`,
  so the highlight cannot disagree with the ranking. Do not reintroduce a bulk
  `listFiles` fetch or client-side `rankFuzzyMatches`: on a large repo the path
  list is multiple megabytes and matching it on the render thread stalls typing.
  `ExactOpen` already used the same server-search shape.
- Non-React services that take a `workspaceId` resolve via
  `getCocClientForWorkspace(workspaceId)`: `explorerApi.*`, `notesApi.*`, and the
  recent-skills hook `useRecentSkills` (per-workspace preferences get/patch).
- Several React components route their workspace-scoped calls through the registry
  seams inline (not the hook) — `requestForWorkspace(id, url, opts?)` for raw
  fetches, `getCocClientForWorkspace(id)` for typed-client calls: `EnqueueDialog`
  (`/summary` + `/skills/all` loads, the `queue.enqueue` mutation, and
  `recordSkillUsage`), `RepoSettingsTab` (mcp-config, instructions, processes,
  description PATCH, plus Agent Skills through its injected
  `useWorkspaceSkillsController` resolver), `useMcpServerInspectorController`
  (tool discovery, server detail, add/update/migrate/delete, the tools allow-list
  PUT, and — via `cloneApiBase(workspaceId)` — the raw `mcp-oauth/start` fetch and
  its status poller, so an OAuth token is stored on the host that owns the repo),
  `RepoDetail` (work-items badge preview),
  `WorkItemsTab` (commit file list), and `BranchPickerModal` (branch list/switch).
  `EnqueueDialog`'s Workspace dropdown merges local `appState.workspaces` with the
  remote workspaces from `ReposContext.repos` (via `useReposOptional`, filtered by
  `isRemoteWorkspace`); remote rows are labeled `name [serverLabel]` and rendered
  `disabled` with an `(offline)` suffix when `remote.offline`. Selecting a remote
  workspace routes the enqueue to its server through the same
  `getCocClientForWorkspace` seam — no enqueue-path logic is remote-specific.
- Ralph source routing is transient and exact. `RepoDetail` threads its
  clone-qualified selection ID through Activity, direct-goal, and Notes launch
  surfaces; `PopOutChatShell` mounts `ReposProvider` and passes its parsed clone
  base URL as the source fallback. `RalphStartPanel` resolves that source against
  the current targets before reading `/fs/blob?path=...`, so an unresolved remote
  source cannot fall through to the local API. Same-target grilling starts use
  that target's `processes/:id/ralph-start` endpoint so the grilling session is
  reused; cross-workspace or cross-server starts use the selected target's
  `ralph-launch` endpoint with its physical `workspaceId`. Direct-goal launches
  forward `folderPath` and `workingDirectory` only when the selected target
  exactly matches the resolved source. Remote server IDs and effective URLs stay
  in component state and are not persisted into process or Ralph session data.
- The Ralph workflow pane routes its whole data flow to the clone: the per-session
  journal READ (`useRalphSessionView` -> `workspaces.ralphSession`) resolves its
  client via `getCocClientForWorkspace(workspaceId)`, and the continue/new-loop/
  resume mutations (`RalphWorkflowPaneContainer` / `RalphWorkflowPane`) go through
  `useCocClient(workspaceId)` -- so a remote clone's Ralph session is read and
  mutated on its own server (the bare local singleton 404s a remote-only session as
  "Ralph session not found").
- The Activity WRITE path `useSendMessage` routes `processes.sendMessage` /
  `promoteToRalph` through `getCocClientForWorkspace(workspaceId)`; the
  Activity events stream `useChatSSE` opens its `EventSource` at
  `cloneApiBase(workspaceId)`.
- The Workflows (pipelines) tab routes through the same seam:
  `features/workflow/workflow-api.ts` resolves every call (list/content/save/
  generate/refine/create/delete/run) via `getCocClientForWorkspace(workspaceId)`,
  and `WorkflowRunHistory` routes its `/queue/history` read the same way — that
  route answers 200 with an EMPTY list for an unknown `repoId`, so a missed route
  shows "no runs" rather than failing. Because `runWorkflow` enqueues on the
  SERVING host, the returned process exists only there: `WorkflowDetailView` takes
  a `workspaceId` and uses it for the process fetch AND the SSE stream URL (built
  off the routed client's own `baseUrl`). Remote repo rows get their workflow list
  from a per-workspace `/summary` fetch in `remoteWorkspaceAggregation`
  (keyed by workspace id and clone key, empty for offline/cached rows); the
  active-task list still comes from the LOCAL queue WebSocket.
- The Workflows (pipelines) tab routes through the same seam:
  `features/workflow/workflow-api.ts` resolves every call (list/content/save/
  generate/refine/create/delete/run) via `getCocClientForWorkspace(workspaceId)`,
  and `WorkflowRunHistory` routes its `/queue/history` read the same way — that
  route answers 200 with an EMPTY list for an unknown `repoId`, so a missed route
  shows "no runs" rather than failing. Because `runWorkflow` enqueues on the
  SERVING host, the returned process exists only there: `WorkflowDetailView` takes
  a `workspaceId` and uses it for the process fetch AND the SSE stream URL (built
  off the routed client's own `baseUrl`). Remote repo rows get their workflow list
  from a per-workspace `/summary` fetch in `remoteWorkspaceAggregation`
  (keyed by workspace id and clone key, empty for offline/cached rows); the
  active-task list still comes from the LOCAL queue WebSocket.
- The GLOBAL `/ws` event stream is mirrored per-clone by `RemoteCloneEventBridge`
  (`features/remote-shell/`, rendered inside `ReposProvider`): it opens one
  `getCocClientFor(baseUrl).events.connect(...)` socket per ONLINE remote clone
  (deduped by `baseUrl`, reconciled as clones connect/disconnect) and feeds every
  message into App's shared `onMessage`. Without it, `useWebSocket` only listens to
  the LOCAL `/ws`, so a remote task's `process-updated` lifecycle event never
  arrives and its sidebar row stays stuck "running" (the per-process SSE still
  shows the open conversation completing). This is the global-events counterpart to
  the per-process `useChatSSE` routing.
- The terminal PTY socket (`useTerminalWebSocket`) resolves the clone baseUrl
  from the registry and passes it into `cloneWsUrl`, so a remote clone's terminal
  targets its server. The `/ws` comment subscriptions (`useTaskComments` +
  `git/hooks/use*Comments`) already route through `cloneWsUrl`.
- The Git diff-viewing layer is routed too: `WorkingTree` /
  `WorkingTreeFileDiff` / `WorkingTreeAllComments` and the comment hooks
  (`useDiffComments`, `useAllCommitComments`, `useFileCommentCounts`,
  `useCommitCommentTotals`) use `useCocClient(workspaceId)` for their REST git
  calls (their `/ws` subscriptions stay on `cloneWsUrl` unchanged);
  `useClassification` / `useCommitClassificationStatus` route the
  PR classify-diff calls through `/api/origins/:originId/classify-diff*` with
  workspace/repo metadata and commit classify-diff calls through
  `/api/repos/:id/classify-diff*`, both via `useCocClient(workspaceId)`. The
  `DiffSource` factories (`createCommitDiffSource`/`createBranchRangeDiffSource`/
  `createPrDiffSource` in `git/diff/diffSource.ts`) resolve their path-builder
  client via `getCocClientForWorkspace(id)`, and `fetchDiffFromSource(workspaceId,
  url)` + `useCachedDiff` fetch the relative diff url via
  `requestForWorkspace(workspaceId, url)`. `useFileDiff(url, fullUrl?, workspaceId?)`
  threads the id from `FileDiffPanel`. Non-React `diffCommentApi`
  (`patchDiffComment`/`deleteDiffCommentById`) routes via
  `getCocClientForWorkspace(wsId)`.
- The review-chat and preference surfaces of the Git tab route the same way:
  `useCommitChatBinding` (binding read, queue enqueue, binding create, fresh-chat
  reset), `usePrChatBinding` (queue enqueue), `useFilesViewMode` (repo
  preferences get/update), and `CommitDetail`'s `git.commitDiffPath` builder all
  resolve their client with `getCocClientForWorkspace(workspaceId)`.
- The notes paper/PDF surface routes the same way. `usePaperAnnotations` (sidecar
  GET + the resolve and turns PATCHes), `PdfAnnotationsLayer` (follow-up answer,
  annotation DELETE, `paperAnnotationsExportUrl` export), `PdfQuickAskLayer` and
  `PdfRegionAskLayer` (annotation POST/PATCH) and `NoteQuickAskLayer` all call
  `requestForWorkspace(workspaceId, path, opts)`. Two distinct failures motivate
  this: the paper-annotations routes begin with `resolveWorkspaceOrFail` so a
  local-origin call hard-404s, while `POST /api/quick-ask/answer?workspace=` only
  validates the id SHAPE — it never looks the workspace up — so a local-origin
  call runs the model on the WRONG host with the wrong workspace's model config
  and returns 200. `NoteEditorIO`'s `imageApiUrl` / `localImageApiUrl` /
  `ingestPaper` build their URLs from a `notesApiBase(workspaceId)` helper
  (`cloneApiBase` when remote, the literal `/api` when local) because those URLs
  are consumed by `<img src>` / `data-pdf-url` / a raw `fetch`. `noteMarkdown`'s
  `rewriteImageSrcToRelative` accepts an optional `scheme://host` prefix on every
  pattern so a remote clone's origin is never baked into the persisted `.md`.

- Chat Quick Ask side-notes route the same way: `useQuickAskSidenotes` sends its
  hydrate GET, lookup POST and DELETE through `requestForWorkspace(workspaceId,
  path, opts)`. The `/api/processes/:id/sidenotes` routes only call
  `isValidWorkspaceId` — no workspace resolution — so a local-origin call for a
  remote clone answered 200 while the manager created a real
  `{dataDir}/repos/<remote-id>/chat-sidenotes/<sha256(processId)>.json` tree on the
  LOCAL disk (and the POST's local `processExists` check then failed anyway).

No-local-fallthrough guarantee: a selected remote clone's clone key, or its bare
workspace id when unique / active-disambiguated, resolves to its `baseUrl`, so
its clone-scoped REST/WS never hit the default local client; an OFFLINE-selected
clone still resolves to its last-known `baseUrl` (degrades to empty/cached UI,
never a silent local call) because cached/offline rows are registered too.

The sub-tab taxonomy and feature-flag/git/layout gating live in
`features/repo-detail/repoSubTabs.ts` (`SUB_TABS`, `VISIBLE_SUB_TABS`,
`TAB_GROUP_INDEX`, `computeVisibleSubTabs`), shared by both `RepoDetail` and the
shell so the two stay behaviorally identical. Selection/routing reuse
`buildRepoSubTabSuffix` via `useShellNavigation`. `SHOW_WIKI_TAB` / `SHOW_MEMORY_TAB`
live in a dedicated lightweight `navFlags.ts` (read by `repoSubTabs.ts`; re-exported
from `TopBar` for `BottomNav`/`Router`) — kept out of the heavily-mocked
`featureFlags.ts` so partial test mocks of it don't break on the missing export.
When `features.splitWorkspacePanel` is enabled, both `RepoDetail` and the
remote-shell `WorkspaceTabsCluster` pass the flag into `computeVisibleSubTabs`,
so the clone-scoped standalone Git tab is hidden and the chat tab label becomes
Workspace while Git remains available inside `SplitWorkspacePanel`.
## AI Provider page

The Admin AI Provider page's Provider routing subtab exposes the single `features.autoAgentProviderRouting` toggle. When enabled, Auto becomes the default for omitted-provider chats, tasks, and API-created work; explicit provider selections and follow-ups keep their provider. The same subtab lets admins reorder provider rules, toggle each rule, edit normal minimum remaining quota percentages, toggle and edit weekly guard thresholds, choose a fallback provider, and preview the concrete provider selected by the shared Auto router using the current availability state plus cached quota response. The Default Provider buttons only select concrete providers (`copilot`, `codex`, `claude`) for the non-Auto fallback path. The Refresh quota button force-refreshes the provider quota cache and updates the preview. When Auto is disabled, the rule editor is hidden behind an Auto-disabled message.

The Admin AI Provider page's `ProviderEffortTiersSection` uses the same tier order (`Very Low`, `Low`, `Medium`, `High`) when editing provider defaults. Rows sourced from hardcoded provider defaults are prefilled and marked with a `Default` badge; saving persists only rows explicitly changed from those defaults, and clearing an override reverts that row to its provider default.

Framework-free quota math lives in `@plusplusoneplusplus/coc-client`'s
`quota.ts`: it clamps remaining and used display percentages, splits finite and
unlimited pools, and selects the tightest finite quota across one provider or
across enabled providers. `shared/quotaUtils.ts`
re-exports that public math while keeping dashboard-only quota-window labels and
risk classes. Known provider windows label `five_hour` as `5h` and
`seven_day` as `Weekly`; unknown ids are converted to readable text. The Admin
provider routing table uses those helpers for quota cells: Codex and Claude
finite `quotaTypes[]` snapshots render as compact per-window rows with a
readable quota-window label, remaining percentage, used/entitlement caption,
and remaining-usage bar. Copilot finite quotas render as the single
tightest-limit row used by the legacy quota cell. The page-level quota-risk
summary uses the tightest finite quota across all providers. When the non-container
Admin AI Provider tab is active, `AdminPanel` loads
`admin.getAgentProvidersQuota()` without `force` so the page displays the
server's cached quota snapshot after refresh or tab entry; the page's Refresh
quota button still calls the force path. The desktop
top-bar `AgentProviderQuotaIndicator` uses the same helpers to fill a circular
gauge to the most-constrained enabled provider's used percentage and to render a
NotificationBell-style dropdown. The dropdown lists one row per enabled
provider; each row's gauge and risk badge are driven by that provider's tightest
finite quota window, while the body lists every finite quota window (e.g. both
`5h` and `Weekly`) with its used/entitlement caption and a minute-level UTC reset
timestamp (`YYYY-MM-DD HH:MM`) plus a remaining-time countdown (`Xd Yh left` for
multi-day windows, `Xh Ym left` otherwise, or `due` once elapsed). It also
shows an unlimited badge for all-unlimited providers, provider-level errors, a
last-updated line,
a force-refresh button that calls `admin.getAgentProvidersQuota({ force: true })`,
and an `#admin/agents` link to the AI Provider page.
