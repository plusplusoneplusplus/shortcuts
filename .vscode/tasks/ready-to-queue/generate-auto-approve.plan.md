# Plan: Make `generate` Input Review Step Optional

## Problem

Pipelines with `input.generate` always throw at validation time in `executePipeline()` — the only execution path is through the VS Code Preview UI which forces human review. This makes `generate` pipelines unusable from the CLI (`coc run`) and the server queue.

## Approach

Add an optional `autoApprove: true` field to `GenerateInputConfig` in the YAML schema. When set, the executor generates items via AI and feeds them directly into the map phase — no human review needed.

The VS Code Preview path remains the default when `autoApprove` is absent or `false`.

### Example YAML

```yaml
input:
  generate:
    prompt: "Generate 10 edge-case test inputs for a URL parser"
    schema: [url, expectedHost, expectedPath]
    autoApprove: true        # ← new field; skip interactive review
```

## Todos

### 1. Extend `GenerateInputConfig` type
**File:** `packages/pipeline-core/src/pipeline/types.ts`
- Add `autoApprove?: boolean` to `GenerateInputConfig` (line ~141)
- No change to `isGenerateConfig` guard (it only checks `prompt` + `schema`)

### 2. Update `validateGenerateConfig`
**File:** `packages/pipeline-core/src/pipeline/input-generator.ts`
- Accept `autoApprove` as a valid optional boolean field (currently only validates `prompt` and `schema`)
- No new validation errors needed — it's a simple boolean toggle

### 3. Remove the unconditional throw in `validateInputConfig`
**File:** `packages/pipeline-core/src/pipeline/executor.ts` (lines 1926–1941)
- Keep the `isGenerateConfig` + `validateGenerateConfig` checks
- Only throw the "requires interactive approval" error when `autoApprove` is NOT `true`
- When `autoApprove: true`, pass validation successfully

### 4. Add `generate` branch to `loadInputItems`
**File:** `packages/pipeline-core/src/pipeline/executor.ts` (lines 732–764)
- After the `from` branch, add handling for `config.input.generate`:
  - Call `generateInputItems(config.input.generate, aiInvoker)` from `input-generator.ts`
  - On success, return the generated items directly
  - On failure, throw `PipelineExecutionError`
- This requires `aiInvoker` to be passed into `loadInputItems`. Currently it only receives `(config, pipelineDirectory)`. Change signature to also accept `aiInvoker: AIInvoker`.
- Thread `aiInvoker` down from the call site in `executePipeline`.

### 5. Thread `aiInvoker` through `executePipeline` → `loadInputItems`
**File:** `packages/pipeline-core/src/pipeline/executor.ts`
- `executePipeline` already receives `options.aiInvoker`
- Pass it to `loadInputItems(config, pipelineDirectory, options.aiInvoker)`
- `loadInputItems` only uses `aiInvoker` when `generate` is present

### 6. Update YAML schema docs
**File:** `packages/pipeline-core/resources/bundled-skills/pipeline-generator/references/schema.md`
- Document `autoApprove` field under `input.generate`

### 7. Add tests for the new flow
**File:** `packages/pipeline-core/test/pipeline/executor.test.ts` (or adjacent)
- Test: `generate` with `autoApprove: true` executes without throwing
- Test: `generate` without `autoApprove` still throws the interactive approval error
- Test: `generate` with `autoApprove: false` still throws
- Test: generated items flow through to map phase correctly
- Test: generation failure produces a clear `PipelineExecutionError`

**File:** `packages/pipeline-core/test/pipeline/input-generator.test.ts`
- Test: `validateGenerateConfig` accepts `autoApprove: true/false` without errors

### 8. Verify CLI and queue paths work
- `coc run` calls `executePipeline` → now works when YAML has `autoApprove: true`
- Queue executor bridge calls `executePipeline` → same
- No changes needed in `coc` or `coc-server` packages — it "just works" once `pipeline-core` is updated

## Notes

- The VS Code Preview UI path (`executePipelineWithItems`) is unaffected — it bypasses validation entirely
- `autoApprove` is YAML-level only; no new CLI flags needed (`--approve-permissions` is unrelated — that's for MCP tool permissions)
- The `limit` field on `InputConfig` already applies to items after loading, so it will naturally cap generated items too
