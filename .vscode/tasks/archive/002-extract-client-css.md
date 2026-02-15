---
status: pending
depends_on: 001-add-esbuild-infra
---

# 002 — Extract client CSS from string literals to real `.css` files

## Motivation

CSS is the safest asset to extract first — it has zero dependencies on the runtime config-injection pattern and needs no module imports. Moving it out of template-literal-returning functions into real `.css` files gives us proper IDE support (syntax highlighting, linting, autocompletion) and sets the stage for esbuild bundling in a later commit.

## Current state

| Package | File | Function | Lines | Notes |
|---------|------|----------|-------|-------|
| pipeline-cli | `src/server/spa/styles.ts` (964 lines) | `getDashboardStyles(): string` | 9–963 | Single template literal, zero interpolations, zero parameters |
| deep-wiki | `src/server/spa/styles.ts` (1251 lines) | `getSpaStyles(enableAI: boolean): string` | 4–1248 | Three concatenated blocks: base (4–757), conditional AI widget (760–936), admin (940–1248). One interpolation: `${getMermaidZoomStyles()}` at line 614. `enableAI` gates the AI widget CSS block. |

### Callers

- **pipeline-cli** — `html-template.ts:34` inlines the return value inside `<style>…</style>`.
- **deep-wiki** — `html-template.ts:47` inlines the return value inside `<style>…</style>`.

### Interpolations / dynamic content

- **pipeline-cli** — None. The template literal is pure CSS.
- **deep-wiki** — `${getMermaidZoomStyles()}` (line 614) embeds ~250 lines of mermaid zoom CSS from `../../rendering/mermaid-zoom.ts`. This is a build-time-constant string (no runtime parameters), so it can be inlined into the `.css` file.

### Conditional `enableAI` block (deep-wiki only)

When `enableAI === false`, the `.ask-widget` CSS is omitted entirely. A test (`spa-template.test.ts:294–296`) asserts:
```ts
expect(html).not.toContain('.ask-widget');
```
This means we **cannot** include AI widget CSS unconditionally — the test verifies its absence. We must preserve the conditional behavior by splitting into two CSS files.

## Plan

### 1. pipeline-cli — create `client/styles.css`

**Create** `packages/pipeline-cli/src/server/spa/client/styles.css`

Content: the raw CSS currently inside the template literal at `styles.ts:9–963`. Strip the leading 8-space indentation that exists only because the string was embedded inside a TypeScript function.

The CSS contains:
- `:root` custom properties (light theme defaults)
- `html[data-theme="dark"]` overrides
- Layout grid (`.app-layout`, sidebar, detail panel)
- Status badges, process items, markdown result styles
- Queue panel, enqueue dialog, conversation section
- Custom scrollbar styles
- Responsive `@media (max-width: 768px)` rules

No transformations needed — it's already valid CSS.

**Modify** `packages/pipeline-cli/src/server/spa/styles.ts`

