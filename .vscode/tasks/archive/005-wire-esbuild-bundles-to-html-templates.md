---
status: pending
commit: "005-wire-esbuild-bundles-to-html-templates"
depends_on:
  - 001
  - 002
  - 003
  - 004
---

# 005 — Wire esbuild bundles into HTML templates and switch to config injection

## Motivation

This is the switchover commit. Commits 001–004 created real client source files
(`client/src/*.ts`, `client/src/*.css`) and configured esbuild to bundle them
into `client/dist/bundle.js` + `client/dist/bundle.css`. Nothing consumes those
bundles yet. This commit updates both HTML template generators to inline the
esbuild-produced bundles instead of calling the old string-returning assembler
functions, and introduces the `window.__CONFIG__` injection pattern so the
client code can read runtime options without template-literal interpolation.

## Key facts discovered

### Module resolution — both packages run from `dist/`

| Package | `main` | `bin` | `tsconfig.rootDir` → `outDir` |
|---------|--------|-------|-------------------------------|
| pipeline-cli | `dist/index.js` | `./dist/index.js` | `src` → `dist` |
| deep-wiki | `dist/index.js` | `./dist/index.js` | `src` → `dist` |

Both are CommonJS (`"module": "commonjs"`). At runtime, `__dirname` inside the
compiled `dist/server/spa/html-template.js` resolves to
`<pkg-root>/dist/server/spa/`.

### deep-wiki has a second build path (`build:bundle`)

`deep-wiki` uses `esbuild.config.mjs` to produce a single-file
`dist/index.js` bundle for npm publishing (bundles `pipeline-core` but
externalises `@github/copilot-sdk`, `commander`, `js-yaml`). When publishing,
*everything* is in one file — so `fs.readFileSync(__dirname + '/client/...')`
won't work unless the client bundles are copied alongside it or embedded as
string constants. This must be handled (see Design Decision below).

### Current assembler structure

**pipeline-cli** (`packages/pipeline-cli/src/server/spa/`)
- `html-template.ts` — calls `getDashboardStyles()` and `getDashboardScript(opts)`
- `styles.ts` → `getDashboardStyles(): string` (964 lines of CSS-in-JS)
- `scripts.ts` → `getDashboardScript(opts): string` — concatenates 8 sub-modules
- `scripts/core.ts` — embeds `API_BASE` and `WS_PATH` via template literals from `opts`
- `scripts/queue.ts`, `scripts/websocket.ts` — also read from `opts`
- `html-template.ts` also calls `getAllModels()` from `pipeline-core` to render `<option>` tags server-side
- `index.ts` exports: `generateDashboardHtml`, `DashboardOptions`
- `types.ts` defines `DashboardOptions` and `ScriptOptions`

**deep-wiki** (`packages/deep-wiki/src/server/spa/`)
- `html-template.ts` — calls `getSpaStyles(enableAI)` and `getSpaScript(opts)`
- `styles.ts` → `getSpaStyles(enableAI: boolean): string` (1251 lines) — conditionally appends AI widget CSS when `enableAI` is true
- `script.ts` → `getSpaScript(opts): string` — concatenates 10 sub-modules, conditionally includes `graph`, `ask-ai`, `websocket`
- `scripts/core.ts` — embeds `currentTheme` from `defaultTheme`
- `html-template.ts` conditionally renders:
  - D3 `<script>` tag when `enableGraph`
  - Ask AI widget HTML when `enableAI`
  - Live-reload bar when `enableWatch`
- CDN `<script>` tags for highlight.js, mermaid, marked (must stay in template)
- Barrel re-export at `src/server/spa-template.ts` → `./spa`
- `index.ts` exports: `generateSpaHtml`, `SpaTemplateOptions`
- `types.ts` defines `SpaTemplateOptions`, `ScriptOptions`

### Server-side HTML consumption

**pipeline-cli** — `src/server/index.ts:134`:
```typescript
const spaHtml = generateDashboardHtml();  // no args — uses defaults
```
The returned HTML string is passed to `createRequestHandler({ ..., spaHtml })`.

**deep-wiki** — `src/server/index.ts:121–128`:
```typescript
const spaHtml = generateSpaHtml({
    theme, title, enableSearch: true,
    enableAI: aiEnabled, enableGraph: true,
    enableWatch: !!(options.watch && options.repoPath),
});
```

### Test imports that need backward compatibility

**pipeline-cli** `test/server/spa.test.ts` imports:
- `generateDashboardHtml` from `../../src/server/spa`
- `escapeHtml` from `../../src/server/spa/helpers`
- `getDashboardStyles` from `../../src/server/spa/styles`
- `getDashboardScript` from `../../src/server/spa/scripts`
- Individual script modules (`getUtilsScript`, `getCoreScript`, etc.)

**deep-wiki** `test/server/spa-template.test.ts` imports:
- `generateSpaHtml` from `../../src/server/spa-template`

## Design decisions

### 1. Bundle path resolution strategy

