---
status: pending
commit: 001-add-esbuild-infra
title: "Add esbuild infrastructure and client directory skeleton"
depends_on: []
---

# 001 — Add esbuild infrastructure and client directory skeleton

## Motivation

All client-side JS and CSS across both SPA packages is currently authored as
TypeScript functions that return JavaScript/CSS source code inside template
literal strings (~6,200 lines total: ~2,567 in pipeline-cli, ~3,637 in
deep-wiki). This means zero IDE support (no autocomplete, no linting, no type
checking, no syntax highlighting) for the actual browser code.

This commit establishes the build tooling and directory structure *before* any
code is migrated, so later commits can move code file-by-file with clean diffs.

**No runtime behaviour change.**

---

## Current State

### pipeline-cli

| Item | Value |
|------|-------|
| **package.json** | `packages/pipeline-cli/package.json` |
| **build script** | `"build": "tsc"` |
| **esbuild dep** | ❌ not present |
| **tsconfig rootDir** | `src` → `dist/` via `tsc` |
| **SPA root** | `packages/pipeline-cli/src/server/spa/` |
| **String-JS files** | `scripts.ts` (assembler, 27 LOC) + `scripts/{core,detail,filters,queue,sidebar,theme,utils,websocket}.ts` (~1,576 LOC) |
| **String-CSS file** | `styles.ts` (964 LOC) |
| **HTML template** | `html-template.ts` — calls `getDashboardStyles()` → `<style>`, `getDashboardScript(opts)` → `<script>`, plus inline HTML body |
| **Options type** | `ScriptOptions { defaultTheme, wsPath, apiBasePath }` in `types.ts` |

### deep-wiki

| Item | Value |
|------|-------|
| **package.json** | `packages/deep-wiki/package.json` |
| **build script** | `"build": "tsc"` (also has `"build:bundle"` for npm-publish bundling via `esbuild.config.mjs`) |
| **prebuild** | `"prebuild": "cd ../pipeline-core && npm run build"` |
| **esbuild dep** | ✅ `"esbuild": "^0.21.5"` in devDependencies |
| **tsconfig rootDir** | `src` → `dist/` via `tsc` |
| **SPA root** | `packages/deep-wiki/src/server/spa/` |
| **String-JS files** | `script.ts` (assembler, 31 LOC) + `scripts/{admin,ask-ai,content,core,graph,markdown,sidebar,theme,toc,websocket}.ts` (~2,355 LOC) |
| **String-CSS file** | `styles.ts` (1,251 LOC) — also imports `getMermaidZoomStyles()` from `../../rendering/mermaid-zoom` |
| **HTML template** | `html-template.ts` — calls `getSpaStyles(enableAI)` → `<style>`, `getSpaScript(opts)` → `<script>`, plus inline HTML body with CDN `<script>` tags (highlight.js, mermaid, marked, optionally d3) |
| **Options type** | `ScriptOptions { enableSearch, enableAI, enableGraph, enableWatch, defaultTheme }` in `types.ts` |
| **Existing esbuild config** | `esbuild.config.mjs` — bundles the CLI for npm publish (Node/CJS), **not** client code |

### .gitignore

The root `.gitignore` already contains `dist` (line 84) and `dist/` (line 109),
which will match `client/dist/` output directories inside the packages. No
package-level `.gitignore` files exist.

---

## Plan

### 1. Add `esbuild` devDependency to pipeline-cli

**File:** `packages/pipeline-cli/package.json`

```jsonc
// In devDependencies, add:
"esbuild": "^0.21.5"
```

Match the same version specifier already used by deep-wiki.
Run `npm install` from the monorepo root afterwards.

---

### 2. Create client source directories (both packages)

Create the following empty-ish entry points:

#### pipeline-cli

```
packages/pipeline-cli/src/server/spa/client/
├── index.ts        ← entry point (placeholder)
└── styles.css      ← entry point (placeholder)
```

**`client/index.ts`:**
```typescript
/**
 * Pipeline CLI — Dashboard client entry point.
 *
 * This file will be bundled by esbuild into client/dist/bundle.js (IIFE).
 * Code will be migrated here from the string-returning functions in
 * ../scripts.ts and ../scripts/*.ts in subsequent commits.
 */

// Placeholder — real code migrated in later commits.
export {};
```

