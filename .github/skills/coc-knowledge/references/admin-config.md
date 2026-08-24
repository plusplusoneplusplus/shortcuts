# Admin Config & Admin UI Styling

Covers the editable admin config registry in `packages/coc/` and the self-contained styling system for the admin route in the dashboard SPA. Load this when adding or modifying any admin-exposed configuration field or admin UI element.

## Unified Admin Setting Registry

Admin-editable settings have ONE source of truth: `ADMIN_SETTING_DEFINITIONS` in `packages/coc/src/config/admin-setting-definitions.ts`. Each definition declares:

- the flat key (e.g. `'cron.enabled'`) and a value spec (`boolean` | `string` | `number` | `enum` | `custom`) that validation derives from
- the resolved `default` and the `runtime` behavior (`live` / `restartRequired`)
- optional `absentFallback` — the value assumed when a partial config lacks the key, used for bootstrap-conservative flags whose resolved default is on
- optional `runtimeFlag` (a property name in `RuntimeDashboardConfig.features`), optional `customMerge` escape hatch, and optional `ui` metadata (group/order/label/hint/badge/dependsOn/control/testId) for the admin Features card

The file is dependency-free (no Node/zod imports) because the SPA bundle imports it directly.

### Derived Consumers

| Module | Role |
|--------|------|
| `server/admin/admin-config-fields.ts` | Maps definitions to `ADMIN_CONFIG_FIELDS` (validate/apply specs), consumed unchanged by the `PUT /api/admin/config` handler and `RuntimeConfigService` |
| `config/schema.ts` | Generates a zod fragment per setting, deep-merged with a hand-written base tree that declares only non-admin fields (queue, models, logging, monitoring, skills, memoryPromotion, serve host/port, `features.autoMemoryPromotion`/`gitCommitLookup`). `kind: 'custom'` settings must register a file schema in `CUSTOM_FILE_SCHEMAS` |
| `config/namespace-registry.ts` | Merges every dotted key generically (`override ?? base ?? default`, admin leaves skip-undefined) and derives per-field `file`/`default` source by exact-key lookup (`getConfigValueAtPath`) |
| `config.ts` | Derives `TOP_LEVEL_CONFIG_SOURCE_KEYS` from `TOP_LEVEL_ADMIN_SETTING_KEYS` + `FILE_ONLY_TOP_LEVEL_LEAVES`; `mergeTopLevelScalars` resolves every top-level scalar generically (`override ?? base`, always written so optional scalars keep their present-as-undefined shape) |
| `server/config/runtime-config-handler.ts` | `buildRuntimeFeatures()` builds `RuntimeDashboardConfig.features` from all `runtimeFlag` definitions plus the hand-mapped non-admin `gitCommitLookupEnabled` |
| `AdminPanel.tsx` | Renders Features-card groups/rows/badges/selects from `ui` metadata; row state, dirty tracking, flat-key save payload, and cancel run off a generic `featureValues` record |
| `test/config/admin-setting-definitions.test.ts` | Generic contract tests over every definition (DEFAULT_CONFIG consistency, schema accept/reject, validate/apply round-trip, merge override, source tracking, runtime-flag exposure, UI metadata) |

`RuntimeConfigService.setRuntimeAddress(host, port)` overlays the bound listening address onto in-memory `serve.host`/`serve.port` after the socket opens (called in `server/index.ts` post-`server.address()`), tagging those two source keys `'runtime'` — the third `ConfigFieldSource` value beside `'default'`/`'file'`. It touches neither disk nor the revision, so `GET /api/admin/config` reports the real port.

Both `GET /api/config/runtime` and the `spaHtml` bootstrap use `buildRuntimeFeatures()`. The HTML template embeds the map as `window.__DASHBOARD_CONFIG__.features` (JSON, `<`-escaped) and the SPA's `utils/config.ts` flattens it generically, so a flag needs no per-flag plumbing; client code reads it via `isFeatureEnabled('xyzEnabled')` or a typed accessor. `spaHtml` reads the RuntimeConfigService snapshot per page request, so live flag changes apply on the next browser reload with no restart.

### Adding an Admin Setting

1. Add the field to `CLIConfig` / `ResolvedCLIConfig` / `DEFAULT_CONFIG` in `packages/coc/src/config.ts` (a contract test fails if the registry default and `DEFAULT_CONFIG` disagree).
2. Add ONE entry to `ADMIN_SETTING_DEFINITIONS`, with `ui` to surface it on the Features card and `runtimeFlag` to expose it to the dashboard.
3. Only if `runtimeFlag` is set: add the flag name to `RuntimeDashboardConfig.features` in `packages/coc-client/src/contracts/admin.ts` (`AdminResolvedConfig`/`AdminConfigUpdate` absorb new keys via their index signatures).