After `tsc`, `html-template.ts` compiles to `dist/server/spa/html-template.js`.
The esbuild client build (from commit 001) should output to
`src/server/spa/client/dist/`. A **copy step** in the build script will place
these bundles at `dist/server/spa/client/dist/bundle.{js,css}` so that
`path.join(__dirname, 'client/dist/bundle.js')` works at runtime from the
compiled `dist/` tree.

For deep-wiki's `build:bundle` (single-file esbuild for npm), we have two
options:
- **(A)** Add an esbuild plugin that reads client bundles at build time and
  embeds them as string constants.
- **(B)** Add a build step that copies `client/dist/` into the published `dist/`
  alongside `dist/index.js`, and adjust the `files` field in `package.json`.

**Decision: (B)** — simpler, no plugin needed. Update `package.json` `"files"`
to include `"dist/server/spa/client/dist"`. Add a `postbuild` script:
```
"postbuild": "cp -r src/server/spa/client/dist dist/server/spa/client/dist"
```
(Or use a Node.js copy script for Windows compat.)

### 2. Config injection pattern

Instead of interpolating runtime values into JS string templates, inject a
config object via a small inline `<script>` tag **before** the bundle:

```html
<script>
  window.__DASHBOARD_CONFIG__ = { apiBase: '/api', wsPath: '/ws', theme: 'auto' };
</script>
<script>/* ... bundle.js contents ... */</script>
```

The client code (from commits 002–004) reads `window.__DASHBOARD_CONFIG__`
instead of relying on closure variables set by template interpolation.

**pipeline-cli config shape:**
```typescript
window.__DASHBOARD_CONFIG__ = {
    apiBase: string,   // from opts.apiBasePath (default: '/api')
    wsPath: string,    // from opts.wsPath (default: '/ws')
    theme: string,     // from opts.theme (default: 'auto')
}
```

**deep-wiki config shape:**
```typescript
window.__WIKI_CONFIG__ = {
    defaultTheme: string,   // from opts.theme
    enableSearch: boolean,
    enableAI: boolean,
    enableGraph: boolean,
    enableWatch: boolean,
}
```

### 3. `getAllModels()` server-side rendering stays in html-template.ts

The pipeline-cli HTML template renders `<option>` tags for all available AI
models by calling `getAllModels()` at template generation time (line 134).
This is server-side data that cannot move to the client bundle. It stays
in `html-template.ts` as-is.

### 4. Conditional HTML sections stay in html-template.ts

deep-wiki's template conditionally includes:
- CDN `<script>` tags for d3 (when `enableGraph`)
- Ask AI widget HTML (when `enableAI`)
- Live-reload bar (when `enableWatch`)

These HTML sections stay server-rendered. Only the `<style>` and main
`<script>` blocks switch to the esbuild bundles.

### 5. Old assembler functions — keep but deprecate

`scripts.ts`/`script.ts` and `styles.ts` in both packages are imported by
tests. They will be kept with a `@deprecated` JSDoc tag and their bodies
unchanged. `html-template.ts` will stop importing them. A later commit (006
or 007) will migrate tests and remove the old files.

## File-by-file changes

### pipeline-cli

#### `packages/pipeline-cli/src/server/spa/html-template.ts`

**Remove imports:**
```typescript
// REMOVE:
import { getDashboardStyles } from './styles';
import { getDashboardScript } from './scripts';
```

**Add imports:**
```typescript
import * as fs from 'fs';
import * as path from 'path';
```

**Add module-level bundle reads** (read once at require-time):
```typescript
const bundleCss = fs.readFileSync(
    path.join(__dirname, 'client', 'dist', 'bundle.css'), 'utf-8'
);
const bundleJs = fs.readFileSync(
    path.join(__dirname, 'client', 'dist', 'bundle.js'), 'utf-8'
);
```

**Replace `<style>` block** — change:
```
    <style>
${getDashboardStyles()}
    </style>
```
to:
```
    <style>
${bundleCss}
    </style>
```

**Replace `<script>` block** — change:
```
    <script>
${getDashboardScript({ defaultTheme: theme, wsPath, apiBasePath })}
    </script>
```
to:
```
    <script>
    window.__DASHBOARD_CONFIG__ = {
        apiBase: ${JSON.stringify(apiBasePath)},
        wsPath: ${JSON.stringify(wsPath)},
        theme: ${JSON.stringify(theme)}
    };
    </script>
    <script>
${bundleJs}
    </script>
```

**Keep everything else unchanged** — `escapeHtml`, `getAllModels()` rendering,
the full HTML structure, and the function signature.

#### `packages/pipeline-cli/src/server/spa/scripts.ts`

Add `@deprecated` JSDoc to `getDashboardScript`. No other changes.

#### `packages/pipeline-cli/src/server/spa/styles.ts`

Add `@deprecated` JSDoc to `getDashboardStyles`. No other changes.

#### `packages/pipeline-cli/src/server/spa/index.ts`

No changes needed. It only exports `generateDashboardHtml` and
`DashboardOptions`, which are unchanged.

#### `packages/pipeline-cli/package.json`

