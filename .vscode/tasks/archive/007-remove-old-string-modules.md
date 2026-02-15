---
status: pending
depends_on: 006-update-tests-for-bundles
---

# 007 — Remove Old String-Returning Script and Style Modules

## Motivation

With esbuild-bundled client files wired up and tests passing (commit 006), the old
string-concatenation modules under `scripts/` directories are dead code. Removing
them eliminates confusion and reduces maintenance burden.

## Scope

### A. pipeline-cli (`packages/pipeline-cli/src/server/spa/`)

#### A1. Delete individual script modules (`scripts/` directory)

Delete every file inside `scripts/`:

| File | Replaced by |
|---|---|
| `scripts/core.ts` | `client/core.ts` |
| `scripts/utils.ts` | `client/utils.ts` |
| `scripts/theme.ts` | `client/theme.ts` |
| `scripts/sidebar.ts` | `client/sidebar.ts` |
| `scripts/detail.ts` | `client/detail.ts` |
| `scripts/filters.ts` | `client/filters.ts` |
| `scripts/queue.ts` | `client/queue.ts` |
| `scripts/websocket.ts` | `client/websocket.ts` |

After deletion, remove the now-empty `scripts/` directory itself.

#### A2. Delete assembler module

- **`scripts.ts`** — Assembler that imports all `scripts/*` modules and exports
  `getDashboardScript()`. No longer needed once `html-template.ts` reads the
  esbuild JS bundle directly.

#### A3. Delete or simplify styles module

- **`styles.ts`** — Exports `getDashboardStyles()` (965 lines of CSS-in-JS).
  Delete if `html-template.ts` now reads the esbuild CSS bundle directly.
  If it still serves as an accessor that reads the `.css` bundle file, keep it
  but strip all inline CSS; it should only contain the file-read logic.

#### A4. Update html-template.ts imports

Current imports to remove/replace (lines 13–14):

```typescript
import { getDashboardStyles } from './styles';    // line 13
import { getDashboardScript } from './scripts';    // line 14
```

These should already have been replaced in commits 004–005 with bundle-reading
logic. Verify they are gone; if not, update them.

#### A5. Verify index.ts

`packages/pipeline-cli/src/server/spa/index.ts` currently exports only:

```typescript
export { generateDashboardHtml } from './html-template';
export type { DashboardOptions } from './types';
```

No changes needed — it does not re-export any script/style modules.

#### A6. Update test file

`packages/pipeline-cli/test/server/spa.test.ts` has **10 imports** from the old
modules (lines 12–21):

```typescript
import { getDashboardStyles } from '../../src/server/spa/styles';
import { getDashboardScript } from '../../src/server/spa/scripts';
import { getUtilsScript } from '../../src/server/spa/scripts/utils';
import { getCoreScript } from '../../src/server/spa/scripts/core';
import { getThemeScript } from '../../src/server/spa/scripts/theme';
import { getSidebarScript } from '../../src/server/spa/scripts/sidebar';
import { getDetailScript } from '../../src/server/spa/scripts/detail';
import { getFiltersScript } from '../../src/server/spa/scripts/filters';
import { getQueueScript } from '../../src/server/spa/scripts/queue';
import { getWebSocketScript } from '../../src/server/spa/scripts/websocket';
```

These imports feed **~12 `describe` blocks** that test individual script output
(lines 189–1098). Commit 006 should have already migrated these tests to use the
bundled output. If any still reference the old modules:

- Remove all imports of deleted modules.
- Remove or replace the `describe` blocks that call deleted functions directly
  (`getDashboardStyles`, `getDashboardScript`, `getUtilsScript`, `getCoreScript`,
  `getThemeScript`, `getSidebarScript`, `getDetailScript`, `getFiltersScript`,
  `getQueueScript`, `getWebSocketScript`).
- Keep `escapeHtml` and `generateDashboardHtml` tests unchanged.

---

### B. deep-wiki (`packages/deep-wiki/src/server/spa/`)

#### B1. Delete individual script modules (`scripts/` directory)

Delete every file inside `scripts/`:

| File | Replaced by |
|---|---|
| `scripts/core.ts` | `client/core.ts` |
| `scripts/theme.ts` | `client/theme.ts` |
| `scripts/sidebar.ts` | `client/sidebar.ts` |
| `scripts/content.ts` | `client/content.ts` |
| `scripts/markdown.ts` | `client/markdown.ts` |
| `scripts/toc.ts` | `client/toc.ts` |
| `scripts/graph.ts` | `client/graph.ts` |
| `scripts/ask-ai.ts` | `client/ask-ai.ts` |
| `scripts/websocket.ts` | `client/websocket.ts` |
| `scripts/admin.ts` | `client/admin.ts` |

