---
status: pending
---

# 013: Merge CSS Design Tokens and Wiki Styles

## Summary
Merge deep-wiki's ~43 CSS custom properties with CoC's existing ~17 CSS variables into a unified design token system. Add wiki-specific component styles to the CoC SPA.

## Motivation
A unified CSS variable system ensures consistent theming across all dashboard tabs (Processes, Repos, Tasks, Wiki). This prevents visual inconsistency when switching between tabs.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/wiki-styles.css` — Wiki-specific component styles (sidebar nav, markdown content, code blocks, mermaid diagrams, dependency graph, TOC, source pills, ask widget, admin/generate panel, deep dive, etc.)

### Files to Modify
- `packages/coc/src/server/spa/client/styles.css` — Add merged design tokens to `:root` and `html[data-theme="dark"]` blocks; import wiki-styles.css

### Files to Delete
- (none)

## Implementation Notes

### Complete Variable Inventory

#### Deep-Wiki Variables (43 variables, defined in `packages/deep-wiki/src/server/spa/client/styles.css`)

**Light theme (`:root`)**
| Variable | Light Value | Dark Value |
|---|---|---|
| `--sidebar-bg` | `#ffffff` | `#111827` |
| `--sidebar-header-bg` | `#ffffff` | `#111827` |
| `--sidebar-border` | `#e5e7eb` | `#1f2937` |
| `--sidebar-text` | `#1f2937` | `#e5e7eb` |
| `--sidebar-muted` | `#6b7280` | `#9ca3af` |
| `--sidebar-hover` | `#f3f4f6` | `#1f2937` |
| `--sidebar-active-bg` | `#eff6ff` | `#1e3a5f` |
| `--sidebar-active-text` | `#2563eb` | `#60a5fa` |
| `--sidebar-active-border` | `#2563eb` | *(not redefined; inherits light)* |
| `--content-bg` | `#ffffff` | `#0f172a` |
| `--content-text` | `#1f2937` | `#e5e7eb` |
| `--content-muted` | `#6b7280` | `#9ca3af` |
| `--content-border` | `#e5e7eb` | `#1f2937` |
| `--header-bg` | `#ffffff` | `#111827` |
| `--header-shadow` | `rgba(0,0,0,0.06)` | `rgba(0,0,0,0.3)` |
| `--code-bg` | `#f3f4f6` | `#1e293b` |
| `--code-border` | `#e5e7eb` | `#334155` |
| `--link-color` | `#2563eb` | `#60a5fa` |
| `--badge-high-bg` | `#ef4444` | *(not redefined)* |
| `--badge-medium-bg` | `#f59e0b` | *(not redefined)* |
| `--badge-low-bg` | `#22c55e` | *(not redefined)* |
| `--card-bg` | `#ffffff` | `#1e293b` |
| `--card-border` | `#e5e7eb` | `#334155` |
| `--card-hover-border` | `#2563eb` | *(not redefined)* |
| `--stat-bg` | `#f9fafb` | `#1e293b` |
| `--stat-border` | `#2563eb` | *(not redefined)* |
| `--copy-btn-bg` | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.08)` |
| `--copy-btn-hover-bg` | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.15)` |
| `--search-bg` | `#f3f4f6` | `#1f2937` |
| `--search-text` | `#1f2937` | `#e5e7eb` |
| `--search-placeholder` | `#9ca3af` | `#6b7280` |
| `--topbar-bg` | `#18181b` | *(not redefined)* |
| `--topbar-text` | `#ffffff` | *(not redefined)* |
| `--topbar-muted` | `#a1a1aa` | *(not redefined)* |
| `--source-pill-bg` | `#f3f4f6` | `#1e293b` |
| `--source-pill-border` | `#e5e7eb` | `#334155` |
| `--source-pill-text` | `#374151` | `#d1d5db` |
| `--toc-active` | `#2563eb` | `#60a5fa` |
| `--toc-text` | `#6b7280` | `#9ca3af` |
| `--toc-hover` | `#374151` | `#e5e7eb` |
| `--ask-bar-bg` | `#f9fafb` | `#111827` |
| `--ask-bar-border` | `#e5e7eb` | `#1f2937` |
| `--content-bg-rgb` | *(fallback only: `255, 255, 255`)* | *(not defined)* |

#### CoC Variables (17 variables, defined in `packages/coc/src/server/spa/client/styles.css`)