Add build steps for client bundle copy:
```json
"scripts": {
    "build": "tsc && npm run build:copy-client",
    "build:copy-client": "node -e \"const fs=require('fs');const p=require('path');const s=p.join('src','server','spa','client','dist');const d=p.join('dist','server','spa','client','dist');fs.mkdirSync(d,{recursive:true});for(const f of fs.readdirSync(s))fs.copyFileSync(p.join(s,f),p.join(d,f))\"",
    ...
}
```

### deep-wiki

#### `packages/deep-wiki/src/server/spa/html-template.ts`

**Remove imports:**
```typescript
// REMOVE:
import { getSpaStyles } from './styles';
import { getSpaScript } from './script';
```

**Add imports:**
```typescript
import * as fs from 'fs';
import * as path from 'path';
```

**Add module-level bundle reads:**
```typescript
const bundleCss = fs.readFileSync(
    path.join(__dirname, 'client', 'dist', 'bundle.css'), 'utf-8'
);
const bundleJs = fs.readFileSync(
    path.join(__dirname, 'client', 'dist', 'bundle.js'), 'utf-8'
);
```

**Replace `<style>` block** — change:
```
    <style>
${getSpaStyles(enableAI)}
    </style>
```
to:
```
    <style>
${bundleCss}
    </style>
```

Note: The old `getSpaStyles(enableAI)` conditionally appended AI widget CSS
(line 759 of styles.ts). In the new approach, the esbuild bundle from commit
002 includes *all* styles unconditionally — unused AI styles have zero runtime
cost since they're just CSS selectors that never match if the HTML elements
aren't rendered. The `enableAI` flag still controls whether the AI HTML widget
is rendered (lines 242–259 of html-template.ts).

**Replace `<script>` block** — change:
```
    <script>
${getSpaScript({ enableSearch, enableAI, enableGraph, enableWatch, defaultTheme: theme })}
    </script>
```
to:
```
    <script>
    window.__WIKI_CONFIG__ = {
        defaultTheme: ${JSON.stringify(theme)},
        enableSearch: ${JSON.stringify(enableSearch)},
        enableAI: ${JSON.stringify(enableAI)},
        enableGraph: ${JSON.stringify(enableGraph)},
        enableWatch: ${JSON.stringify(enableWatch)}
    };
    </script>
    <script>
${bundleJs}
    </script>
```

**Keep everything else unchanged** — CDN script tags, conditional HTML sections,
and the function signature.

#### `packages/deep-wiki/src/server/spa/script.ts`

Add `@deprecated` JSDoc to `getSpaScript`. No other changes.

#### `packages/deep-wiki/src/server/spa/styles.ts`

Add `@deprecated` JSDoc to `getSpaStyles`. No other changes.

#### `packages/deep-wiki/src/server/spa/index.ts`

No changes needed.

#### `packages/deep-wiki/package.json`

Update build and files for client bundle:
```json
"scripts": {
    "build": "tsc && npm run build:copy-client",
    "build:copy-client": "node -e \"...same copy script pattern...\"",
    ...
}
```

Update `"files"` to include client dist for the publish build:
```json
"files": [
    "dist/index.js",
    "dist/index.js.map",
    "dist/server/spa/client/dist"
]
```

## Verification

1. **Build both packages:**
   ```bash
   cd packages/pipeline-cli && npm run build
   cd packages/deep-wiki && npm run build
   ```
   Confirm `dist/server/spa/client/dist/bundle.{js,css}` exist in both.

2. **Run existing tests (they should still pass):**
   ```bash
   cd packages/pipeline-cli && npm run test:run
   cd packages/deep-wiki && npm run test:run
   ```
   Tests that import `getDashboardScript`, `getDashboardStyles`, etc. still
   work because those functions are preserved. Tests on `generateDashboardHtml`
   / `generateSpaHtml` will pass if client bundles are present in
   `dist/server/spa/client/dist/` (need a pre-test build step or mock).

3. **Smoke test the HTML output:**
   - `generateDashboardHtml()` should produce HTML with `window.__DASHBOARD_CONFIG__`
   - `generateSpaHtml(...)` should produce HTML with `window.__WIKI_CONFIG__`
   - Both should still contain `<style>` and `<script>` blocks
   - deep-wiki should still contain CDN script tags for hljs, mermaid, marked

4. **Verify the deep-wiki publish bundle:**
   ```bash
   cd packages/deep-wiki && npm run build:bundle
   ```
   Confirm the output still works (single-file build externalises only
   npm deps, client bundles are alongside in `dist/`).

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| `fs.readFileSync` at module load fails in tests that don't have built client bundles | Tests for `generateDashboardHtml`/`generateSpaHtml` need client bundles present; add `build:client` as a test prerequisite, or mock `fs.readFileSync` |
| deep-wiki `build:bundle` single-file build can't resolve `path.join(__dirname, ...)` at runtime | `__dirname` in the esbuild bundle will point to the `dist/` directory; ensure client dist is copied to the right place relative to the output |
| Breaking change for downstream consumers importing `getDashboardScript` | Functions are preserved with `@deprecated`; no breakage |
| CSS includes unused AI styles in deep-wiki when AI is disabled | Zero runtime cost — CSS selectors simply don't match. Saves ~500 lines of conditional logic |
