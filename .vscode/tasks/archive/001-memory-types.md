---
status: pending
commit: 1
title: "Memory types and PipelineConfig extension"
---

# 001 — Memory types and PipelineConfig extension

## Summary

Define all memory-related TypeScript interfaces and extend `PipelineConfig` with an optional `memory` field. Add validation for the new field.

## Motivation

Types must exist before any implementation. This is the pure-data foundation that MemoryStore, MemoryCapture, and pipeline integration all depend on. No prior state exists — this is the first commit in the memory-storage-write-path feature.

## Files to create

### `packages/pipeline-core/src/memory/types.ts`

All memory interfaces, exported from a new `memory/` module (no `memory/` directory exists yet).

```ts
/** Controls where memories are stored / retrieved from */
export type MemoryLevel = 'repo' | 'system' | 'both';

/**
 * YAML-facing memory configuration.
 * Appears as `memory:` in pipeline.yaml (object form or boolean shorthand).
 */
export interface MemoryConfig {
  /** Whether to retrieve relevant memories before map/job prompts (default: true) */
  retrieve?: boolean;
  /** Whether to capture new observations after map/job execution (default: true) */
  capture?: boolean;
  /** Where to read/write memories (default: 'both') */
  level?: MemoryLevel;
}

/**
 * A single raw observation captured after a pipeline run.
 * Stored as JSON in the raw-observations directory.
 */
export interface RawObservation {
  /** Pipeline name (from PipelineConfig.name) */
  pipeline: string;
  /** ISO 8601 timestamp of capture */
  timestamp: string;
  /** Repository identifier (remote URL or path) — mirrors WorkspaceInfo.remoteUrl pattern */
  repo?: string;
  /** Model used for the AI calls */
  model?: string;
  /** Free-text facts extracted by the AI */
  facts: string[];
}

/**
 * Lightweight index stored alongside the memory store for fast lookups.
 */
export interface MemoryIndex {
  /** ISO 8601 timestamp of last aggregation pass, or null if never aggregated */
  lastAggregation: string | null;
  /** Number of raw observation files */
  rawCount: number;
  /** Number of consolidated fact entries */
  factCount: number;
  /** Category labels present in the store */
  categories: string[];
}

/**
 * Repository identity for scoping repo-level memories.
 * Follows the same id-by-path pattern as WorkspaceInfo (process-store.ts:55-66)
 * but lighter — no UI colour, no hash id.
 */
export interface RepoInfo {
  /** Absolute path to the repository root */
  path: string;
  /** Human-readable repo name (folder name or last segment of remoteUrl) */
  name: string;
  /** Git remote URL (origin) — used to match across clones, like WorkspaceInfo.remoteUrl */
  remoteUrl?: string;
  /** ISO 8601 timestamp of last access */
  lastAccessed: string;
}
```

### `packages/pipeline-core/test/memory/types.test.ts`

Vitest tests covering the `validateMemoryConfig` function that will be called from the executor.

**Test cases:**

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | boolean `true` shorthand | `memory: true` | Passes validation (shorthand is always valid) |
| 2 | boolean `false` shorthand | `memory: false` | Passes validation |
| 3 | full object form | `{ retrieve: true, capture: false, level: 'repo' }` | Passes validation unchanged |
| 4 | invalid `level` value | `{ level: 'invalid' }` | Throws `PipelineExecutionError` |
| 5 | missing `memory` field | `undefined` | No error — field is optional |
| 6 | unknown extra fields ignored | `{ retrieve: true, extra: 42 }` | Passes validation (lenient, consistent with other validators) |

> **Note:** `normalizeMemoryConfig` (which expands `true` → `{ retrieve: true, capture: true, level: 'both' }`) is defined in commit 004's `memory-integration.ts`, not here. This commit only handles validation.

## Files to modify

### `packages/pipeline-core/src/pipeline/types.ts`

Add the optional `memory` field to `PipelineConfig` (line 55-79):

```ts
import type { MemoryConfig } from '../memory/types';

// Inside PipelineConfig interface, after the `parameters` field (line 78):
/** Optional memory configuration — enables cross-run learning. Boolean shorthand or full config. */
memory?: MemoryConfig | boolean;
```

This mirrors the pattern of other optional top-level fields (`filter?`, `job?`, `parameters?`).

### `packages/pipeline-core/src/pipeline/executor.ts`

Add a `validateMemoryConfig()` call inside `validatePipelineConfig` (line 1872-1892).

The existing validation pattern is:
```ts
function validatePipelineConfig(config: PipelineConfig): void {
    if (!config.name) { throw ... }
    if (config.job && config.map) { throw ... }
    if (config.job) { validateJobConfig(config); return; }
    validateInputConfig(config);
    validateMapConfig(config);
    validateReduceConfig(config);
}
```

Add after the `validateReduceConfig` call (or before the job/map-reduce branch, since memory applies to both modes):

```ts
// Memory config is valid for both job and map-reduce modes
if (config.memory !== undefined) {
    validateMemoryConfig(config);
}
```

The `validateMemoryConfig` function itself (new, at bottom of file alongside other validators ~line 1860+):

```ts
function validateMemoryConfig(config: PipelineConfig): void {
    if (typeof config.memory === 'boolean') {
        return; // shorthand is always valid
    }
    if (typeof config.memory !== 'object' || config.memory === null) {
        throw new PipelineExecutionError('Pipeline "memory" must be a boolean or an object');
    }
    const validLevels: string[] = ['repo', 'system', 'both'];
    if (config.memory.level !== undefined && !validLevels.includes(config.memory.level)) {
        throw new PipelineExecutionError(
            `Invalid memory level "${config.memory.level}". Must be one of: ${validLevels.join(', ')}`
        );
    }
}
```

This follows the same throw-on-invalid, ignore-unknown-fields pattern used by `validateInputConfig` (line 1783-1855) and `validateJobConfig` (line 1860-1867).

## Validation rules

| Rule | Rationale |
|------|-----------|
| `memory: true` → `{ retrieve: true, capture: true, level: 'both' }` | Convenient shorthand, same pattern as many YAML tools |
| `memory: false` → disabled entirely | Explicit opt-out |
| Object form: validate `level` ∈ `{'repo','system','both'}` | Catch typos early |
| Unknown fields silently ignored | Consistent with `validateInputConfig` which doesn't reject unknown keys |
| `memory` field entirely optional | Backward-compatible — existing pipelines unaffected |

## Acceptance criteria

- [ ] `packages/pipeline-core/src/memory/types.ts` exists and exports `MemoryLevel`, `MemoryConfig`, `RawObservation`, `MemoryIndex`, `RepoInfo`
- [ ] `PipelineConfig` in `types.ts` has `memory?: MemoryConfig | boolean`
- [ ] `validatePipelineConfig` in `executor.ts` calls `validateMemoryConfig` when `memory` is present
- [ ] `validateMemoryConfig` rejects invalid `level` values with `PipelineExecutionError`
- [ ] `validateMemoryConfig` accepts boolean shorthand, valid object form, and `undefined`
- [ ] Test file `packages/pipeline-core/test/memory/types.test.ts` covers all 6 test cases above
- [ ] `npm run build` passes
- [ ] `npm run test:run` passes in `packages/pipeline-core/`

## Dependencies

None — this is the first commit in the series.