| Variable | Light Value | Dark Value |
|---|---|---|
| `--bg-primary` | `#ffffff` | `#1e1e1e` |
| `--bg-secondary` | `#f3f3f3` | `#252526` |
| `--bg-sidebar` | `#f8f8f8` | `#1e1e1e` |
| `--text-primary` | `#1e1e1e` | `#cccccc` |
| `--text-secondary` | `#6e6e6e` | `#858585` |
| `--border-color` | `#e0e0e0` | `#3c3c3c` |
| `--accent` | `#0078d4` | `#0078d4` |
| `--status-running` | `#0078d4` | `#3794ff` |
| `--status-completed` | `#16825d` | `#89d185` |
| `--status-failed` | `#f14c4c` | `#f48771` |
| `--status-cancelled` | `#e8912d` | `#cca700` |
| `--status-queued` | `#848484` | `#848484` |
| `--topbar-bg` | `#18181b` | *(not redefined)* |
| `--topbar-text` | `#ffffff` | *(not redefined)* |
| `--hover-bg` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.04)` |
| `--active-bg` | `rgba(0,120,212,0.08)` | `rgba(0,120,212,0.15)` |

*(Note: `--bg-hover` and `--border` appear in grep output from a stale `----` artifact; they are not actual variables.)*

### Overlap & Conflict Analysis

#### Shared (identical name, same purpose) — 2 variables
| Variable | Deep-Wiki | CoC | Action |
|---|---|---|---|
| `--topbar-bg` | `#18181b` | `#18181b` | **Keep as-is** — identical values |
| `--topbar-text` | `#ffffff` | `#ffffff` | **Keep as-is** — identical values |

#### Semantic Overlaps (different names, same purpose) — needs unification
| Purpose | Deep-Wiki Name | CoC Name | Proposed Unified Name | Notes |
|---|---|---|---|---|
| Page background | `--content-bg` | `--bg-primary` | **`--bg-primary`** | Keep CoC name; alias `--content-bg` → `--bg-primary` or update wiki selectors |
| Secondary/muted bg | `--code-bg` / `--stat-bg` | `--bg-secondary` | **`--bg-secondary`** | CoC's `--bg-secondary` maps to deep-wiki's `--code-bg` role; keep both: `--bg-secondary` for generic, `--code-bg` for code-specific |
| Sidebar background | `--sidebar-bg` | `--bg-sidebar` | **`--bg-sidebar`** | Keep CoC name; add `--sidebar-bg` as alias or update wiki selectors |
| Primary text | `--content-text` | `--text-primary` | **`--text-primary`** | Keep CoC name |
| Secondary text | `--content-muted` | `--text-secondary` | **`--text-secondary`** | Keep CoC name |
| Border color | `--content-border` | `--border-color` | **`--border-color`** | Keep CoC name |
| Accent/link color | `--link-color` / `--sidebar-active-border` | `--accent` | **`--accent`** | CoC's `--accent` serves same role as deep-wiki's `--link-color` |
| Hover background | `--sidebar-hover` | `--hover-bg` | **`--hover-bg`** | Keep CoC name |

#### Unique to Deep-Wiki (must be added to CoC) — 26 variables
These have no CoC equivalent and are needed for wiki-specific UI:

**Sidebar detail tokens:**
- `--sidebar-header-bg`
- `--sidebar-border`
- `--sidebar-text`
- `--sidebar-muted`
- `--sidebar-active-bg`
- `--sidebar-active-text`
- `--sidebar-active-border`

**Content detail tokens:**
- `--header-bg`
- `--header-shadow`
- `--code-bg` (distinct from `--bg-secondary`; used for code blocks, mermaid BG)
- `--code-border`

**Component tokens:**
- `--card-bg`
- `--card-border`
- `--card-hover-border`
- `--stat-bg`
- `--stat-border`
- `--copy-btn-bg`
- `--copy-btn-hover-bg`
- `--search-bg`, `--search-text`, `--search-placeholder`
- `--source-pill-bg`, `--source-pill-border`, `--source-pill-text`
- `--toc-active`, `--toc-text`, `--toc-hover`
- `--ask-bar-bg`, `--ask-bar-border`

**Badge tokens (used by wiki complexity badges + live reload):**
- `--badge-high-bg`
- `--badge-medium-bg`
- `--badge-low-bg`

**Misc:**
- `--topbar-muted`
- `--content-bg-rgb` (used in `.regen-overlay` with `rgba()`)

#### Unique to CoC (keep as-is) — 8 variables
- `--status-running`
- `--status-completed`
- `--status-failed`
- `--status-cancelled`
- `--status-queued`
- `--active-bg`
- `--bg-secondary` (already in CoC, similar to `--code-bg` but different value)
- `--bg-sidebar` (already in CoC)