Behavior-specific tests (what the flag gates) belong with the feature; the standard setting contract needs no new tests. Cross-field constraints belong in `CLIConfigSchema`/`validateConfigWithSchema()`; the admin write path re-validates the merged config before persisting, so admin updates and config-file loading reject the same invalid combinations.

## Namespaced Config Merge & Source Tracking

Precedence is CLI flags > config file > defaults; the default process store backend is SQLite.

`packages/coc/src/config/namespace-registry.ts` registers namespaced merge and source tracking. Non-admin source-tracked leaves are declared as data in `FILE_ONLY_TOP_LEVEL_LEAVES` / `FILE_ONLY_NAMESPACE_LEAVES` (`{ key, default, sourceTracked? }`) — defaults, source keys, and the generic merge all derive from that one list, and a contract test asserts each default matches `DEFAULT_CONFIG`. `sourceTracked: false` merges a field without a source badge (e.g. `features.gitCommitLookup`). Adding a source-tracked non-admin namespaced field means one entry there plus the `CLIConfig`/`ResolvedCLIConfig` type, `DEFAULT_CONFIG`, and the base schema tree.

Hand-written namespace descriptors remain only for genuinely structural sections — queue, models, logging, store, monitoring, skills — and `agentProviderRouting.auto` (`customMerge`).

## Feature Flags & Namespaces

**Work Items** (live): `workItems.hierarchy.enabled` (hierarchy board), `workItems.sync.enabled` (remote provider integration), `workItems.aiAuthoring.enabled` (AI-assisted authoring), `workItems.workflow.enabled` (durable Work Items/Goals workflow command center, off by default — gate new workflow behavior on it). Sync UI helpers treat provider integration as enabled only when both hierarchy and sync are true; provider credentials stay external and are not admin config fields.

**Top-level namespaces:** `pullRequests.enabled`, `pullRequests.suggestions`, `pullRequests.autoClassifyTeam` (off by default) under Admin -> Configure -> Features. `forEach.enabled`, `mapReduce.enabled`, `dreams.enabled` are off by default. `triggers.enabled` is restart-required and on by default, wiring event-to-action triggers (including the PR-banner CI auto-fix monitor) at startup. `effortLevels.enabled` is live and on by default; off replaces the effort-tier composer with separate model and reasoning-effort controls.

**Dreams:** `dreams.enabled` is the global gate and each workspace must also opt in via `PerRepoPreferences.dreams.enabled`. Admin -> Knowledge -> Dreams renders `dreams.enabled`, the restart-required `dreams.idleCheckIntervalMs`, and idle-run defaults `dreams.provider`/`dreams.model`/`dreams.timeoutMs` (interval and timeout entered in minutes, persisted as milliseconds). Config-file-only knobs: `dreams.minIdleMs`, `dreams.confidenceThreshold`, `dreams.maxCandidates`, `dreams.conversationLimit`.

**`features.*` flags.** Bootstrap-conservative `absentFallback` makes partial configs read the on-by-default ones as off.

| Flag | Default | Gates |
|------|---------|-------|
| `gitCrossCloneCherryPick` | on | Cross-clone cherry-pick commit context menu |
| `sessionContextAttachments` | on | Drag/drop session-context attachments in chat composers |
| `quickAskSidenotes` | on | Quick Ask side-note endpoints (per-process one-shot AI lookups on assistant turns); SPA rendering also needs the compile-time `QUICK_ASK_SIDENOTES` flag |
| `commitChatLens` | on | Desktop review-chat lens on commit and PR chat surfaces |
| `commitChatLensDormantMode` | `'ghost'` | Enum `'ghost'` \| `'pill'` — how the lens recedes on pointer-out |
| `remoteShell` | on | Remote-first dashboard shell (desktop-only) |
| `scopeSwitcher` | on | Needs `remoteShell`; one segmented scope switcher replacing the My Work / My Life toggles and workspace chip |
| `splitWorkspacePanel` | on | Split Workspace view (chat list over git, one shared detail pane) replacing the Activity and Git tabs |
| `singleRowShell` | off | Needs `remoteShell`; moves shell controls plus `+ New` into the global header |
| `ralphMultiAgentGrill` | off | Ralph grill question-planning card, separate grill-agent calls, dedupe/provenance metadata |
| `nativeCliSessions` | off | Read-only CLI Sessions surface over native Copilot/Codex/Claude stores |
| `arxivPaperIngest` | off | Only the Notes editor interception embedding a lone pasted arXiv link; the paper-ingest API stays callable |
| `canvasHostApis` | off | Extension-canvas host APIs (below) |
| `chatStyleSelector` | on | Chat Style chip (below) |
| `autoAgentProviderRouting` | off | Auto provider routing; edited from Admin -> AI Provider |

