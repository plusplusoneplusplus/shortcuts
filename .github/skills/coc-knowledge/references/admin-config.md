# Admin Config & Admin UI Styling

Covers the editable admin config registry in `packages/coc/` and the self-contained styling system for the admin route in the dashboard SPA. Load this when adding or modifying any admin-exposed configuration field or admin UI element.

## Feature Flag Registry (single source of truth for boolean flags)

Boolean dashboard/feature flags live in ONE registry: `packages/coc-client/src/contracts/feature-flags.ts` (`FEATURE_FLAGS`). Each entry carries the flat `key` (e.g. `'excalidraw.enabled'`), nested `path`, `default`, admin `runtime` class, `editable`, an optional `runtimeFlag` (camelCase name surfaced to the SPA), and optional Admin Features-card `ui` metadata (`group`/`label`/`hint`/`testid`/`badge`/`showWhenKey`).

The registry auto-drives all the mechanical plumbing:

- `ADMIN_CONFIG_FIELDS` boolean entries (`admin-config-fields.ts`) — generated from editable flags (validate boolean + `apply` at `path` via `setFlagValue`).
- `buildRuntimeDashboardConfig` boolean flags (`server/config/runtime-config-handler.ts`) via `buildFeatureFlagRuntimeMap`.
- `RuntimeDashboardConfig.features` booleans + `AdminConfigUpdate` boolean keys (`coc-client/contracts/admin.ts`) and the client `DashboardConfig` flags + runtime merge (`utils/config.ts`) — via mapped types (`FeatureFlagRuntimeMap`, `FeatureFlagUpdateMap`).
- The namespace merge + source descriptor for simple `<ns>.enabled` flags (`namespace-registry.ts` — `buildSimpleFlagNamespaceDescriptors`; composite namespaces stay hand-written).
- The Admin -> Configure -> Features toggle list (`AdminPanel.tsx`), rendered generically from `ADMIN_FEATURE_TOGGLES` + `FEATURE_FLAG_GROUPS` (a single `featureFlags` record holds toggle state; the two enum sub-selects — scratchpad layout, commit-chat-lens dormant mode — and `showWhenKey` sub-rows are interleaved).

To add a boolean feature flag: add ONE registry entry, then the nested pieces it cannot generate — `CLIConfig`/`ResolvedCLIConfig`/`DEFAULT_CONFIG` in `config.ts`, the Zod entry in `config/schema.ts`, the `CONFIG_NAMESPACE_SOURCE_KEYS` entry in `namespace-registry.ts`, and `AdminResolvedConfig` in `coc-client/contracts/admin.ts`. The drift guard `packages/coc/test/server/feature-flags-registry.test.ts` fails — naming the missing key — if any is omitted or a default disagrees, so nothing ships half-wired. Named client readers (`isExcalidrawEnabled()`) stay one line each in `utils/config.ts` for existing call sites.

Non-boolean editable fields (model, scratchpad.layout, defaultProvider, commitChatLensDormantMode, chat.followUpSuggestions.count, …) and plain display booleans (showReportIntent, groupSingleLineMessages, chat.*) are bespoke entries in `ADMIN_CONFIG_FIELDS`, not the registry. The `PUT /api/admin/config` handler derives `editableKeys`, field-local validation, and merge logic from `ADMIN_CONFIG_FIELDS`. Cross-field constraints belong in `CLIConfigSchema`/`validateConfigWithSchema()`; the admin write path re-validates the merged config before persisting so admin updates and config-file loading reject the same invalid combinations.

The `spaHtml` function in `packages/coc/src/server/index.ts` re-reads the config file on every page request, so feature-flag changes (e.g. `terminal.enabled`) take effect on the next browser reload — no server restart required.