After deletion, remove the now-empty `scripts/` directory itself.

#### B2. Delete assembler module

- **`script.ts`** (singular) — Assembler that imports all `scripts/*` modules and
  exports `getSpaScript()`. Delete once `html-template.ts` reads the esbuild JS
  bundle directly.

#### B3. Delete or simplify styles module

- **`styles.ts`** — Exports `getSpaStyles(enableAI)` (~1252 lines of CSS-in-JS).
  Same decision as pipeline-cli: delete if html-template reads bundle directly,
  or strip to a thin file-read accessor.

#### B4. Update html-template.ts imports

Current imports to remove/replace (lines 10–11):

```typescript
import { getSpaStyles } from './styles';    // line 10
import { getSpaScript } from './script';    // line 11
```

Verify these were already replaced in commits 004–005.

#### B5. Verify index.ts

`packages/deep-wiki/src/server/spa/index.ts` currently exports only:

```typescript
export { generateSpaHtml } from './html-template';
export type { SpaTemplateOptions } from './types';
```

No changes needed.

#### B6. Verify backward-compat barrel

`packages/deep-wiki/src/server/spa-template.ts` re-exports from `./spa`:

```typescript
export { generateSpaHtml } from './spa';
export type { SpaTemplateOptions } from './spa';
```

No changes needed — it only references `./spa` (the barrel), not individual
script/style modules.

#### B7. Verify test file

`packages/deep-wiki/test/server/spa-template.test.ts` only imports:

```typescript
import { generateSpaHtml } from '../../src/server/spa-template';
```

It does **not** import any individual script/style modules directly. It tests the
generated HTML output. No changes needed for this test file.

---

### C. Unrelated `getStyles`/`getScript` references — NO ACTION

These exist elsewhere but are **unrelated** to the SPA script modules being deleted:

- `packages/deep-wiki/src/writing/website-generator.ts` → imports from
  `./website-styles` and `./website-client-script` (different feature)
- `src/shortcuts/discovery/discovery-webview/` → local `getStyles()` functions
- `src/shortcuts/yaml-pipeline/ui/` → local `getStyles()` functions

## Checklist

1. [ ] Delete all 8 files in `pipeline-cli/src/server/spa/scripts/`
2. [ ] Remove `pipeline-cli/src/server/spa/scripts/` directory
3. [ ] Delete `pipeline-cli/src/server/spa/scripts.ts` (assembler)
4. [ ] Delete or strip `pipeline-cli/src/server/spa/styles.ts`
5. [ ] Verify `pipeline-cli html-template.ts` no longer imports from deleted modules
6. [ ] Remove old-module imports and associated `describe` blocks from
       `pipeline-cli/test/server/spa.test.ts`
7. [ ] Delete all 10 files in `deep-wiki/src/server/spa/scripts/`
8. [ ] Remove `deep-wiki/src/server/spa/scripts/` directory
9. [ ] Delete `deep-wiki/src/server/spa/script.ts` (assembler)
10. [ ] Delete or strip `deep-wiki/src/server/spa/styles.ts`
11. [ ] Verify `deep-wiki html-template.ts` no longer imports from deleted modules
12. [ ] Verify `deep-wiki spa-template.ts` barrel is unaffected
13. [ ] Verify `deep-wiki/test/server/spa-template.test.ts` is unaffected
14. [ ] Run `npm run test:run` in both `packages/pipeline-cli/` and `packages/deep-wiki/`
15. [ ] Run `npm run build` in both packages to confirm clean compilation
16. [ ] Grep entire repo for any remaining references to deleted modules

## Verification

```bash
# Confirm no dangling imports
grep -r "from.*spa/scripts/" packages/pipeline-cli/src/ packages/deep-wiki/src/
grep -r "from.*spa/script'" packages/deep-wiki/src/
grep -r "from.*spa/scripts'" packages/pipeline-cli/src/

# Build both packages
cd packages/pipeline-cli && npm run build && cd ../..
cd packages/deep-wiki && npm run build && cd ../..

# Run tests
cd packages/pipeline-cli && npm run test:run && cd ../..
cd packages/deep-wiki && npm run test:run && cd ../..
```
