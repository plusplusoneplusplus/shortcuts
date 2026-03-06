---
status: pending
commit: "002"
title: "pipeline-core: export templates module"
depends_on: ["001"]
---

# Commit 002 — pipeline-core: export templates module

## Summary

Wire the new `src/templates/` module (created in commit 001) into `pipeline-core`'s public API so consumers can import template symbols via the main barrel export and via a dedicated subpath export.

## Prior State (from commit 001)

- `packages/pipeline-core/src/templates/` exists with:
  - `types.ts` — `Template`, `CommitTemplate`, `ReplicateOptions`, `FileChange`, `ReplicateResult`
  - `prompt-builder.ts` — `buildReplicatePrompt`
  - `result-parser.ts` — `parseReplicateResponse`
  - `replicate-service.ts` — `ReplicateService`
  - `index.ts` — re-exports all public symbols from the above files

## Files to Modify

### 1. `packages/pipeline-core/src/index.ts`

Add a labeled export block for the templates module, following the existing section pattern (banner comment + grouped exports). Insert it after the Skills block (the last current section, ending around line 1059).

```typescript
// ============================================================================
// Templates
// ============================================================================

export {
    // Types
    Template,
    CommitTemplate,
    ReplicateOptions,
    FileChange,
    ReplicateResult,
    // Service
    ReplicateService,
    // Prompt builder
    buildReplicatePrompt,
    // Result parser
    parseReplicateResponse,
} from './templates';
```

**Pattern reference:** Follow the exact style of existing blocks (e.g., the Git block at lines 787–818 or the Memory block at lines 996–1031). Use `// ====...====` banner, sub-group comments, and `export { ... } from './templates';` syntax.

### 2. `packages/pipeline-core/src/templates/index.ts`

**Verify only** — no changes expected. Confirm it re-exports all eight public symbols:
- Types: `Template`, `CommitTemplate`, `ReplicateOptions`, `FileChange`, `ReplicateResult`
- Service: `ReplicateService`
- Functions: `buildReplicatePrompt`, `parseReplicateResponse`

If any symbol is missing, add the missing re-export.

### 3. `packages/pipeline-core/package.json`

Add the subpath export entry in the `"exports"` map and the corresponding `typesVersions` entry.

#### `exports` (add after the `"./memory"` line):

```jsonc
"./templates": "./dist/templates/index.js"
```

The full `exports` block should look like (showing only the tail):
```json
"./memory": "./dist/memory/index.js",
"./templates": "./dist/templates/index.js"
```

#### `typesVersions` (add after the `"memory"` entry):

```jsonc
"templates": ["dist/templates/index.d.ts"]
```

The full `typesVersions.*` block should look like (showing only the tail):
```json
"memory": ["dist/memory/index.d.ts"],
"templates": ["dist/templates/index.d.ts"]
```

## Implementation Steps

1. Open `packages/pipeline-core/src/index.ts`.
2. Append the Templates export block after the Skills section.
3. Open `packages/pipeline-core/src/templates/index.ts` and verify all eight symbols are exported.
4. Open `packages/pipeline-core/package.json`.
5. Add `"./templates": "./dist/templates/index.js"` to `exports`.
6. Add `"templates": ["dist/templates/index.d.ts"]` to `typesVersions.*`.
7. Build and verify.

## Acceptance Criteria

1. **Build succeeds:** `cd packages/pipeline-core && npm run build` exits with code 0. No TypeScript errors.
2. **Main barrel import works:** The following compiles without error:
   ```typescript
   import {
       Template,
       CommitTemplate,
       ReplicateOptions,
       FileChange,
       ReplicateResult,
       ReplicateService,
       buildReplicatePrompt,
       parseReplicateResponse,
   } from '@plusplusoneplusplus/pipeline-core';
   ```
3. **Subpath import works:** The following compiles without error:
   ```typescript
   import {
       Template,
       CommitTemplate,
       ReplicateOptions,
       FileChange,
       ReplicateResult,
       ReplicateService,
       buildReplicatePrompt,
       parseReplicateResponse,
   } from '@plusplusoneplusplus/pipeline-core/templates';
   ```
4. **No regressions:** `cd packages/pipeline-core && npm run test:run` passes with no new failures.
5. **Existing exports unaffected:** No existing export is removed or renamed.
6. **Declaration files generated:** `dist/templates/index.d.ts` exists after build and contains the expected type exports.

## Commit Message

```
feat(pipeline-core): export templates module

Wire src/templates/ into the public API:
- Add labeled export block in src/index.ts
- Add subpath export ./templates in package.json
- Add typesVersions entry for templates

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Risks & Notes

- **Zero runtime risk** — this commit only adds re-exports; no logic changes.
- If commit 001's `index.ts` barrel doesn't exist yet, this commit will fail to build. Ensure 001 is applied first.
- The subpath export uses the same `./dist/...` pattern as every other subpath in the package.
