---
status: pending
priority: high
depends_on:
  - 001-config-location
  - 002-file-process-store-wired
---

# 005 — Persist `coc run` pipeline results to process store

## Problem

Currently `coc run` outputs results to stdout or a file only. There is no record written to the `FileProcessStore`, so CLI pipeline runs never appear in the dashboard process history. All AI work should be tracked in one place regardless of whether it was triggered from VS Code or the CLI.

## Solution

Wire `FileProcessStore` into the `coc run` command so that every pipeline execution is persisted as an `AIProcess` entry. Add a `--persist` / `--no-persist` CLI flag (default: `true`) and a matching `persist` config key so users can opt out.

## Changes

### 1. `packages/coc/src/commands/run.ts`

**Import `FileProcessStore` and `AIProcess` types:**

```ts
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { AIProcess } from '@plusplusoneplusplus/pipeline-core';
```

**Extend `RunCommandOptions`:**

Add a `persist` boolean field (default `true`):

```ts
export interface RunCommandOptions {
    // ... existing fields ...
    /** Save run results to the process store (default: true) */
    persist: boolean;
}
```

**After pipeline execution in `executeRun()`:**

After `handleResults()` returns and before the function exits, build and save a process entry when `options.persist` is `true`:

```ts
const endTime = new Date();
if (options.persist) {
    const process: AIProcess = {
        id: `cli-pipeline-${Date.now()}`,
        type: 'pipeline-execution',
        promptPreview: config.name,
        fullPrompt: yamlPath,
        status: exitCode === 0 ? 'completed' : 'failed',
        startTime: new Date(startTime),
        endTime,
        result: formatted,          // or a truncated summary
        metadata: {
            type: 'cli-pipeline',
            pipelineName: config.name,
            itemCount: result.executionStats.totalItems,
            successCount: result.executionStats.successfulMaps,
            failCount: result.executionStats.failedMaps,
        },
    };
    const store = new FileProcessStore({
        dataDir: resolvedConfig.serve?.dataDir,  // from resolved config
    });
    await store.addProcess(process);
}
```

Key points:
- Capture `startTime` (already exists as `Date.now()` on line 188) and `endTime` after execution completes.
- `status` is `'completed'` when exit code is 0, `'failed'` otherwise.
- `result` holds the formatted output string (or a summary to avoid storing megabytes).
- The `metadata` object uses `type: 'cli-pipeline'` to distinguish CLI-originated runs from VS Code–originated ones.
- `dataDir` comes from the resolved config's `serve.dataDir` (defaults to `~/.coc`).
- Persistence errors should be caught and logged to stderr — never fail the run command itself.

**Wire the `--persist` flag in the Commander definition** (in the file that registers the `run` sub-command):

```
.option('--no-persist', 'Do not save run results to process store')
```

Commander auto-creates a `persist` boolean that defaults to `true` and becomes `false` when `--no-persist` is passed.

### 2. `packages/coc/src/config.ts`

**Add `persist` to `CLIConfig`:**

```ts
export interface CLIConfig {
    // ... existing fields ...
    /** Save CLI run results to process store (default: true) */
    persist?: boolean;
}
```

**Add `persist` to `ResolvedCLIConfig`:**

```ts
export interface ResolvedCLIConfig {
    // ... existing fields ...
    persist: boolean;
}
```

**Update `DEFAULT_CONFIG`:**

```ts
export const DEFAULT_CONFIG: ResolvedCLIConfig = {
    // ... existing fields ...
    persist: true,
};
```

**Update `validateConfig()`** — add a boolean check:

```ts
if (typeof raw.persist === 'boolean') {
    result.persist = raw.persist;
}
```

**Update `mergeConfig()`** — merge the field:

```ts
persist: override.persist ?? base.persist,
```

### 3. Config file support (`~/.coc.yaml`)

Users can set the default:

```yaml
persist: true   # Save CLI run results to process store (default)
# persist: false  # Disable persistence globally
```

The `--no-persist` CLI flag always takes precedence over the config file value.

## Precedence

1. `--no-persist` CLI flag → always wins
2. `persist` in `~/.coc.yaml` → default when flag not provided
3. Hard-coded default → `true`

## Tests

All tests in `packages/coc/test/`. Use Vitest (`npm run test:run`).

### Test: `coc run` creates process entry in store

- Set up a temp `dataDir`, execute a pipeline with `persist: true`.
- Read `processes.json` from the temp dir and assert one entry exists.
- Assert `entry.type === 'pipeline-execution'`.

### Test: `--no-persist` flag skips store write

- Execute with `persist: false`.
- Assert `processes.json` does not exist or is empty.

### Test: process entry has correct metadata

- Execute a pipeline, read the stored entry.
- Assert: `metadata.type === 'cli-pipeline'`, `metadata.pipelineName` matches `config.name`, `metadata.itemCount` matches `executionStats.totalItems`.
- Assert `startTime < endTime`, `status === 'completed'`.

### Test: config `persist: false` disables by default

- Write a temp config with `persist: false`, resolve config, confirm `resolvedConfig.persist === false`.
- Ensure the run command respects it (no store write).

### Test: persistence failure does not break run output

- Mock `FileProcessStore.addProcess` to throw.
- Assert `executeRun` still returns 0 and stdout output is correct.

## Acceptance Criteria

- [ ] CLI pipeline runs appear in dashboard process history (`processes.json`).
- [ ] `--no-persist` flag disables persistence.
- [ ] Process entry includes pipeline name, item count, timing, and status.
- [ ] No impact on stdout output — existing behavior unchanged.
- [ ] Persistence errors are caught and logged, never crash the CLI.
- [ ] Config file `persist: false` disables persistence by default.
