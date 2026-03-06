# Plan: Make `generate` Input Review Step Optional via `autoApprove`

## Problem

Pipelines with `input.generate` always throw at validation time in `executePipeline()` (executor.ts:1937). The only execution path today is through the VS Code Preview UI, which forces human review of AI-generated items. This makes `generate` pipelines unusable from:
- CLI (`coc run`) — calls `executePipeline()` → hits the throw
- Server queue — `CLITaskExecutor.executePipelineTask()` calls `executePipeline()` → same throw

## Approach

Add `autoApprove?: boolean` to `GenerateInputConfig`. When `true`, the executor:
1. Generates items via AI (calling `generateInputItems()`)
2. Feeds ALL generated items directly into the map phase — no human review

When `autoApprove` is absent or `false`, the existing throw is preserved (VS Code Preview required).

### Example YAML

```yaml
input:
  generate:
    prompt: "Generate 10 edge-case test inputs for a URL parser"
    schema: [url, expectedHost, expectedPath]
    autoApprove: true   # skip interactive review, execute immediately
```

---

## Todos (8 tasks, dependency-ordered)

### 1. `extend-type` — Add `autoApprove` to `GenerateInputConfig`

**File:** `packages/pipeline-core/src/pipeline/types.ts` (lines 126–142)

```diff
 export interface GenerateInputConfig {
     prompt: string;
     schema: string[];
     model?: string;
+    /**
+     * When true, generated items are fed directly into the map phase
+     * without interactive review. Default: false (requires Preview UI).
+     */
+    autoApprove?: boolean;
 }
```

Also update the `InputConfig.generate` JSDoc (line 207) to mention `autoApprove`:
```diff
-     * The user will be able to review and edit generated items before execution.
+     * By default, the user reviews generated items before execution.
+     * Set `autoApprove: true` to skip review and execute immediately.
```

No change to `isGenerateConfig` — it only checks `prompt` + `schema`.

---

### 2. `update-validate` — Accept `autoApprove` in `validateGenerateConfig`

**File:** `packages/pipeline-core/src/pipeline/input-generator.ts` (lines 259–300)

Currently validates `prompt` and `schema` only. Add validation that `autoApprove`, if present, is a boolean:

```diff
     // After schema duplicate check (line 295):
+
+    // Validate autoApprove if present
+    if ('autoApprove' in config && typeof config.autoApprove !== 'boolean') {
+        errors.push('"autoApprove" must be a boolean');
+    }
```

---

### 3. `remove-throw` — Make the throw conditional on `autoApprove`
**Depends on:** `extend-type`

**File:** `packages/pipeline-core/src/pipeline/executor.ts` (lines 1926–1941)

Replace the unconditional throw with a conditional:

```diff
     // Validate generate config if present
     if (hasGenerate) {
         if (!isGenerateConfig(config.input.generate)) {
             throw new PipelineExecutionError('Invalid generate configuration');
         }
         const validation = validateGenerateConfig(config.input.generate);
         if (!validation.valid) {
             throw new PipelineExecutionError(
                 `Invalid generate configuration: ${validation.errors.join('; ')}`
             );
         }
-        throw new PipelineExecutionError(
-            'Pipelines with "generate" input require interactive approval. Use the Pipeline Preview to generate and approve items first.',
-            'input'
-        );
+        if (!config.input.generate.autoApprove) {
+            throw new PipelineExecutionError(
+                'Pipelines with "generate" input require interactive approval. Use the Pipeline Preview to generate and approve items first, or set "autoApprove: true" in the generate config.',
+                'input'
+            );
+        }
     }
```

---

### 4. `add-generate-branch` — Add `generate` branch to `loadInputItems`
**Depends on:** `extend-type`

**File:** `packages/pipeline-core/src/pipeline/executor.ts` (lines 732–764)

Current signature: `async function loadInputItems(config: MapReducePipelineConfig, pipelineDirectory: string): Promise<PromptItem[]>`

Add a third parameter and a new branch:

```diff
-async function loadInputItems(config: MapReducePipelineConfig, pipelineDirectory: string): Promise<PromptItem[]> {
+async function loadInputItems(config: MapReducePipelineConfig, pipelineDirectory: string, aiInvoker?: AIInvoker): Promise<PromptItem[]> {
     try {
         if (config.input.items) {
             return config.input.items;
         }
         
         if (config.input.from) {
             // ... existing CSV / array handling unchanged ...
         }
-        
-        throw new PipelineExecutionError('Input must have either "items" or "from"', 'input');
+
+        if (config.input.generate && config.input.generate.autoApprove) {
+            if (!aiInvoker) {
+                throw new PipelineExecutionError('AI invoker is required for generate input', 'input');
+            }
+            const result = await generateInputItems(config.input.generate, aiInvoker);
+            if (!result.success || !result.items) {
+                throw new PipelineExecutionError(
+                    `Failed to generate input items: ${result.error || 'unknown error'}`,
+                    'input'
+                );
+            }
+            return result.items;
+        }
+
+        throw new PipelineExecutionError('Input must have one of "items", "from", or "generate" with autoApprove', 'input');
     } catch (error) {
```

