---
status: pending
---

# 004: Pipeline-Core Exports Wiring

## Summary
Wire up the memory module in pipeline-core's public API by adding re-exports to `index.ts` and a `"./memory"` subpath export to `package.json`, so consumers can import via `@plusplusoneplusplus/pipeline-core/memory` or the main entry point.

## Motivation
Separate from the implementation commits (001–003) because this is mechanical wiring that should be verified with a clean build. Keeps the public-API surface change in its own reviewable unit.

## Changes

### Files to Create
- (none)

### Files to Modify

- `packages/pipeline-core/src/index.ts` — Append a new `// Memory` section at the bottom, re-exporting from `'./memory'`. Follow the existing pattern of a section-header comment + named `export { … } from './memory'` block. Export at minimum:
  ```ts
  // ============================================================================
  // Memory
  // ============================================================================

  export {
      // Types
      MemoryLevel,
      RawObservation,
      ConsolidatedMemory,
      MemoryIndex,
      MemoryIndexEntry,
      RepoInfo,
      MemoryStats,
      MemoryLevelStats,
      // Store
      MemoryStore,
  } from './memory';
  ```
  The exact list must match whatever `packages/pipeline-core/src/memory/index.ts` publicly exports (created in commits 001–003).

- `packages/pipeline-core/package.json` — Two additions:
  1. In `"exports"`, add `"./memory": "./dist/memory/index.js"` (same simple string form used by `./git`, `./ai`, etc.).
  2. In `"typesVersions"` → `"*"`, add `"memory": ["dist/memory/index.d.ts"]` (same pattern as `"ai"`, `"git"`, etc.).

### Files to Delete
- (none)

## Implementation Notes

**index.ts pattern** — every existing section uses:
```
// ====…====
// <Name>
// ====…====

export { … } from './<module>';
```
The 78-char `=` ruler is the convention (see lines 31–33 of `index.ts`).

**package.json `exports` pattern** — simple string values pointing at the compiled JS, e.g.:
```json
"./memory": "./dist/memory/index.js"
```
No `{ types, import, require }` conditional-export object — the codebase uses the flat form plus a `typesVersions` fallback for type resolution.

**package.json `typesVersions` pattern**:
```json
"memory": ["dist/memory/index.d.ts"]
```

**tsconfig.json** — no changes needed. The `"include": ["src/**/*"]` glob already covers `src/memory/**`. No path mappings exist.

## Tests
- No new test files. Verification is:
  1. `npm run build` succeeds from repo root (compiles `memory/` and the new re-exports)
  2. Manually confirm `dist/memory/index.js` and `dist/memory/index.d.ts` exist after build
  3. Existing tests from commits 002–003 continue to pass (`cd packages/pipeline-core && npm run test:run`)

## Acceptance Criteria
- [ ] `packages/pipeline-core/src/index.ts` has a `// Memory` section with re-exports from `'./memory'`
- [ ] `packages/pipeline-core/package.json` `exports` contains `"./memory": "./dist/memory/index.js"`
- [ ] `packages/pipeline-core/package.json` `typesVersions["*"]` contains `"memory": ["dist/memory/index.d.ts"]`
- [ ] `import { MemoryStore } from '@plusplusoneplusplus/pipeline-core'` resolves (main entry)
- [ ] `import { MemoryStore } from '@plusplusoneplusplus/pipeline-core/memory'` resolves (subpath)
- [ ] `npm run build` succeeds with no errors
- [ ] No regressions in existing pipeline-core tests

## Dependencies
- Depends on: 001, 002, 003

## Assumed Prior State
- `packages/pipeline-core/src/memory/types.ts` exists with all memory types (`MemoryLevel`, `RawObservation`, `ConsolidatedMemory`, `MemoryIndex`, `MemoryIndexEntry`, `RepoInfo`, `MemoryStats`, `MemoryLevelStats`)
- `packages/pipeline-core/src/memory/memory-store.ts` exists with the `MemoryStore` class (path resolution, repo hashing, raw observation CRUD, consolidated memory read/write, index management, repo-info, clear/archive, stats)
- `packages/pipeline-core/src/memory/index.ts` exists and re-exports all public types and `MemoryStore`
- Test files exist under `packages/pipeline-core/test/memory/`