Work Items expose live flags through this path: `workItems.hierarchy.enabled` enables the hierarchy board, `workItems.sync.enabled` enables remote provider integration, `workItems.aiAuthoring.enabled` enables AI-assisted authoring, and `workItems.workflow.enabled` gates the durable Work Items/Goals workflow command center. Sync UI helpers treat provider integration as enabled only when both hierarchy and sync flags are true; provider credentials stay external and are not admin config fields. The durable workflow flag is disabled by default and should gate new Work Items/Goals workflow behavior so existing Chat and Work Items behavior stays unchanged while the flag is off. Pull Requests exposes `pullRequests.enabled`, `pullRequests.suggestions`, and `pullRequests.autoClassifyTeam` through Admin -> Configure -> Features; auto-classifying Team PRs is disabled by default. Dedicated mode flags such as `forEach.enabled` and `mapReduce.enabled` live as top-level namespaces and are disabled by default. Experimental dashboard/chat flags live under `features.*`; `features.gitCrossCloneCherryPick` enables the cross-clone cherry-pick commit context-menu modal and is enabled by default, `features.sessionContextAttachments` enables drag/drop session-context attachments in chat composers and is disabled by default, and `features.commitChatLens` enables desktop review-chat lens placement for supported commit and PR chat surfaces and is disabled by default. `features.commitChatLensDormantMode` (`'ghost'` | `'pill'`, default `'ghost'`) controls how the lens recedes when the cursor leaves: ghost fades to near-transparent with scale-down, pill collapses to a compact status pill. `features.autoAgentProviderRouting` is edited from Admin -> AI Provider, enables Auto provider routing, and is disabled by default.

The AI provider admin card stores `defaultProvider` as a top-level concrete fallback key. It accepts only `copilot`, `codex`, or `claude` and is used for provider-omitted flows when Auto routing is disabled; individual chat payloads can still set `payload.provider`, and follow-ups continue with the provider recorded on the original process. `features.autoAgentProviderRouting` is the sole user-controlled Auto enablement switch. When it is true, provider-omitted new chats, tasks, and API-created work route through `agentProviderRouting.auto` by default; explicit provider selections still win. Auto routing profile configuration lives under `agentProviderRouting.auto`, with the default ordered profile `claude -> codex -> copilot`, normal thresholds `33/33/10`, matching weekly guard thresholds, and fallback `copilot`. The Admin -> AI Provider -> Provider routing subtab contains the Auto enable toggle, ordered rule editor, fallback selector, weekly-guard help text, and current-selection preview; Admin -> Configure -> Features does not expose a second Auto routing toggle.

## Namespaced Config Merge & Source Tracking

Namespaced config merge/source tracking is registered in `packages/coc/src/config/namespace-registry.ts`; add namespace fields there instead of expanding branch lists in `config.ts`. Default process store backend is SQLite. CLI flags > config file > defaults.

## Admin UI Styling

The admin route uses a self-contained, Linear-inspired design system that lives in `packages/coc/src/server/spa/client/react/admin/admin-redesign.css`. The stylesheet is imported once at the top of `AdminPanel.tsx` so esbuild bundles it into the SPA's CSS. All selectors are scoped under the `.admin-redesign` root class that wraps the entire admin page — styles never leak to other dashboard surfaces, and light/dark themes are driven by the existing `<html data-theme="…">` attribute.

### Layout (sidebar + main, fit-to-viewport)

The admin page is structured as a two-column shell that fills the available vertical space and never scrolls as a whole. Only the right pane is scrollable.

- The route mounts inside `<div className="h-full overflow-hidden" data-testid="admin-scroll-container">` (Router) or the `AdminDialog` body (`flex-1 min-h-0 overflow-y-auto`). Both supply a definite height to the panel.
- The `.admin-redesign` root (on `#view-admin`) is `height: 100%; min-height: 0` so the panel fills that parent exactly.
- `<div className="ar-shell">` is a CSS grid (`var(--ar-sidebar-w)` + `1fr`) with `height: 100%; min-height: 0; overflow: hidden`.
- `<aside className="ar-sidebar">` fills the grid row (`height: 100%; min-height: 0`) and only scrolls internally if its own brand/nav/stats stack ever exceeds the viewport. It is **not** sticky and must not use `100vh` — both would break inside the `AdminDialog` and any nested pane whose container height differs from the viewport.
- `<main className="ar-main">` is the **single scroll region** of the admin route: `min-height: 0; height: 100%; overflow-y: auto`. The sticky topbar (`.ar-topbar` with the `.ar-breadcrumb`) pins to the top of this scroller, and the page body (`.ar-page` with `.ar-page-header` + cards) flows underneath.
- The tabs live in the sidebar as `.ar-nav-item` buttons grouped by user task: Configure, Knowledge, Connections (container-only), Operations, and Developer / Internals. The Configure group contains the settings entry (Configure), AI Provider, and Servers. Providers (credential management) is a subtab inside the Configuration page, not a standalone sidebar entry. The Connections group only appears in container mode (for Messaging and container Agents). The grouped nav can mix admin sections (`admin-tab-*` data-testids), promoted settings sections (`settings-subtab-*` data-testids), and embedded tool routes (`skills-toggle`, `logs-toggle`, `stats-toggle`, `servers-toggle`). A grouped `.ar-mobile-tab-select` appears only under the responsive `@media (max-width: 600px)` rule, which hides the sidebar and falls back to a `<select>` with `<optgroup>` labels — the main pane still scrolls internally on mobile.

