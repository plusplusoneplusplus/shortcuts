---
status: done
---

# 011: Move Deep-Wiki Server Tests to CoC

## Summary
Move all 17 deep-wiki server test files (7,953 lines, 518 tests) to `coc/test/server/wiki/`, adapting import paths from deep-wiki source locations to CoC source locations.

## Motivation
Tests must live alongside their source code. With all wiki server modules now in CoC, the tests need to move too to maintain test coverage and enable CI verification.

## Changes

### Files to Create

Create directory `packages/coc/test/server/wiki/` and copy all 17 test files:

| # | File | Lines | Tests | Source Imports |
|---|------|------:|------:|----------------|
| 1 | `spa-template.test.ts` | 932 | 92 | `spa-template` |
| 2 | `generate-handler.test.ts` | 805 | 38 | `server/index`, `generate-handler`, types |
| 3 | `theme-support.test.ts` | 669 | 29 | `wiki-data`, `context-builder`, `server/index`, types |
| 4 | `ask-handler.test.ts` | 619 | 33 | `ask-handler`, `context-builder`, `conversation-session-manager`, types |
| 5 | `wiki-data.test.ts` | 533 | 28 | `wiki-data`, types |
| 6 | `dependency-graph.test.ts` | 524 | 51 | `spa-template`, `server/index`, types |
| 7 | `admin-handlers.test.ts` | 502 | 22 | `server/index`, types |
| 8 | `ask-api-integration.test.ts` | 455 | 14 | `server/index`, types |
| 9 | `api-handlers.test.ts` | 419 | 19 | `server/index`, types |
| 10 | `ask-panel.test.ts` | 413 | 61 | `spa-template` |
| 11 | `explore-handler.test.ts` | 354 | 20 | `explore-handler`, `wiki-data`, types |
| 12 | `file-watcher.test.ts` | 320 | 1 | `file-watcher`, types |
| 13 | `conversation-session-manager.test.ts` | 329 | 24 | `conversation-session-manager`, `ask-handler` |
| 14 | `context-builder.test.ts` | 291 | 23 | `context-builder`, types |
| 15 | `deep-dive-ui.test.ts` | 289 | 42 | `spa-template` |
| 16 | `websocket.test.ts` | 261 | 8 | `websocket` |
| 17 | `index.test.ts` | 238 | 13 | `server/index`, types |

**Total: 7,953 lines, 518 tests**

### Files to Modify