### Proposed Unification Strategy

**Approach: Additive merge with aliases**

1. **Keep all existing CoC variable names unchanged** — zero regression risk for Processes/Repos/Tasks tabs.
2. **Add deep-wiki variables to CoC's `:root` and `html[data-theme="dark"]`** — the 26 unique wiki variables are added directly.
3. **For the 8 semantic overlaps**, add wiki names as aliases pointing to CoC values:
   ```css
   /* Aliases for wiki component compatibility */
   --content-bg: var(--bg-primary);
   --content-text: var(--text-primary);
   --content-muted: var(--text-secondary);
   --content-border: var(--border-color);
   --sidebar-bg: var(--bg-sidebar);
   --sidebar-hover: var(--hover-bg);
   --link-color: var(--accent);
   ```
   This means wiki CSS selectors can use deep-wiki variable names without modification, while the actual values come from CoC's token system.
4. **Dark theme values**: Deep-wiki uses a Tailwind-like dark palette (`#0f172a`, `#111827`, `#1e293b`) while CoC uses a VS Code palette (`#1e1e1e`, `#252526`, `#3c3c3c`). The wiki-specific variables will keep deep-wiki's dark values since they only affect the Wiki tab. The aliased variables inherit CoC's dark values automatically.

### Wiki-Specific Styles to Port (`wiki-styles.css`)

The following sections from `packages/deep-wiki/src/server/spa/client/styles.css` need to be ported to `wiki-styles.css`, scoped under a `.wiki-tab` or similar parent selector to avoid leaking into other tabs:

| Section | Lines | Key Selectors |
|---|---|---|
| Sidebar nav (domain hierarchy) | 274–355 | `.nav-section`, `.nav-domain-item`, `.nav-domain-component`, `.complexity-badge` |
| Main content area | 357–385 | `.main-content`, `.content-scroll`, `.content-layout`, `.article` |
| Source files section | 386–446 | `.source-files-section`, `.source-pill` |
| Table of contents sidebar | 447–491 | `.toc-sidebar`, `.toc-nav` |
| Markdown body | 492–567 | `.markdown-body h1–h4`, `code`, `pre`, `table`, `blockquote`, `hr`, `img` |
| Home view (stats + component grid) | 568–612 | `.home-view`, `.stat-card`, `.component-grid`, `.component-card` |
| Mermaid diagrams | 614–708 | `.mermaid-container`, `.mermaid-toolbar`, `.mermaid-viewport` |
| Dependency graph | 709–769 | `.graph-container`, `.graph-toolbar`, `.graph-legend`, `.graph-tooltip` |
| Deep dive | 770–822 | `.deep-dive-btn`, `.deep-dive-section`, `.deep-dive-input` |
| Live reload bar | 823–840 | `.live-reload-bar` |
| Admin page | 851–935 | `.admin-page`, `.admin-editor`, `.admin-btn` |
| Generate tab | 937–1157 | `.generate-phases`, `.phase-card`, `.component-regen-btn` |

**From `ask-widget.css`:**
| Section | Lines | Key Selectors |
|---|---|---|
| Ask AI floating widget | 1–176 | `.ask-widget`, `.ask-messages`, `.ask-message-*`, `.ask-widget-textarea` |

### Scoping Strategy

Wiki styles will be scoped under `.wiki-tab` to prevent leaking:
```css
/* wiki-styles.css */
.wiki-tab .markdown-body h1 { ... }
.wiki-tab .component-card { ... }
```

The top bar, sidebar structure, and app layout are already shared by CoC's SPA shell; only wiki-specific content styles need scoping.

## Tests
- Visual verification of both dark and light themes
- All existing dashboard tabs render correctly (no variable regressions)
- Wiki tab renders with correct colors/spacing
- No CSS variable name conflicts
- Mermaid diagrams render with correct backgrounds in both themes
- Code blocks have proper syntax highlighting backgrounds
- Ask widget styling is consistent

## Acceptance Criteria
- [ ] Unified CSS variable set covers both CoC and wiki needs
- [ ] Dark and light themes work across all tabs
- [ ] Wiki-specific styles (markdown, code, mermaid, graph, TOC, ask widget) render correctly
- [ ] No visual regressions in existing Processes/Repos/Tasks tabs
- [ ] CoC build succeeds
- [ ] Alias variables correctly delegate to CoC base tokens
- [ ] `.wiki-tab` scoping prevents style leakage into other tabs

## Dependencies
- Depends on: 006 (Wiki tab scaffold exists to apply styles to)