`features.canvasHostApis` (live) is the single gate for extension-canvas host APIs: capabilities declared `async: true` run in a terminable `worker_threads` worker with a 30s budget instead of the 1s `node:vm` path, and receive `host.complete` (max 3 one-shot model calls per run, logged with workspace/canvas/process). One flag covers both because `host.complete` exists only inside an async capability; sync capabilities are unaffected.

`features.chatStyleSelector` (Admin -> Configure -> AI Execution Modes, live, `absentFallback` false, runtime flag `chatStyleSelectorEnabled`) adds a Style chip — Default / Human / Direct / Analytical / Structured — beside Effort in new-chat and follow-up composers, for Ask, Autopilot, note-chat, commit-chat, and follow-ups. It controls presentation only, never provider, model, effort, tools, or permission mode. The instruction is prepended to the user message (not the system message) and stays visible in the stored turn; `Default` injects nothing, and a block is emitted only when the picked style differs from `process.metadata.chatStyle`. Enforcement is two-sided: the SPA hides the chip and omits `chatStyle`, and the server checks the live flag per turn (`getChatStyleSelectorEnabled` for new chats, `chatStyleSelectorEnabled` on the route's live flags for follow-ups).

## AI Provider Routing

`defaultProvider` is a top-level concrete fallback key accepting only `copilot`, `codex`, or `claude`, used for provider-omitted flows while Auto routing is off. Individual chat payloads can still set `payload.provider`, and follow-ups continue with the provider recorded on the original process.

`features.autoAgentProviderRouting` is the sole user-controlled Auto enablement switch. When true, provider-omitted new chats, tasks, and API-created work route through `agentProviderRouting.auto`; explicit provider selections still win. The Auto profile defaults to the ordered chain `claude -> codex -> copilot` with normal thresholds `33/33/10`, matching weekly-guard thresholds, and fallback `copilot`. Admin -> AI Provider -> Provider routing holds the Auto enable toggle, ordered rule editor, fallback selector, weekly-guard help text, and current-selection preview; Admin -> Configure -> Features does not expose a second Auto toggle.

## Skills Folder Sources

Two skill-source settings live in the non-admin `skills` config namespace, surfaced through the Skills Config API/UI rather than the Features card:

- `skills.globalExtraFolders: string[]` (default `[]`) — read-only global skill-source folders applied to all workspaces. Entries are absolute or `~`-prefixed paths; malformed/relative/empty entries are skipped, not fatal. CoC never installs or deletes into them.
- `skills.autoDetectDefaultFolders: boolean` (default `true`) — auto-detection of OneDrive/CloudStorage skill folders. Every Windows-style root (`~/OneDrive`, `~/OneDrive - Microsoft`) and macOS root (`~/Library/CloudStorage/OneDrive-*`) is probed at `.github/skills`, then `skills`.

Adding a `skills.*` field touches FOUR hand-written spots: the optional and required `skills` types plus `DEFAULT_CONFIG` in `config.ts`, the `BASE_SCHEMA_TREE.skills` leaf in `config/schema.ts` (optional + passthrough so old config files still validate), and the hand-coded `skills` merge in `namespace-registry.ts` (miss the last and tsc goes red).

**Persistence split.** Global disabled skills live in `preferences.json` (`globalDisabledSkills`); the two folder settings live in the config file. `GET`/`PUT /api/skills/config` spans both stores. The managed global skills directory (`dataDir/skills`, normally `~/.coc/skills`) is a fixed, non-configurable install target.

**Resolution order** — repo -> managed-global -> global-extra -> per-repo-extra -> auto-detected -> bundled — has three consumers that must stay identical:

- `resolveSkillConfig(...)` in `server/executors/skill-config-resolver.ts` — execution-time existence-filtered ordered `skillDirectories[]`. Reads `skills` config through the queue-executor bridge (config file is the single source of truth).
- `resolveEffectiveSkillPaths(...)` (same file) — read-only diagnostic behind `GET /api/skills/effective-paths`; keeps declared-but-missing sources so the UI can explain them (auto-detected folders surface only when their OneDrive root exists).
- `loadSkillsForWorkspace(...)` in `server/skills/skill-handler.ts` — UI listing behind `GET /api/workspaces/:id/skills` and `/skills/all`; tags configured-folder skills `source: 'global-extra-folder'`, loads both OneDrive conventions from the shared helper, and applies the same folder settings to list, cache refresh, file, and detail reads. Folder-source config writes clear cached workspace skill lists.

See [rest-api.md](rest-api.md) for the endpoints and [spa/top-bar-and-admin.md](spa/top-bar-and-admin.md) for the Skills Config panel UI.

## Admin UI Styling

The admin route uses a self-contained design system in `packages/coc/src/server/spa/client/react/admin/admin-redesign.css`, imported once at the top of `AdminPanel.tsx` so esbuild bundles it into the SPA CSS. Every selector is scoped under the `.admin-redesign` root class wrapping the admin page, so styles never leak to other dashboard surfaces; light/dark themes ride the existing `<html data-theme="…">` attribute. Do not use Tailwind utilities or inline `bg-*`/`text-*` classes for admin-only UI — extend `admin-redesign.css`.

### Layout Invariants

The page is a two-column shell (`.ar-shell` grid: `var(--ar-sidebar-w)` + `1fr`) mounted inside `AdminDialog`, which supplies the definite height. `.admin-redesign` (on `#view-admin`, `data-testid="admin-scroll-container"`) and `.ar-shell` are `height: 100%; min-height: 0; overflow: hidden`, so the page never scrolls as a whole.

- `.ar-main` is the **single scroll region** (`min-height: 0; height: 100%; overflow-y: auto`); the sticky `.ar-topbar` pins to its top and `.ar-page` flows underneath.
- `.ar-sidebar` fills the grid row and scrolls only internally. It must not be sticky and must not use `100vh` — either breaks inside `AdminDialog`.
- **Responsive rules are container queries, never media queries.** The shell only renders inside `AdminDialog`, capped near 1100px however wide the window is, so a viewport `@media` would not fire even when the shell is narrow. Containers: `ar-shell` on the root (sidebar collapse, `.ar-row` stacking) and `ar-main` on `.ar-main` (the `.aip-*` grids and toolbars — the shell minus the 248px sidebar, hence 660px/600px thresholds). `admin-redesign.css` must contain no `@media`; `AdminPanel-responsive.test.ts` asserts that.

### Navigation

Sidebar tabs are `.ar-nav-item` buttons grouped by user task: Configure (settings entry, AI Provider, Servers), Knowledge, Connections (container mode only), Operations, Developer / Internals. The nav mixes admin sections (`admin-tab-*` testids), promoted settings sections (`settings-subtab-*` testids), and embedded tool routes (`skills-toggle`, `logs-toggle`, `stats-toggle`, `servers-toggle`). Under `@container ar-shell (max-width: 600px)` the sidebar is replaced by a grouped `.ar-mobile-tab-select`.

The `settings` section is one `SettingsCard` per promoted entry — `ai`, `chat`, `appearance`, `features`, `integrations`, `providers`, `advanced` — declared in `SETTINGS_SUBTABS` in `AdminPanel.tsx`; `providers` renders `ProviderTokensSection` (GitHub, Azure DevOps credentials). Selection lives in `settingsSubTab` state, defaults to `ai`, and syncs both ways with `#admin/settings/<sub>` (default `ai` collapses to `#admin/settings`). Tests touching non-`ai` cards must navigate via `gotoSettingsSubTab(...)`. While Configure -> Features is active, Ctrl+S / Command+S suppress the browser save action and submit that card when dirty.

### Primitives for New Admin UI

- **Section cards:** `<SettingsCard title description badge dirty saving onSave onCancel data-testid>` renders `.ar-card`.
- **Settings rows:** local `AdminRow`, `AdminToggle`, `AdminSeg`, `AdminInputSuffix`, `SourceBadge` helpers at the bottom of `AdminPanel.tsx`; they preserve the `data-testid`s and `id`s tests rely on.
- **Free-form sections:** `.ar-section`, `.ar-section-head`, plus `.ar-input`, `.ar-select`, `.ar-btn(-primary|-secondary|-ghost|-danger[-outline])`, `.ar-pill`, `.ar-badge`, `.ar-pre`, `.ar-code`, `.ar-mono`.
- **Feature groups:** Features-card toggles sit in `.ar-feature-group` with an `.ar-feature-group-head` heading. Groups: Dashboard Modules, Development Tools, Work Items, AI Execution Modes, Code Review & Collaboration, Infrastructure.
- **AI Provider page:** content lives in `AIProviderPage.tsx` with an `ar-subtab-row` bar — Provider routing (summary grid, routing table, feature-gated Auto editor/preview) and Model catalog (lazy `ProviderModelsSection` + `ProviderEffortTiersSection`). Styles are `aip-*` classes.
- **New top-level tabs:** add to `AdminSubTab`, `TAB_LABELS`, `TAB_ICONS`, `TAB_DESCRIPTIONS`, then place the destination in `navGroups` in `AdminPanel.tsx`.
