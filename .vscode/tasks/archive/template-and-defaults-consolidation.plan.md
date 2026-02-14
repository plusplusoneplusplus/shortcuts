# Template & Defaults Consolidation Refactoring

## Problem Statement

The codebase has three categories of duplication that impact maintainability:

1. **Template variable substitution** — The `{{variable}}` replacement logic using `/\{\{(\w+)\}\}/g` is implemented in 3 files with slight variations
2. **Model template substitution** — Identical `config.map.model.replace(...)` logic appears twice in executor.ts (batch vs retry paths)
3. **Scattered defaults** — 30+ DEFAULT_* constants spread across 10+ files reduce discoverability

## Proposed Approach

Extract shared utilities and consolidate defaults into centralized modules within `packages/pipeline-core`.

---

## Work Plan

### 1. Template Variable Substitution Consolidation

- [x] **1.1** Create `packages/pipeline-core/src/utils/template-engine.ts` with:
  - Shared `TEMPLATE_VARIABLE_REGEX = /\{\{(\w+)\}\}/g`
  - `substituteVariables(template: string, variables: Record<string, unknown>, options?: SubstituteOptions): string`
  - `extractVariables(template: string): string[]`
  - Support for strict mode (throw on missing) vs lenient mode (leave as-is)
  - Support for special system variables (`ITEMS`, `RESULTS`, `COUNT`, etc.)

- [x] **1.2** Refactor `packages/pipeline-core/src/pipeline/template.ts`:
  - Import from new `template-engine.ts`
  - Keep pipeline-specific logic (special variable handling) but delegate core substitution
  - Update `substituteTemplate()` to use shared engine

- [x] **1.3** Refactor `packages/pipeline-core/src/map-reduce/prompt-template.ts`:
  - Import shared regex and `extractVariables()` from template-engine
  - Replace inline regex with shared implementation
  - Keep `PromptTemplate` class structure intact

- [x] **1.4** Refactor `packages/pipeline-core/src/ai/prompt-builder.ts`:
  - Import `substituteVariables()` from template-engine
  - Replace individual `.replace()` calls with single substitution call
  - Map context properties to variables object

- [x] **1.5** Export `template-engine` from package index and add tests

### 2. Model Template Substitution Extraction

- [x] **2.1** Extract helper function in `executor.ts`:
  ```typescript
  function substituteModelTemplate(
    modelTemplate: string | undefined,
    item: Record<string, unknown>
  ): string | undefined
  ```

- [x] **2.2** Replace both occurrences (lines ~578-582 and ~635-640) with helper call

- [x] **2.3** Add unit test for the helper function

### 3. Centralized Defaults

- [x] **3.1** Create `packages/pipeline-core/src/config/defaults.ts` with sections:
  ```typescript
  // === Concurrency & Parallelism ===
  export const DEFAULT_PARALLEL_LIMIT = 5;
  export const DEFAULT_MAX_CONCURRENCY = 5;
  
  // === Timeouts ===
  export const DEFAULT_AI_TIMEOUT_MS = 30 * 60 * 1000;
  export const DEFAULT_POLL_INTERVAL_MS = 5000;
  
  // === Chunking ===
  export const DEFAULT_CHUNK_OPTIONS = { ... };
  
  // === Queue & Task Execution ===
  export const DEFAULT_TASK_CONFIG = { ... };
  export const DEFAULT_EXECUTOR_OPTIONS = { ... };
  export const DEFAULT_QUEUE_MANAGER_OPTIONS = { ... };
  
  // === Map-Reduce ===
  export const DEFAULT_MAP_REDUCE_OPTIONS = { ... };
  
  // === CSV ===
  export const DEFAULT_CSV_OPTIONS = { ... };
  ```

- [x] **3.2** Update imports in source files:
  - `pipeline/executor.ts` → import `DEFAULT_PARALLEL_LIMIT`
  - `map-reduce/concurrency-limiter.ts` → import `DEFAULT_MAX_CONCURRENCY`
  - `ai/timeouts.ts` → re-export from defaults or remove file
  - `map-reduce/splitters/chunk-splitter.ts` → import `DEFAULT_CHUNK_OPTIONS`
  - `queue/types.ts` → import queue-related defaults
  - `map-reduce/types.ts` → import `DEFAULT_MAP_REDUCE_OPTIONS`
  - `pipeline/csv-reader.ts` → import `DEFAULT_CSV_OPTIONS`

- [x] **3.3** Export defaults from package index for external consumers

- [x] **3.4** Keep VS Code extension defaults (`src/shortcuts/`) separate (they're domain-specific)

### 4. Verification

- [x] **4.1** Run all pipeline-core tests: `cd packages/pipeline-core && npm run test:run`
- [x] **4.2** Run extension tests: `npm test`
- [x] **4.3** Verify build: `npm run compile`

---

## Files Affected

### New Files
- `packages/pipeline-core/src/utils/template-engine.ts`
- `packages/pipeline-core/src/config/defaults.ts`

### Modified Files
- `packages/pipeline-core/src/pipeline/template.ts`
- `packages/pipeline-core/src/pipeline/executor.ts`
- `packages/pipeline-core/src/pipeline/csv-reader.ts`
- `packages/pipeline-core/src/map-reduce/prompt-template.ts`
- `packages/pipeline-core/src/map-reduce/types.ts`
- `packages/pipeline-core/src/map-reduce/concurrency-limiter.ts`
- `packages/pipeline-core/src/map-reduce/splitters/chunk-splitter.ts`
- `packages/pipeline-core/src/ai/prompt-builder.ts`
- `packages/pipeline-core/src/ai/timeouts.ts`
- `packages/pipeline-core/src/queue/types.ts`
- `packages/pipeline-core/src/index.ts` (exports)

---

## Notes

- **Backward Compatibility**: All changes are internal refactoring; public API remains unchanged
- **Dependency Direction**: `config/defaults.ts` has no internal dependencies (leaf module)
- **Extension Defaults**: VS Code extension defaults in `src/shortcuts/` are intentionally kept separate as they're UI/workspace-specific
- **Testing Strategy**: Rely on existing tests; add targeted tests only for new `template-engine.ts` utility
