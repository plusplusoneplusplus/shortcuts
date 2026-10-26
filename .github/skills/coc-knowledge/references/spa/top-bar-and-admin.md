# Dashboard SPA — Top Bar & Admin

The top bar's action cluster and the admin overlay dialog. The remote-first shell that
can replace the top row lives in [remote-shell.md](remote-shell.md).

## Top Bar

The right-hand action cluster is
`[Connected pill | NotificationBell | AgentProviderQuotaIndicator | Admin | Theme]`, with
the quota indicator hidden below the `md` breakpoint. The mobile CoC/hostname link is a
shrinkable truncated flex item so the action cluster stays reachable on narrow phones.
Repository and group scopes expose the right-panel toggle at every breakpoint;
Work Items and Pull Requests open from that panel's add-tab menu.

### Admin sidebar groups

The admin sidebar is grouped by user task: Configure, Knowledge, Connections,
Operations, and Developer / Internals. Embedded tool rows keep stable ids
(`memory-toggle`, `skills-toggle`, `dreams-admin-toggle`, `logs-toggle`, `stats-toggle`,
`servers-toggle`) with `data-tab` carrying the matching dashboard route. Servers appears
only when `isServersEnabled()`. The Knowledge group's Dreams row (`dreams-admin-toggle`,
route `#dreams-admin`) renders `features/dreams/DreamsView.tsx` — the admin home for
global Dreams config (see [../admin-config.md](../admin-config.md)) plus the queue +
history **Dreams provider activity** section
(`features/dreams/ProviderActivitySection.tsx`). It is distinct from the per-workspace
`DreamsPanel`.

Clicking an embedded tool row dispatches `SET_ACTIVE_TAB` and sets `location.hash` to the
top-level route (`#memory`, `#skills`, `#dreams-admin`, `#logs`, `#stats`, `#servers`).
Each of those hashes plus `'admin'` opens the admin overlay dialog, so the admin shell
stays mounted across navigation. `AdminPanel` switches on `state.activeTab`: an embedded
tool route mounts its View inside an `.ar-tool-embed` flex column instead of the standard
`.ar-page` card grid; an admin/settings row resets the tab to `'admin'`, unmounts the
embed, and renders standard admin cards. Each tool's internal sub-tab scheme
(`#skills/installed`, `#logs?sessionId=…`) is untouched.

