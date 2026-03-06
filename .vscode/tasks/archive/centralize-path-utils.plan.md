# Centralize Cross-Platform Path Utilities in CoC

## Problem

Path handling logic is duplicated across `pipeline-core`, `coc`, and `coc-server`:

- **`replace(/\\/g, '/')`** appears in 7+ locations across 3 packages (SPA + server-side)
- **`startsWith(base + path.sep)` security boundary check** is copy-pasted in 4 handlers
- **`normalizePath()` functions** — 7 independent definitions with varying behavior

Bug fixes or improvements in one copy won't propagate. The security check is especially risky to have duplicated — a subtle mistake in one copy creates a directory traversal vulnerability.

## Approach

Create `packages/pipeline-core/src/utils/path-utils.ts` with two focused utilities, exported through the existing barrel. Both `coc` and `coc-server` already depend on `pipeline-core`.

### New utilities

```ts
// 1. Browser-safe, no Node.js deps — usable in SPA and server code
export function toForwardSlashes(p: string): string {
    return p.replace(/\\/g, '/');
}

// 2. Node.js only (uses path.resolve + path.sep) — server-side security check
export function isWithinDirectory(resolved: string, base: string): boolean {
    const resolvedBase = path.resolve(base);
    const resolvedTarget = path.resolve(resolved);
    return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}
```

### Out of scope

- **Named `normalizePath` variants** — each serves a different purpose (realpath+lowercase, ID generation, trailing-sep removal). Forcing unification would add complexity without benefit.
- **Platform-specific shell commands** (cmd.exe vs /bin/sh, findstr vs grep) — inherently context-specific.
- **`deep-wiki` normalizePath** — different package, different concerns.

## Todos

### 1. Create `path-utils.ts` in pipeline-core ✅
- [x] Create `packages/pipeline-core/src/utils/path-utils.ts` (browser-safe `toForwardSlashes`)
- [x] Create `packages/pipeline-core/src/utils/path-security.ts` (Node.js `isWithinDirectory`)
- [x] Export from `packages/pipeline-core/src/utils/index.ts`
- [x] Export from `packages/pipeline-core/src/index.ts`
- [x] Add subpath export `./utils/path-utils` in package.json for SPA use

### 2. Add tests for path-utils ✅
- [x] Create `packages/pipeline-core/test/utils/path-utils.test.ts`
- [x] Test `toForwardSlashes`: backslashes, forward slashes, mixed, empty string, no-op (7 tests)
- [x] Test `isWithinDirectory`: exact match, child path, traversal attempt, unrelated path, prefix sibling, relative paths (6 tests)

### 3. Replace usages in pipeline-core ✅
- [x] `src/git/git-log-service.ts` (~line 283, 309) — replace inline `.replace(/\\/g, '/')` with `toForwardSlashes()`
- [x] `src/tasks/task-operations.ts` (~line 296-300) — replace inline replace with `toForwardSlashes()`
- [x] `src/editor/rendering/markdown-renderer.ts` (~line 259) — replace inline replace with `toForwardSlashes()`

### 4. Replace usages in coc (server-side) ✅
- [x] `src/server/pipelines-handler.ts` (line 235) — replace `resolveAndValidatePath` body with `isWithinDirectory()`
- [x] `src/server/tasks-handler.ts` (lines 88, 213, 349, 832) — replace inline `startsWith(... + path.sep)` checks with `isWithinDirectory()`
- [x] `src/server/queue-executor-bridge.ts` (~line 873) — replace inline replace with `toForwardSlashes()`

### 5. Replace usages in coc (SPA / browser) ✅
- [x] `src/server/spa/client/react/App.tsx` — replace local `normalizePath` body with `toForwardSlashes` import via subpath
- [x] `src/server/spa/client/react/hooks/useQueueActivity.ts` — same
- [x] `src/server/spa/client/react/file-path-preview.ts` — same (kept additional lowercase logic)

### 6. Replace usages in coc-server ✅
- [x] `src/repo-utils.ts` — replace `split(path.sep).join('/')` with `toForwardSlashes()`
- [x] `src/router.ts` (line 125) — replace inline security check with `isWithinDirectory()`

### 7. Verify ✅
- [x] Build passes: `npm run compile` succeeds across all packages
- [x] Tests pass: 1759 package tests pass
- [x] No remaining inline occurrences at replaced call sites

## Risk Assessment

- **Low risk**: `toForwardSlashes` is a trivial rename of an inline expression — behavior is identical.
- **Medium-low risk**: `isWithinDirectory` consolidates a security pattern. The function signature makes the intent clearer and easier to audit. One subtle difference: some call sites do `path.resolve(base)` before checking, others pass already-resolved paths. The centralized function should call `path.resolve()` internally to be safe by default.
- **SPA imports**: Already proven to work — SPA imports `pipeline-core/editor/*` modules via esbuild.