**`client/styles.css`:**
```css
/**
 * Pipeline CLI — Dashboard client styles.
 *
 * This file will be bundled by esbuild into client/dist/bundle.css.
 * Styles will be migrated here from the string-returning function in
 * ../styles.ts in subsequent commits.
 */

/* Placeholder — real styles migrated in later commits. */
```

#### deep-wiki

```
packages/deep-wiki/src/server/spa/client/
├── index.ts        ← entry point (placeholder)
└── styles.css      ← entry point (placeholder)
```

**`client/index.ts`:**
```typescript
/**
 * Deep Wiki — SPA client entry point.
 *
 * This file will be bundled by esbuild into client/dist/bundle.js (IIFE).
 * Code will be migrated here from the string-returning functions in
 * ../script.ts and ../scripts/*.ts in subsequent commits.
 */

// Placeholder — real code migrated in later commits.
export {};
```

**`client/styles.css`:**
```css
/**
 * Deep Wiki — SPA client styles.
 *
 * This file will be bundled by esbuild into client/dist/bundle.css.
 * Styles will be migrated here from the string-returning function in
 * ../styles.ts in subsequent commits.
 */

/* Placeholder — real styles migrated in later commits. */
```

---

### 3. Create esbuild build scripts

#### `packages/pipeline-cli/scripts/build-client.mjs`

```javascript
/**
 * esbuild config for bundling the pipeline-cli SPA client code.
 *
 * Produces:
 *   src/server/spa/client/dist/bundle.js   (IIFE, for <script> inlining)
 *   src/server/spa/client/dist/bundle.css  (for <style> inlining)
 */
import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/server/spa/client/index.ts'],
    outfile: 'src/server/spa/client/dist/bundle.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: false,          // keep readable for now; minify in later commit
    sourcemap: false,       // inline in <script>, sourcemap not useful
    logLevel: 'info',
});

await esbuild.build({
    entryPoints: ['src/server/spa/client/styles.css'],
    outfile: 'src/server/spa/client/dist/bundle.css',
    bundle: true,
    minify: false,
    logLevel: 'info',
});
```

#### `packages/deep-wiki/scripts/build-client.mjs`

```javascript
/**
 * esbuild config for bundling the deep-wiki SPA client code.
 *
 * Produces:
 *   src/server/spa/client/dist/bundle.js   (IIFE, for <script> inlining)
 *   src/server/spa/client/dist/bundle.css  (for <style> inlining)
 *
 * NOTE: This is separate from esbuild.config.mjs (root), which bundles the
 *       CLI entry point for npm publishing. This script only handles the
 *       browser-side SPA code.
 */
import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/server/spa/client/index.ts'],
    outfile: 'src/server/spa/client/dist/bundle.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: false,
    sourcemap: false,
    logLevel: 'info',
});

await esbuild.build({
    entryPoints: ['src/server/spa/client/styles.css'],
    outfile: 'src/server/spa/client/dist/bundle.css',
    bundle: true,
    minify: false,
    logLevel: 'info',
});
```

---

### 4. Wire npm scripts in both `package.json` files

#### pipeline-cli (`packages/pipeline-cli/package.json`)

```jsonc
"scripts": {
    "build:client": "node scripts/build-client.mjs",
    "build": "npm run build:client && tsc",
    // ... rest unchanged
}
```

#### deep-wiki (`packages/deep-wiki/package.json`)

```jsonc
"scripts": {
    "prebuild": "cd ../pipeline-core && npm run build",
    "build:client": "node scripts/build-client.mjs",
    "build": "npm run build:client && tsc",
    // ... rest unchanged
}
```

Note: deep-wiki's `prebuild` hook runs before `build`, so the effective order
becomes: `prebuild` (pipeline-core build) → `build` (`build:client` then `tsc`).
The existing `build:bundle` script (for npm publish) remains untouched.

---

### 5. Exclude `client/dist/` from tsc and git

#### tsconfig.json (both packages)