Connections uses `#admin/messaging`: normal CoC renders `TeamsConnectionCard` for the
global Teams MCP endpoint and team/channel inbound bridge, followed by
`WhatsAppConnectionCard` for pairing and selecting a single group. Container
mode renders `IMSettingsSection` for its separate WhatsApp and Teams relay;
both WhatsApp surfaces share QR and connection-status presentation. The Teams card shows
connection and OAuth status, saves the endpoint and channel separately, and returns
a user-clickable Microsoft sign-in link for native server-owned OAuth. It polls the
shared pending state and enables or reconnects the bridge after native verification
and secure persistence. The container form also displays native instructions,
polls its auth status and offers cancellation; it handles no browser PKCE or
authorization-code exchange. See [MCP authentication](../mcp-settings.md#teams-channel-connection).
The channel input stays editable and reflects the owning server's configured
name, including its per-machine default for new settings. The card advises a unique
channel per machine to prevent multiple bridges from processing the same messages.
Both Teams forms expose explicit optional IC3 region configuration, saved with connection
settings and applied on reconnect. Unconfigured leaves channel reads/sends available;
IC3 writes require a region. The container stores it under `messaging.teams.ic3Region`
in `config.yaml`; an absent bridge requires restart.
The normal Teams page starts with a responsive status grid: channel connection,
OAuth and channel Trouter health alongside independent IC3 own-command read and
notification health. Saved read/write backends, channel and region are configuration
facts, not delivery checks. Missing notification snapshots show unavailable, not
disabled, unless own commands are disabled. Errors remain visible in this overview.
`TeamsConnectionCard` owns channel polling and configuration and accepts the
`TeamsIc3StatusCard` as status content, avoiding duplicate status readers.
Detailed configuration follows the overview, grouping endpoint/sign-in and channel settings separately,
with optional outbound-backend, IC3 and notification settings in a native advanced-options disclosure.
`outboundBackend` defaults to Graph, with explicit MCP available; Graph channel sends/replies require separate
server-side Azure CLI credentials matching the MCP reader, with delegated `ChannelMessage.Send`
(recommended for new clients) or an existing `Group.ReadWrite.All` compatibility grant.
Saving backend changes disconnects; reconnect validates credentials before writes.
Channel roots and enabled thread replies always use Graph, including explicit MCP
outbound selections; MCP owns discovery/create. The card exposes read consent guidance
outside the advanced disclosure: delegated `ChannelMessage.Read.All`, separately from
send consent, with Azure CLI credentials matching the configured MCP account.
Sign-in alone does not grant consent; failed reads never fall back and ambiguous sends never replay.
Its controls use scoped admin styles; connection/OAuth and notification errors stay
visible independently of disclosures. It exposes experimental `enableTrouter`, default off,
saved through `/api/messaging/teams/config` and applied on reconnect. Its separate Azure CLI
IC3 sign-in must match MCP; notification wakes retain authoritative reads and a
60-second completion-relative fallback. This private protocol is not durable catch-up.
It always displays channel-bridge Trouter state, including disabled or unavailable,
from `notificationStatus`; enabled notifications show fallback cadence and sanitized
errors separately from reader connectivity, outside collapsed settings.

The Teams-only registry controls (`features.teamsBridgeObservability`,
`features.teamsAiAnswerRelay`, `features.teamsMessageReaction` and the independent
IC3 own-command enable/workspace settings and reaction-delegation enable/workspace/skill
settings; `ui.tab: 'teams'`) render
only in a "Teams features" card below detailed configuration on Connectors → Teams. That card
saves only its keys through `PUT /api/admin/config`, separately from the connection's
`/api/messaging/teams/*` actions; Ctrl+S there saves only the card. Features search links
them to `#admin/messaging`. The IC3 workspace picker lists local registrations from
the selected Admin server. Saving enabled IC3 settings starts the
[Ask launcher](../admin-config.md#ic3-own-command-configuration).
The Reaction delegation group uses the same responsive admin rows and page-scoped
Save/Cancel. Its dispatcher picker reads installed skills for the selected execution
workspace, excludes disabled names and preserves unavailable saved selections with
visible errors. Machine/workspace changes discard late lists; enabled saves recheck
the binding on the selected machine. The configuration surface does not launch
reaction jobs. See [delegation configuration](../admin-config.md#teams-reaction-delegation-configuration).
`TeamsIc3StatusCard` polls the selected Admin machine's read-only
`/api/messaging/teams/ic3-own-commands/status` every five seconds for read health,
timestamps and independent own-command Trouter health. Refresh only reads the
snapshot. Failures clear stale status; machine changes/unmount abort reads and
reject late results.
Shared `features.botManagedConversations` stays on Integrations.

`features.teamsAiAnswerRelay` defaults on, including omitted
config, with explicit false as a live opt-out. The registry suppresses its experimental
badge for this enabled default. Its hint and the Connections routing help explain
captured-thread Ask answers and safe terminal notices, independent bridge activation,
and disabling relay/thread polling without restart or reconnect. It does not enable
Autopilot, connectivity, Likes or Trouter.

With `features.teamsBridgeObservability` enabled, the normal Teams card loads
server-global, newest-first connection attempts from the guarded messaging API.
Its collapsed history disclosure contains expandable native `<details>` rows with safe
phase and activity timelines, poll/reply health, and aggregate counts. History fetch failures retain and mark
the previous page stale; the existing connection/OAuth controls remain available.

## Admin as an overlay dialog

Admin is a dialog, not a page. The gear (`#admin-toggle` in the topbar cluster,
`sidebar-admin-toggle` in the docked sidebar) sets `location.hash` to `#admin`; nothing
navigates away.

| Module | Role |
|---|---|
| `admin/adminDialogRoute.ts` | Pure policy: `ADMIN_SHELL_TABS` (the seven shell-owned tabs — `admin`, `memory`, `skills`, `logs`, `stats`, `servers`, `dreams-admin`), `isAdminShellTab`, `isAdminShellHash`, `resolveAdminCloseHash` |
| `admin/useAdminDialogRoute.ts` | **Derives** `open` from `state.activeTab` instead of holding React state |
| `admin/AdminDialog.tsx` | Puts `AdminPanel` in a `dense` `ui/Dialog`; `renderHeader` is just a `×` row and `AdminPanel` owns all interior chrome |

Deriving `open` from the active tab is what makes deep links
(`#admin/settings/appearance`, `#admin/database/processes?page=2`) and browser
back/forward drive the dialog for free. The hook records the last non-admin
`location.hash` and `close()` restores it, falling back to `#repos` on a cold deep link.
`App.tsx` lazy-mounts `<AdminDialog>` to keep the admin shell out of the initial bundle.

`layout/Router.tsx` has **no** admin branch. While an admin hash is routed it keeps
rendering the last non-admin tab, so the chat/notes/repo view underneath stays mounted,
keeps its scroll position, and is revealed on close. That tab comes from
`layout/useVisibleDashboardTab.ts`, the shared "what is actually on screen" hook (last
non-admin tab, seeded with `repos`).

The admin sidebar hosts no `DockedStatusFooter`: the page behind the dialog keeps its own
dock, so `GlobalStatusDock` needs no admin stand-down. Its remaining sub-tab stand-downs
evaluate against `useVisibleDashboardTab()`, not `state.activeTab`, so opening admin over
My Work / My Life Notes or Settings, Git, or PRs does not flip them off and paint a
second dock. A repo group always defers to its Workspace footer.

Hash parsing stays in `dashboardRoutes.ts` (`parseAdminSubTab`,
`parseSettingsSubTabFromHash`, `parseAdminDatabaseDeepLink`) and `adminNavigation.ts`.
Configure includes a registry-driven Sentinel settings tab at `#admin/settings/sentinel`;
its inventory, discovery and draft boundaries are documented in
[Admin Config](../admin-config.md#sentinel-settings).
Below the shell's 600px container breakpoint the sidebar collapses into
`.ar-mobile-tab-select`; the nav buttons still exist but are hidden, so at phone width
sections are reached with `selectOption('settings:appearance')`.

### Admin machine target

With `features.adminMachineSwitch` (default on; an explicit false opts out) in
the desktop shell, outside container mode, `AdminDialog` wraps `AdminPanel` in
`AdminTargetProvider` + `AdminTargetGate` (`admin/adminTarget.tsx`). The flag is read once per open from
the connected server. A "Configure machine" `<select>` in the Admin top bar lists
the connected server first, then the connected server's registry
(`servers.list()`, never the target's). Rows show credential-free connection
hints for duplicate labels and status text. Selection is in-memory only: every
dialog mount starts on the connected server, and embedded-route navigation keeps it.

Server-owned Admin code reads `useAdminServer()`: `client`, `apiBase`/`rawApiBase`,
`resolveUrl`, `fetch`, `isRemote`, `cacheScope`, `label` and target `serversEnabled`.
Without the provider it returns page-origin defaults. Each selection gets a
scoped `CocClient` that aborts reads on switch and counts writes; the selector is
disabled while writes or registered saves are pending. The gate remounts content
per selection. Remotes mount only after an `/api/health` identity check against
the registry entry; offline, removed, unreachable and mismatched targets show an
unavailable panel with Retry and never fall back locally. Network errors on a
ready remote show a banner, keep drafts and refuse writes until Retry re-checks
the same target. Remote saves skip local side effects (`applyRuntimeConfigPatch`,
display-setting invalidation, onboarding, reload after restart). Memory uses
`useMemoryV2Api()` so workspace writes stay on the target, provider-model hooks take an
owner `{ baseUrl, client }`, the Servers view edits the target's registry, and
memory process links are disabled for remote targets.

Ownership: config/features, preferences, AI provider routing/models/effort tiers,
provider credentials, prompts, Teams/WhatsApp (including OAuth polling), memory,
skills, Dreams, logs, usage stats, server name/restart, backup/reset, storage and
the database browser follow the target. Link handlers, Desktop Preferences
(browser engines/profiles/history) and the welcome tour stay local and are badged
"This desktop" while the switch is active. Drafts register through
`useAdminDirtyGuard`. Switching while dirty offers Save / Discard / Cancel; Save
switches only once every draft is clean on the original machine; otherwise
the outstanding cards are listed and target and edits stay. Destructive confirmations name the target.

### Writing tests against admin

Three consequences of admin being modal (`test/e2e/admin-dialog.spec.ts` covers the
dialog itself):

- Page chrome — topbar tabs, hamburger, bottom nav — sits behind the backdrop and cannot
  be clicked while the dialog is open. Leaving admin means Escape, the close control, a
  backdrop click, or setting `location.hash` directly.
- Any admin-shell hash (`#logs`, `#skills`, `#memory`, …) already has the dialog open, so
  clicking `#admin-toggle` to "go to admin" times out. Guard it with
  `if (await page.locator('#view-admin').isVisible()) return;`.
- Opening admin does not unmount the view underneath — that is the whole point — so it
  cannot be used to make another view go away. Navigate to a real non-admin tab
  (`location.hash = '#reports'`) instead.

## Skills Config panel

The Skills route's **Config** sub-tab (`features/skills/SkillsConfigPanel.tsx`) covers
global skill configuration only:

- Global Skills Directory — read-only, falls back to `~/.coc/skills/` when the server
  omits `globalSkillsDir`.
- `globalExtraFolders` and `autoDetectDefaultFolders` persist through
  `skills.updateGlobalConfig`; detected folders and skipped roots come from
  `skills.getEffectivePaths()`.
- Effective Search Order calls `getEffectivePaths()` with **no** workspaceId, so it is
  global-only — repo-local and per-repo paths do not apply globally.
- Globally Disabled Skills writes send only `{ globalDisabledSkills }`.

### Skill source taxonomy

`SkillInfo.source` on the server (`skill-handler.ts`) and `SkillSource` in coc-client
(`contracts/skills.ts`) define the taxonomy; SPA skill views consume the coc-client
`SkillInfo` type. Repo Settings → Agent Skills keeps source grouping, filtering,
presentation, and resolution rows in `features/skills/skills-ui-model.ts`. A
`global-extra-folder` forms its own non-removable group placed after global/repo and
before per-repo extras, because the Config tab owns those folders.

`useWorkspaceSkillsController.ts` owns workspace list/config/detail loading,
toggle/delete mutations, extra folders, linked-repo preferences, optimistic rollback,
refresh, and visible errors. `RepoSettingsTab` injects `getCocClientForWorkspace` while
`RepoCopilotTab` injects the default SPA client, so both hosts share behavior without
losing clone routing ([clone-routing.md](clone-routing.md)). The panel composes
`SkillsSourceRail`, `SkillsResolutionOrder`, `WorkspaceSkillCard`, `SkillFilePreview`,
`LinkSkillSourcePopover`, and `InstallSkillsDialog`; `useSkillInstallController` uses
coc-client scan/install contracts. Request generations guard workspace, config, detail,
file-preview, linked-repo-probe, and install loads so late responses cannot replace the
active workspace, card, source, or repo list.

## AI Provider page

### Provider routing

The Provider routing subtab exposes the `features.autoAgentProviderRouting` toggle. With
it enabled, Auto is the default for omitted-provider chats, tasks, and API-created work,
while explicit selections and follow-ups keep their provider; with it disabled the rule
editor is replaced by an Auto-disabled message. The subtab also reorders and toggles
provider rules, edits minimum remaining quota percentages and weekly guard thresholds,
chooses a fallback provider, and previews the provider the shared Auto router would pick
from current availability plus the cached quota response. Default Provider buttons select
concrete providers (`copilot`, `codex`, `claude`) for the non-Auto fallback path only.

`ProviderEffortTiersSection` edits provider defaults in tier order (`Very Low`, `Low`,
`Medium`, `High`). Rows sourced from hardcoded provider defaults are prefilled and badged
`Default`; saving persists only rows explicitly changed, and clearing an override reverts
that row to its provider default.

### Quota math and display

Framework-free quota math lives in `@plusplusoneplusplus/coc-client`'s `quota.ts`: it
clamps remaining and used display percentages, splits finite from unlimited pools, and
selects the tightest finite quota across one provider or across enabled providers.
`shared/quotaUtils.ts` re-exports that public math and adds dashboard-only quota-window
labels and risk classes — `five_hour` labels as `5h`, `seven_day` as `Weekly`, unknown
ids convert to readable text.

The provider routing table renders Codex and Claude finite `quotaTypes[]` snapshots as
per-window rows and Copilot's as a single tightest-limit row; the page-level quota-risk
summary uses the tightest finite quota across all providers. While the non-container AI
Provider tab is active, `AdminPanel` loads `admin.getAgentProvidersQuota()` **without**
`force`, so the page shows the server's cached snapshot; only Refresh quota calls the
force path.

The desktop `AgentProviderQuotaIndicator` gauges the most-constrained enabled provider's
used percentage and opens a dropdown with one row per enabled provider. Each row's gauge
and risk badge follow that provider's tightest finite window; the body lists every finite
window with its used/entitlement caption, UTC reset timestamp, and countdown, plus
provider-level errors. `StatusActions` passes the active clone-qualified repo or repo-group
selection into `useAgentProvidersQuota`, so initial load, polling, and force refresh use the
owning server. Changing owner clears the displayed snapshot, and an unresolved remote route
shows its own error without falling through to page-origin quota. It links to
`#admin/agents`; that Admin page follows the Admin machine target. An optional
`railContainer` adds a collapsed-rail trigger sharing the same hook and dropdown
(see [shell.md](shell.md), `features.railStatusActions`).
