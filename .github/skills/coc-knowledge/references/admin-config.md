# Admin Config & Admin UI Styling

Covers the editable admin config registry in `packages/coc/` and the self-contained styling system for the admin route in the dashboard SPA. Load this when adding or modifying any admin-exposed configuration field or admin UI element.

## Admin Config Field Registry

Editable admin config fields are defined in a single registry: `packages/coc/src/server/admin/admin-config-fields.ts` (`ADMIN_CONFIG_FIELDS`).

Each entry provides a flat key (e.g. `'loops.enabled'`), a field-local `validate()` function, and an `apply()` function. The `PUT /api/admin/config` handler derives `editableKeys`, field-local validation, and merge logic from this registry. Cross-field constraints belong in `CLIConfigSchema`/`validateConfigWithSchema()` and the admin write path re-validates the merged config before persisting so admin updates and config-file loading reject the same invalid combinations.

To expose a new config field via the admin API, add ONE entry to `ADMIN_CONFIG_FIELDS`. Also update:

1. `CLIConfig` / `ResolvedCLIConfig` / `DEFAULT_CONFIG` in `packages/coc/src/config.ts`
2. `CLIConfigSchema` in `packages/coc/src/config/schema.ts`
3. Namespace registry in `packages/coc/src/config/namespace-registry.ts` (nested fields)
4. `AdminResolvedConfig` / `AdminConfigUpdate` in `packages/coc-client/src/contracts/admin.ts`
5. `AdminPanel.tsx` or the focused admin subpage component for the UI control

The `spaHtml` function in `packages/coc/src/server/index.ts` re-reads the config file on every page request, so feature-flag changes (e.g. `terminal.enabled`) take effect on the next browser reload — no server restart required.

Work Items expose hierarchy-related live flags through this path: `workItems.hierarchy.enabled` enables the hierarchy board, and `workItems.sync.enabled` enables remote provider integration. Sync UI helpers treat provider integration as enabled only when both flags are true; provider credentials stay external and are not admin config fields. Dedicated mode flags such as `forEach.enabled` and `mapReduce.enabled` live as top-level namespaces and are disabled by default. Experimental dashboard/chat flags live under `features.*`; `features.gitCrossCloneCherryPick` enables the cross-clone cherry-pick commit context-menu modal and is enabled by default, `features.sessionContextAttachments` enables drag/drop session-context attachments in chat composers and is disabled by default, and `features.commitChatLens` enables desktop review-chat lens placement for supported commit and PR chat surfaces and is disabled by default. `features.autoAgentProviderRouting` is edited from Admin -> AI Provider, enables Auto provider routing, and is disabled by default.

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

Avoid introducing Tailwind utilities or inline `bg-*`/`text-*` classes for admin-only UI — extend `admin-redesign.css` instead so the look stays cohesive.