Both packages' `tsconfig.json` have `"exclude": ["node_modules", "dist", "test"]`.
The `client/dist/` output lives inside `src/server/spa/client/dist/` which is
within the `"include": ["src/**/*"]` glob, so tsc would try to compile the
generated `.js` files.

Add `"src/**/client/dist"` to the exclude array in both tsconfig files:

```jsonc
"exclude": ["node_modules", "dist", "test", "src/**/client/dist"]
```

#### .gitignore

The root `.gitignore` already has `dist` and `dist/` entries which will match
`packages/*/src/server/spa/client/dist/`. However, to be explicit and
future-proof, add a targeted entry:

```gitignore
# SPA client build output (esbuild)
**/spa/client/dist/
```

---

### 6. Run `npm install` and verify

```bash
# From monorepo root
npm install                                  # installs esbuild for pipeline-cli

# Verify both build:client scripts work
cd packages/pipeline-cli && npm run build:client && cd ../..
cd packages/deep-wiki && npm run build:client && cd ../..

# Verify full build still works
cd packages/pipeline-cli && npm run build && cd ../..
cd packages/deep-wiki && npm run build && cd ../..

# Verify tests still pass
cd packages/pipeline-cli && npm run test:run && cd ../..
cd packages/deep-wiki && npm run test:run && cd ../..

# Verify client/dist/ output exists and is ignored by git
ls packages/pipeline-cli/src/server/spa/client/dist/bundle.{js,css}
ls packages/deep-wiki/src/server/spa/client/dist/bundle.{js,css}
git status  # client/dist/ should NOT appear as untracked
```

---

## Files Changed

| Action | File |
|--------|------|
| **modify** | `packages/pipeline-cli/package.json` — add `esbuild` devDep, add `build:client` script, update `build` script |
| **modify** | `packages/deep-wiki/package.json` — add `build:client` script, update `build` script |
| **create** | `packages/pipeline-cli/src/server/spa/client/index.ts` — empty placeholder |
| **create** | `packages/pipeline-cli/src/server/spa/client/styles.css` — empty placeholder |
| **create** | `packages/deep-wiki/src/server/spa/client/index.ts` — empty placeholder |
| **create** | `packages/deep-wiki/src/server/spa/client/styles.css` — empty placeholder |
| **create** | `packages/pipeline-cli/scripts/build-client.mjs` — esbuild config for client |
| **create** | `packages/deep-wiki/scripts/build-client.mjs` — esbuild config for client |
| **modify** | `packages/pipeline-cli/tsconfig.json` — exclude `src/**/client/dist` |
| **modify** | `packages/deep-wiki/tsconfig.json` — exclude `src/**/client/dist` |
| **modify** | `.gitignore` — add `**/spa/client/dist/` |

**Total: 6 new files, 5 modified files. Zero behaviour change.**

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `build:client` fails in CI — esbuild not installed | esbuild added as devDependency, runs via `npm run` |
| tsc picks up generated `.js` in `client/dist/` | tsconfig `exclude` updated to skip `src/**/client/dist` |
| `client/dist/` committed to git accidentally | Root `.gitignore` already matches `dist`; explicit `**/spa/client/dist/` added as safety |
| deep-wiki `prebuild` ordering conflict | `prebuild` runs before `build`; `build:client` is the first step *within* `build`, so pipeline-core is always built first |
| esbuild version mismatch between packages | Both use `^0.21.5` for consistency |

---

## Commit Message

```
feat: add esbuild infrastructure and client directory skeleton

Add build tooling for bundling SPA client code from real source files
instead of string-concatenated template literals.

- Add esbuild ^0.21.5 devDependency to pipeline-cli (already in deep-wiki)
- Create client/ entry point directories with placeholder index.ts and
  styles.css in both packages' src/server/spa/
- Add scripts/build-client.mjs for both packages (IIFE browser bundles)
- Wire build:client into npm build scripts (runs before tsc)
- Exclude client/dist/ from tsc compilation and git tracking

No behaviour change. Lays groundwork for migrating ~6,200 lines of
string-concatenated JS/CSS to real source files in subsequent commits.
```