```typescript
// Before (964 lines):
export function getDashboardStyles(): string {
    return `        :root {
        ...
    `;
}

// After (~7 lines):
import * as fs from 'fs';
import * as path from 'path';

const cssContent = fs.readFileSync(
    path.join(__dirname, 'client', 'styles.css'), 'utf-8'
);

export function getDashboardStyles(): string {
    return cssContent;
}
```

- `fs.readFileSync` at module load time — one-time cost, cached in `cssContent`.
- `__dirname` resolves correctly in the compiled output because `client/styles.css` will be copied to `dist/` alongside the `.js` files (handled in commit 001's esbuild copy config, or we add a simple file-copy step here).
- Function signature unchanged → callers unaffected.

**File copy concern:** The `.css` file must end up next to the compiled `.js` in the output directory. Options (pick one during implementation):
1. Add a `postbuild` script that copies `src/server/spa/client/*.css` → `dist/server/spa/client/`
2. Use esbuild's `copy` loader (if esbuild infra from 001 is ready)
3. Use `__dirname` with a path that points back to `src/` during development — but this breaks in production builds

Preferred: option 1 (simplest, no esbuild dependency yet).

### 2. deep-wiki — create `client/styles.css` + `client/ask-widget.css`

Because of the `enableAI` conditional and the test that asserts `.ask-widget` is absent when AI is disabled, we split into two files.

**Create** `packages/deep-wiki/src/server/spa/client/styles.css`

Content: merge of three sources:
1. Base CSS from `styles.ts:4–613` (before the mermaid interpolation)
2. The mermaid zoom CSS from `getMermaidZoomStyles()` in `rendering/mermaid-zoom.ts:33–285` — inlined directly
3. Remaining base CSS from `styles.ts:615–757` (after mermaid, up to the `enableAI` check)
4. Admin page CSS from `styles.ts:940–1248` (the unconditional block after the AI section)

Strip the leading 8-space indentation. Total: ~1060 lines of CSS.

**Create** `packages/deep-wiki/src/server/spa/client/ask-widget.css`

Content: the AI widget CSS from `styles.ts:762–936` (the block inside `if (enableAI)`). Approximately 177 lines covering:
- `.ask-widget` positioning, layout, animations
- `.ask-widget-header`, `.ask-widget-title`, `.ask-widget-actions`
- `.ask-widget-input`, `.ask-widget-textarea`
- `.ask-widget-messages`, `.ask-msg`, `.ask-msg-content`
- `.ask-loading`, streaming dot animation
- Responsive `@media (max-width: 768px)` for `.ask-widget`

**Modify** `packages/deep-wiki/src/server/spa/styles.ts`

```typescript
// Before (1251 lines):
import { getMermaidZoomStyles } from '../../rendering/mermaid-zoom';

export function getSpaStyles(enableAI: boolean): string {
    let styles = `...base...
${getMermaidZoomStyles()}
    ...more base...`;
    
    if (enableAI) {
        styles += `...ai widget...`;
    }
    
    styles += `...admin...`;
    
    return styles;
}

// After (~15 lines):
import * as fs from 'fs';
import * as path from 'path';

const baseCss = fs.readFileSync(
    path.join(__dirname, 'client', 'styles.css'), 'utf-8'
);
const askWidgetCss = fs.readFileSync(
    path.join(__dirname, 'client', 'ask-widget.css'), 'utf-8'
);

export function getSpaStyles(enableAI: boolean): string {
    return enableAI ? baseCss + '\n' + askWidgetCss : baseCss;
}
```

- The `getMermaidZoomStyles()` import is removed — its CSS is now inlined in `styles.css`.
- The `enableAI` conditional is preserved via concatenation of the two file contents.
- Function signature `getSpaStyles(enableAI: boolean): string` unchanged → callers unaffected.

### 3. File copy for both packages

For each package, ensure `.css` files in `src/server/spa/client/` are copied to the build output directory. Add to each package's `package.json` scripts:

```json
"copy-css": "cp -r src/server/spa/client dist/server/spa/client"
```

Or integrate into the existing build step. The exact mechanism depends on what commit 001 established.

## Files changed

| Action | Path |
|--------|------|
| **Create** | `packages/pipeline-cli/src/server/spa/client/styles.css` |
| **Modify** | `packages/pipeline-cli/src/server/spa/styles.ts` |
| **Create** | `packages/deep-wiki/src/server/spa/client/styles.css` |
| **Create** | `packages/deep-wiki/src/server/spa/client/ask-widget.css` |
| **Modify** | `packages/deep-wiki/src/server/spa/styles.ts` |
| **Modify** | `packages/pipeline-cli/package.json` _(if adding copy-css script)_ |
| **Modify** | `packages/deep-wiki/package.json` _(if adding copy-css script)_ |

## Test impact

### pipeline-cli (`test/server/spa.test.ts`)

The `getDashboardStyles` describe block (12+ tests) calls `getDashboardStyles()` and asserts `toContain(...)` on CSS selectors and properties. These tests will continue to pass as long as:
- The `.css` file is accessible via `fs.readFileSync` at test time
- Since tests import from `src/` (TypeScript), `__dirname` points to the source tree where `client/styles.css` exists → tests pass without needing a build step

Tests affected (all should pass unchanged):
- "defines light-theme CSS custom properties" — checks `--bg-primary`, `--text-primary`, `--accent`
- "supports dark theme override" — checks `html[data-theme="dark"]`
- "includes status color variables" — checks `--status-running`, etc.
- "defines layout grid" — checks `grid-template-columns`
- "includes responsive breakpoint" — checks `@media (max-width: 768px)`
- "defines custom scrollbar styles" — checks `::-webkit-scrollbar`
- "defines status badge styles" — checks `.status-badge.running`, etc.
- All conversation, queue, and enqueue dialog style tests

### deep-wiki (`test/server/spa-template.test.ts`)

Tests call `generateSpaHtml(...)` which internally calls `getSpaStyles(enableAI)`. Key tests:
- **enableAI: true** tests — assert `html.toContain('.ask-widget')`, `toContain('position: fixed')` → pass because `askWidgetCss` is concatenated
- **enableAI: false** tests — assert `html.not.toContain('.ask-widget')` → pass because `askWidgetCss` is excluded
- All other style tests (top-bar, TOC, responsive, sidebar-collapse, nav-section, area-based) — pass because they reference CSS in the base file

The `getMermaidZoomStyles()` import removal has no test impact — the mermaid CSS content is now inlined in `styles.css` and the same selectors are present.

## Verification checklist

- [ ] `packages/pipeline-cli/src/server/spa/client/styles.css` contains valid CSS (no TypeScript artifacts, no backticks, no `${...}`)
- [ ] `packages/deep-wiki/src/server/spa/client/styles.css` contains the mermaid zoom CSS inline (search for `.mermaid-container`)
- [ ] `packages/deep-wiki/src/server/spa/client/ask-widget.css` contains only the AI widget CSS
- [ ] `getDashboardStyles()` returns identical string content as before (diff the output)
- [ ] `getSpaStyles(false)` returns identical string content as before (minus whitespace normalization)
- [ ] `getSpaStyles(true)` returns identical string content as before
- [ ] `npm run test:run` passes in `packages/pipeline-cli/`
- [ ] `npm run test:run` passes in `packages/deep-wiki/`
- [ ] CSS files are properly indentation-normalized (no leading 8-space indent from the TypeScript embedding)

## Commit message

```
refactor(spa): extract client CSS from string literals to real .css files

Move CSS content out of getDashboardStyles() and getSpaStyles() template
literals into dedicated .css files under client/ directories:

- pipeline-cli: client/styles.css (~950 lines)
- deep-wiki: client/styles.css (~1060 lines) + client/ask-widget.css (~177 lines)

The enableAI conditional in deep-wiki is preserved by loading ask-widget.css
separately and concatenating only when enableAI is true.

Function signatures are unchanged — callers are unaffected.
```