Add import at the top of executor.ts (near line 39):
```diff
-import { validateGenerateConfig } from './input-generator';
+import { validateGenerateConfig, generateInputItems } from './input-generator';
```

---

### 5. `thread-invoker` — Pass `aiInvoker` from `executePipeline` to `loadInputItems`
**Depends on:** `add-generate-branch`

**File:** `packages/pipeline-core/src/pipeline/executor.ts` (line 224)

```diff
-        items = await loadInputItems(mrConfig, options.pipelineDirectory);
+        items = await loadInputItems(mrConfig, options.pipelineDirectory, options.aiInvoker);
```

Single-line change. `options.aiInvoker` is already a required field on `ExecutePipelineOptions` (line 83).

---

### 6. `update-schema-docs` — Document `autoApprove` in YAML schema reference
**Depends on:** `extend-type`

**File:** `packages/pipeline-core/resources/bundled-skills/pipeline-generator/references/schema.md`

In the `input.generate` section (around line 97):

```diff
 ### Option 4: AI-Generated
 input:
   generate:
     prompt: string              # Generation instruction
     schema: string[]            # Field names (valid identifiers)
     model?: string              # Optional, defaults to system default
+    autoApprove?: boolean       # When true, skip review and execute immediately (default: false)
```

---

### 7. `add-tests` — Add tests for the new auto-approve flow
**Depends on:** `thread-invoker`, `remove-throw`, `update-validate`

#### 7a. Executor tests (`packages/pipeline-core/test/pipeline/executor.test.ts`)

Add a new `describe('generate with autoApprove')` block with these cases:

| Test | What it verifies |
|------|-----------------|
| `autoApprove: true` generates and executes | Mock `aiInvoker` to return items; verify pipeline completes with map results |
| `autoApprove: false` throws interactive approval error | Existing behavior preserved |
| `autoApprove` absent throws interactive approval error | Existing behavior preserved |
| generation failure produces PipelineExecutionError | Mock `aiInvoker` to return `{ success: false, error: '...' }`; verify error message |
| generated items respect `limit` | Set `limit: 2` with 5 generated items; verify only 2 are processed |
| generated items receive `parameters` | Set `parameters`; verify they're merged into generated items |

#### 7b. Input-generator tests (`packages/pipeline-core/test/pipeline/input-generator.test.ts`)

| Test | What it verifies |
|------|-----------------|
| `validateGenerateConfig` accepts `autoApprove: true` | No errors returned |
| `validateGenerateConfig` accepts `autoApprove: false` | No errors returned |
| `validateGenerateConfig` rejects `autoApprove: "yes"` | Error: `"autoApprove" must be a boolean` |

---

### 8. `verify-cli-queue` — Verify CLI and queue paths
**Depends on:** `add-tests`

No code changes needed. Verification steps:

1. **CLI path:** `coc run` → calls `executePipeline()` → now reaches `loadInputItems()` generate branch → works
2. **Queue path:** `CLITaskExecutor.executePipelineTask()` → calls `executePipeline()` → same
3. **VS Code Preview path:** `executePipelineWithItems()` → still bypasses validation entirely → unaffected

Manual smoke test: create a pipeline YAML with `autoApprove: true` and run via `coc run <path>`.

---

## Files Changed (summary)

| File | Change |
|------|--------|
| `packages/pipeline-core/src/pipeline/types.ts` | Add `autoApprove?: boolean` to `GenerateInputConfig`, update JSDoc |
| `packages/pipeline-core/src/pipeline/input-generator.ts` | Validate `autoApprove` type in `validateGenerateConfig` |
| `packages/pipeline-core/src/pipeline/executor.ts` | Conditional throw, generate branch in `loadInputItems`, thread `aiInvoker`, add import |
| `packages/pipeline-core/resources/.../schema.md` | Document `autoApprove` field |
| `packages/pipeline-core/test/pipeline/executor.test.ts` | 6 new test cases |
| `packages/pipeline-core/test/pipeline/input-generator.test.ts` | 3 new test cases |

## Notes

- Zero changes needed in `packages/coc/` or `packages/coc-server/` — they call `executePipeline()` which handles everything
- The VS Code extension's Preview UI path (`executePipelineWithItems`) is completely unaffected
- `input.limit` naturally caps generated items (applied in `prepareItems` after loading)
- `autoApprove` is YAML-level only; no new CLI flags needed (`--approve-permissions` is for MCP tool permissions, unrelated)
- The error message for non-autoApprove pipelines is updated to mention the `autoApprove` option as a hint
