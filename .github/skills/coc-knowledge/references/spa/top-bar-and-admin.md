# Dashboard SPA — Top Bar & Admin

The top bar's action cluster and the admin overlay dialog. The remote-first shell that
can replace the top row lives in [remote-shell.md](remote-shell.md).

## Top Bar

The right-hand action cluster is
`[Connected pill | NotificationBell | AgentProviderQuotaIndicator | Admin | Theme]`, with
the quota indicator hidden below the `md` breakpoint. The mobile CoC/hostname link is a
shrinkable truncated flex item so the action cluster stays reachable on narrow phones.

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
Notes, Settings, Git, or PRs does not flip them off and paint a second dock.

Hash parsing stays in `dashboardRoutes.ts` (`parseAdminSubTab`,
`parseSettingsSubTabFromHash`, `parseAdminDatabaseDeepLink`) and `adminNavigation.ts`.
Below the shell's 600px container breakpoint the sidebar collapses into
`.ar-mobile-tab-select`; the nav buttons still exist but are hidden, so at phone width
sections are reached with `selectOption('settings:appearance')`.

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
  (`location.hash = '#wiki'`) instead.

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
provider-level errors. Its force-refresh button calls
`admin.getAgentProvidersQuota({ force: true })` and it links to `#admin/agents`.
