---
status: pending
---

# 003: Extract core, theme, and sidebar script modules

## Summary
Create the `spa/scripts/` directory and extract the first three client-side JS sections (core/init, theme, sidebar) into individual modules, each exporting a function that returns its JavaScript string segment.

## Motivation
Start decomposing the massive `getSpaScript()` function (~1600 lines) into focused modules. Core, theme, and sidebar are extracted first because they run during initialization and other sections depend on them.

## Changes

### Files to Create
- `packages/deep-wiki/src/server/spa/scripts/core.ts` — Exports `getCoreScript(defaultTheme: string): string`. Contains: global variable declarations (`moduleGraph`, `currentModuleId`, `currentTheme`, `markdownCache`), the `init()` function, browser history `popstate` handler, and the client-side `escapeHtml()` utility function. (Lines ~1242-1283 and ~1999-2006 from spa-template.ts)
- `packages/deep-wiki/src/server/spa/scripts/theme.ts` — Exports `getThemeScript(): string`. Contains: `initTheme()`, `toggleTheme()`, `updateThemeStyles()`, sidebar collapse state restore IIFE, `updateSidebarCollapseBtn()`. (Lines ~1285-1349)
- `packages/deep-wiki/src/server/spa/scripts/sidebar.ts` — Exports `getSidebarScript(opts: { enableSearch: boolean; enableGraph: boolean }): string`. Contains: `initializeSidebar()`, `buildAreaSidebar()`, `buildCategorySidebar()`, `setActive()`, `showWikiContent()`, `showAdminContent()`. Has conditional search event listeners (`opts.enableSearch`) and graph nav item (`opts.enableGraph`). (Lines ~1351-1565)

### Files to Modify
- `packages/deep-wiki/src/server/spa-template.ts` — In `getSpaScript()`, replace the extracted inline code sections with imports: `import { getCoreScript } from './spa/scripts/core'; import { getThemeScript } from './spa/scripts/theme'; import { getSidebarScript } from './spa/scripts/sidebar';`. The function body now concatenates: `getCoreScript(opts.defaultTheme) + getThemeScript() + getSidebarScript({enableSearch: opts.enableSearch, enableGraph: opts.enableGraph}) + [remaining inline code]`.

## Implementation Notes
- **Global scope sharing**: All script modules produce strings that are concatenated into a single `<script>` block. Functions defined in `core.ts` output (like `escapeHtml`, `init`) are available to all other sections at runtime.
- **Template interpolation**: `getCoreScript(defaultTheme)` must inject `${defaultTheme}` into the `currentTheme` variable declaration using template literal.
- **Sidebar conditionals**: Use `opts.enableSearch` to conditionally include search listener code, `opts.enableGraph` to conditionally include graph nav item.
- Each function returns a raw JavaScript string (no wrapping `<script>` tags).
- **Do not change indentation** of the generated JS — tests match exact string content.

## Tests
- No new tests needed — existing tests verify the HTML output contains these JS functions
- Run full test suite to confirm no string matching regressions

## Acceptance Criteria
- [ ] Three new files created in `spa/scripts/`
- [ ] Each exports a single function returning a JS string
- [ ] `getSpaScript()` in spa-template.ts concatenates imported sections + remaining inline
- [ ] Generated HTML output is byte-identical to before
- [ ] All existing tests pass unchanged

## Dependencies
- Depends on: 001 (types), 002 (spa/ directory exists)