### Settings Sub-Tabs

Settings (the `settings` admin section) is split into one `SettingsCard` per promoted sidebar entry — `ai`, `chat`, `appearance`, `features`, `integrations`, `providers`, `advanced` — defined in `SETTINGS_SUBTABS` near the top of `AdminPanel.tsx`. The `providers` subtab renders `ProviderTokensSection` (credential management for GitHub, Azure DevOps, etc.) that was previously a standalone admin tab. These entries render in the main sidebar with data-testids `settings-subtab-{ai|chat|appearance|features|integrations|providers|advanced}` instead of an in-page sub-tab row. Selection is kept in local `settingsSubTab` state, defaults to `ai`, and is synced both directions with `#admin/settings/<sub>` (default `ai` collapses to `#admin/settings`). Tests that interact with controls outside of the default `ai` card must first navigate via the `gotoSettingsSubTab(...)` helper.

### Primitives for New Admin UI

When adding UI to the admin page, prefer the existing primitives:

- **Section cards:** `<SettingsCard title=… description=… badge=… dirty saving onSave onCancel data-testid=…>` (renders `.ar-card` with header/body/footer).
- **Settings rows:** the local `AdminRow`, `AdminToggle`, `AdminSeg`, `AdminInputSuffix`, and `SourceBadge` helpers defined at the bottom of `AdminPanel.tsx`. They wrap raw inputs in the new visual chrome while preserving `data-testid`s and `id`s used by tests.
- **Free-form sections** inside a card use `.ar-section`, `.ar-section-head`, and the inline helpers `.ar-input`, `.ar-select`, `.ar-btn`, `.ar-btn-primary` / `-secondary` / `-ghost` / `-danger`(`-outline`), `.ar-pill`, `.ar-badge`, `.ar-pre`, `.ar-code`, `.ar-mono`.
- **AI Provider page:** the `agents` tab content lives in `AIProviderPage.tsx` (not inline in `AdminPanel`). It uses a tab bar (`ar-subtab-row`) with two tabs: Provider routing (summary grid + routing table plus feature-gated Auto routing editor/preview) and Model catalog (lazy-loaded `ProviderModelsSection` + `ProviderEffortTiersSection`). All styles use `aip-*` classes in `admin-redesign.css`.
- **New top-level tabs:** add to `AdminSubTab`, `TAB_LABELS`, `TAB_ICONS`, and `TAB_DESCRIPTIONS`, then place the destination in the grouped `navGroups` definition near the bottom of `AdminPanel.tsx` so the sidebar and mobile select expose it in the right user-intent group.

- **Feature groups:** Inside the Features settings card, toggles render generically from the `FEATURE_FLAGS` registry — `FEATURE_FLAG_GROUPS` defines the ordered named sections (each a `<div className="ar-feature-group">` with a `<div className="ar-feature-group-head">` heading: Dashboard Modules, Development Tools, Work Items, AI Execution Modes, Code Review & Collaboration, Infrastructure) and each flag's `ui.group` places it. A new boolean toggle appears automatically by adding a registry entry with `ui` metadata; no AdminPanel edit is needed.

Avoid introducing Tailwind utilities or inline `bg-*`/`text-*` classes for admin-only UI — extend `admin-redesign.css` instead so the look stays cohesive.