Each test file requires import path transformations (see [Import Transformation Map](#import-transformation-map) below).

`packages/coc/vitest.config.ts` — **no changes needed**. The existing glob pattern `test/**/*.test.ts` already matches `test/server/wiki/*.test.ts`.

### Files to Delete

(none — deep-wiki test cleanup is handled in a separate removal commit)

## Implementation Notes

### Import Transformation Map

From `packages/coc/test/server/wiki/*.test.ts`, the relative path to `packages/coc/src/` is `../../../src/`. The wiki server modules are expected at `packages/coc/src/server/wiki/` per the plan in commits 004–005.

**Pattern A — Server barrel import** (used by 9 files):
```
// OLD: import { createServer, type WikiServer } from '../../src/server';
// NEW: import { createServer, type WikiServer } from '../../../src/server/wiki';
```
Files: `admin-handlers`, `api-handlers`, `dependency-graph`, `generate-handler`, `index`, `theme-support`

```
// OLD: import { createServer } from '../../src/server/index';
//      import type { WikiServer } from '../../src/server/index';
// NEW: import { createServer } from '../../../src/server/wiki/index';
//      import type { WikiServer } from '../../../src/server/wiki/index';
```
Files: `ask-api-integration`

**Pattern B — Specific server module import** (used by 11 files):
```
// OLD: import { X } from '../../src/server/<module>';
// NEW: import { X } from '../../../src/server/wiki/<module>';
```
Affected modules and files:
- `ask-handler` → `ask-handler.test.ts`, `conversation-session-manager.test.ts`
- `context-builder` → `ask-handler.test.ts`, `context-builder.test.ts`, `theme-support.test.ts`
- `conversation-session-manager` → `ask-handler.test.ts`
- `explore-handler` → `explore-handler.test.ts`
- `file-watcher` → `file-watcher.test.ts`
- `generate-handler` → `generate-handler.test.ts`
- `spa-template` → `ask-panel.test.ts`, `deep-dive-ui.test.ts`, `dependency-graph.test.ts`, `spa-template.test.ts`
- `websocket` → `websocket.test.ts`
- `wiki-data` → `explore-handler.test.ts`, `theme-support.test.ts`, `wiki-data.test.ts`

**Pattern C — Types import** (used by 13 files):
```
// OLD: import type { ComponentGraph } from '../../src/types';
// NEW: import type { ComponentGraph } from '../../../src/server/wiki/types';
```
Or, if wiki types are re-exported from a shared location, adjust accordingly. The specific types imported are:
- `ComponentGraph` — 13 files
- `ComponentAnalysis` — `wiki-data.test.ts`
- `ThemeMeta` — `theme-support.test.ts`
- `SpaTemplateOptions` — `ask-panel.test.ts`, `deep-dive-ui.test.ts`
- `AskHandlerOptions` — `ask-handler.test.ts`
- `ExploreHandlerOptions` — `explore-handler.test.ts`
- `WSMessage` — `websocket.test.ts`
- `AskAIFunction` — `conversation-session-manager.test.ts`

**Note:** `SpaTemplateOptions`, `AskHandlerOptions`, `ExploreHandlerOptions`, `WSMessage`, and `AskAIFunction` are imported from their respective server modules (Pattern B), not from `types.ts`. Only `ComponentGraph`, `ComponentAnalysis`, and `ThemeMeta` are imported from the top-level `../../src/types` (Pattern C).

### Shared Test Utilities / Fixtures

None. All 17 test files are self-contained — no shared test helpers, fixtures, or utility modules are imported. Each test file creates its own mock data inline.

### HTTP Server Tests

10 test files create actual HTTP servers via `createServer()` with `port: 0` (OS-assigned port). This avoids port conflicts — no port changes are needed:
- `admin-handlers.test.ts`
- `api-handlers.test.ts`
- `ask-api-integration.test.ts` (multiple server instances per test)
- `dependency-graph.test.ts`
- `generate-handler.test.ts`
- `index.test.ts`
- `theme-support.test.ts`

Additionally, `websocket.test.ts` uses `http.createServer()` directly with `.listen(0)`.

### Naming Conflict

CoC already has `test/server/websocket.test.ts` (for the process WebSocket server). The wiki `websocket.test.ts` goes into `test/server/wiki/websocket.test.ts`, so there is no filename conflict — they live in different directories.

### Migration Steps

1. Create `packages/coc/test/server/wiki/` directory
2. Copy all 17 `.test.ts` files from `packages/deep-wiki/test/server/`
3. Apply Pattern A transformation (sed: `../../src/server` → `../../../src/server/wiki`)
4. Apply Pattern B transformation (sed: `../../src/server/` → `../../../src/server/wiki/`)
5. Apply Pattern C transformation (sed: `../../src/types` → `../../../src/server/wiki/types`)
6. Verify all imports resolve: `cd packages/coc && npx tsc --noEmit`
7. Run tests: `cd packages/coc && npm run test:run`

**Important:** Steps 3–5 can be combined into a single sed pass:
```bash
sed -i '' "s|from '../../src/server|from '../../../src/server/wiki|g" packages/coc/test/server/wiki/*.test.ts
sed -i '' "s|from '../../src/types|from '../../../src/server/wiki/types|g" packages/coc/test/server/wiki/*.test.ts
```
The first sed handles both Pattern A (`../../src/server'` → `../../../src/server/wiki'`) and Pattern B (`../../src/server/X` → `../../../src/server/wiki/X`). The second sed handles Pattern C.

**Caveat for Pattern C:** If the wiki types (`ComponentGraph`, `ComponentAnalysis`, `ThemeMeta`) are re-exported from a barrel or placed in a different location in CoC (e.g., a shared `types.ts`), adjust Pattern C accordingly. Check where commit 004 places these types.

## Tests
- All 518 moved tests pass in CoC package (`npm run test:run` in `packages/coc/`)
- Existing 12 CoC server tests unaffected
- No duplicate test files between `test/server/` and `test/server/wiki/`

## Acceptance Criteria
- [x] All 17 server test files exist in `coc/test/server/wiki/`
- [x] All 518 tests pass with `npm run test:run` in `packages/coc/` (actual: 522 tests)
- [x] All imports resolve correctly (no TypeScript errors)
- [x] Existing CoC tests unaffected (no regressions)
- [x] No test files duplicated across packages

## Dependencies
- Depends on: 004 (all wiki routes and handlers moved to CoC `src/server/wiki/`)
- Depends on: 005 (WebSocket extensions for wiki server in CoC)
- Pattern C transformation depends on knowing where 004 places the deep-wiki types (`ComponentGraph`, `ComponentAnalysis`, `ThemeMeta`) in CoC
