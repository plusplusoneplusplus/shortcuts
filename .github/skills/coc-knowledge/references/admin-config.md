# Admin Config & Admin UI Styling

Covers the editable admin config registry in `packages/coc/` and the self-contained styling system for the admin route in the dashboard SPA. Load this when adding or modifying any admin-exposed configuration field or admin UI element.

## Admin Config Field Registry

Editable admin config fields are defined in a single registry: `packages/coc/src/server/admin/admin-config-fields.ts` (`ADMIN_CONFIG_FIELDS`).

Each entry provides a flat key (e.g. `'loops.enabled'`), a `validate()` function, and an `apply()` function. The `PUT /api/admin/config` handler derives `editableKeys`, validation, and merge logic entirely from this registry — **no changes to `admin-handler.ts` are needed when adding a new editable field**.

To expose a new config field via the admin API, add ONE entry to `ADMIN_CONFIG_FIELDS`. Also update:

1. `CLIConfig` / `ResolvedCLIConfig` / `DEFAULT_CONFIG` in `packages/coc/src/config.ts`
2. `CLIConfigSchema` in `packages/coc/src/config/schema.ts`
3. Namespace registry in `packages/coc/src/config/namespace-registry.ts` (nested fields)
4. `AdminResolvedConfig` / `AdminConfigUpdate` in `packages/coc-client/src/contracts/admin.ts`
5. `AdminPanel.tsx` for the UI control

The `spaHtml` function in `packages/coc/src/server/index.ts` re-reads the config file on every page request, so feature-flag changes (e.g. `terminal.enabled`) take effect on the next browser reload — no server restart required.

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
- The tabs live in the sidebar as `.ar-nav-item` buttons (data-testids `admin-tab-{settings|providers|data|server|prompts|database|agents}` are preserved for tests). A `.ar-mobile-tab-select` appears only under the responsive `@media (max-width: 600px)` rule, which hides the sidebar and falls back to a `<select>` — the main pane still scrolls internally on mobile.

### Settings Sub-Tabs

Settings (the `settings` top-level tab) is split into one `SettingsCard` per sub-tab — `ai`, `chat`, `appearance`, `features`, `integrations`, `advanced` — defined in `SETTINGS_SUBTABS` near the top of `AdminPanel.tsx`. A `.ar-subtab-row` with `.ar-subtab` buttons (data-testids `settings-subtab-{ai|chat|appearance|features|integrations|advanced}`) renders above the cards. Selection is kept in local `settingsSubTab` state, defaults to `ai`, and is synced both directions with `#admin/settings/<sub>` (default `ai` collapses to `#admin/settings`). Tests that interact with controls outside of the default `ai` card must first navigate via the `gotoSettingsSubTab(...)` helper.

### Primitives for New Admin UI

When adding UI to the admin page, prefer the existing primitives:

- **Section cards:** `<SettingsCard title=… description=… badge=… dirty saving onSave onCancel data-testid=…>` (renders `.ar-card` with header/body/footer).
- **Settings rows:** the local `AdminRow`, `AdminToggle`, `AdminSeg`, `AdminInputSuffix`, and `SourceBadge` helpers defined at the bottom of `AdminPanel.tsx`. They wrap raw inputs in the new visual chrome while preserving `data-testid`s and `id`s used by tests.
- **Free-form sections** inside a card use `.ar-section`, `.ar-section-head`, and the inline helpers `.ar-input`, `.ar-select`, `.ar-btn`, `.ar-btn-primary` / `-secondary` / `-ghost` / `-danger`(`-outline`), `.ar-pill`, `.ar-badge`, `.ar-pre`, `.ar-code`, `.ar-mono`.
- **New top-level tabs:** add to `AdminSubTab`, `TAB_LABELS`, `TAB_ICONS`, and `TAB_DESCRIPTIONS` near the top of `AdminPanel.tsx` — the sidebar nav and mobile select pick them up automatically.

Avoid introducing Tailwind utilities or inline `bg-*`/`text-*` classes for admin-only UI — extend `admin-redesign.css` instead so the look stays cohesive.
