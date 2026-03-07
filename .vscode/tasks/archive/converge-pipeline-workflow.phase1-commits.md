# Phase 1 — Detailed Commit Plan

Six atomic commits, ordered by dependency. Each builds on the previous.

---

## Commit 1: `feat(workflow): add toolCallCache and workingDirectory to WorkflowSettings`

Smallest change first — extend `WorkflowSettings` and wire the new fields through to node executors.

### Files changed

**`packages/pipeline-core/src/workflow/types.ts`**
```diff
 interface WorkflowSettings {
     model?: string;
     concurrency?: number;
     timeoutMs?: number;
     onError?: 'abort' | 'warn';
+    /** Enable tool-call caching for AI nodes. */
+    toolCallCache?: boolean;
+    /** Default working directory for AI invocations and script nodes. */
+    workingDirectory?: string;
 }
```

**`packages/pipeline-core/src/workflow/executor.ts`**
- In `executeNode()`, when calling `executeMap`/`executeAI`/`executeReduce`/`executeScript`, the `ctx.options` bag is already passed through, so no dispatch changes needed.
- In `executeWorkflow()`, merge `config.settings.workingDirectory` into `options` if not already set by the caller:
```diff
 export async function executeWorkflow(config, options) {
     validate(config);
+    // Apply settings defaults to options
+    const effectiveOptions = applySettingsDefaults(config.settings, options);
     const graph = buildGraph(config.nodes);
     const tiers = schedule(graph);
-    const ctx = { config, options, results: new Map(), tiers, startTime: Date.now() };
+    const ctx = { config, options: effectiveOptions, results: new Map(), tiers, startTime: Date.now() };
```
- Add helper:
```ts
function applySettingsDefaults(
    settings: WorkflowSettings | undefined,
    options: WorkflowExecutionOptions
): WorkflowExecutionOptions {
    if (!settings) return options;
    return {
        ...options,
        model: options.model ?? settings.model,
        concurrency: options.concurrency ?? settings.concurrency,
        timeoutMs: options.timeoutMs ?? settings.timeoutMs,
        workingDirectory: options.workingDirectory ?? settings.workingDirectory,
    };
}
```

**`packages/pipeline-core/src/workflow/types.ts`** (WorkflowExecutionOptions)
```diff
 interface WorkflowExecutionOptions {
     aiInvoker?: AIInvoker;
     processTracker?: ProcessTracker;
     workflowDirectory?: string;
     workspaceRoot?: string;
+    /** Working directory for AI invocations. Falls back to workflowDirectory. */
+    workingDirectory?: string;
     model?: string;
     concurrency?: number;
     timeoutMs?: number;
     signal?: AbortSignal;
     onProgress?: (nodeId: string, event: 'start' | 'complete' | 'warn') => void;
 }
```

**`packages/pipeline-core/src/workflow/nodes/map.ts`**
- Pass `workingDirectory` to `aiInvoker` calls:
```diff
 const result = await options.aiInvoker!(prompt, {
     model:     config.model     ?? options.model,
     timeoutMs: config.timeoutMs ?? options.timeoutMs,
+    workingDirectory: options.workingDirectory ?? options.workflowDirectory,
 });
```
- Same change in both the single-item and batch paths.

**`packages/pipeline-core/src/workflow/nodes/ai.ts`**
- Same `workingDirectory` pass-through to `aiInvoker`.

**`packages/pipeline-core/src/workflow/nodes/reduce.ts`**
- Same `workingDirectory` pass-through to `aiInvoker` in `executeAIReduce`.

### Tests

**`packages/pipeline-core/src/workflow/__tests__/settings.test.ts`** (new)
- Test that `settings.workingDirectory` flows through to `aiInvoker` options when caller doesn't provide it.
- Test that caller-provided `workingDirectory` takes precedence over settings.
- Test that `settings.model`/`concurrency`/`timeoutMs` cascade correctly (caller > settings > default).

---

## Commit 2: `feat(workflow): add parameter substitution to WorkflowConfig`

Add a top-level `parameters` field. Values are substituted into all prompts via `{{variable}}` syntax, integrated through the shared template engine.

### Files changed

**`packages/pipeline-core/src/workflow/types.ts`**
```diff
 interface WorkflowConfig {
     name: string;
     description?: string;
     settings?: WorkflowSettings;
     nodes: Record<string, NodeConfig>;
+    /** Top-level parameters available in all node prompts via {{key}} syntax. */
+    parameters?: Record<string, string>;
 }
```

**`packages/pipeline-core/src/workflow/types.ts`** (WorkflowExecutionOptions)
```diff
 interface WorkflowExecutionOptions {
     ...
+    /** Runtime parameter overrides. Merged on top of config.parameters (runtime wins). */
+    parameters?: Record<string, string>;
 }
```

**`packages/pipeline-core/src/workflow/executor.ts`**
- In `applySettingsDefaults` (or a new `buildEffectiveContext` helper), merge parameters:
```ts
const effectiveParams = {
    ...config.parameters,      // YAML-declared defaults
    ...options.parameters,     // runtime overrides (CLI --param)
};
```
- Store in `WorkflowContext`:
```diff
 export interface WorkflowContext {
     config:    WorkflowConfig;
     options:   WorkflowExecutionOptions;
     results:   Map<string, NodeResult>;
     tiers:     ExecutionTier[];
     startTime: number;
+    parameters: Record<string, string>;
 }
```

**`packages/pipeline-core/src/workflow/nodes/utils.ts`**
- Modify `resolvePrompt` to accept and apply parameters:
```diff
 export async function resolvePrompt(
     prompt:     string | undefined,
     promptFile: string | undefined,
-    options:    WorkflowExecutionOptions
+    options:    WorkflowExecutionOptions,
+    parameters?: Record<string, string>
 ): Promise<string> {
     let resolved: string;
     if (prompt)     resolved = prompt;
     else if (promptFile) {
         const workflowDir = options.workflowDirectory ?? process.cwd();
         resolved = await fs.readFile(path.resolve(workflowDir, promptFile), 'utf-8');
     } else {
         throw new Error('Node config requires either `prompt` or `promptFile`');
     }
+    // Substitute top-level parameters (before item-level substitution)
+    if (parameters && Object.keys(parameters).length > 0) {
+        resolved = substituteVariables(resolved, parameters, {
+            missingValueBehavior: 'preserve',  // leave {{field}} for item-level substitution
+            preserveSpecialVariables: true,
+        });
+    }
     return resolved;
 }
```
- Import `substituteVariables` from `../../utils/template-engine`.

**`packages/pipeline-core/src/workflow/executor.ts`**
- In `executeNode`, pass parameters to node executors. Since executors receive `ctx.options`, add parameters to the options bag:
```diff
 async function executeNode(nodeId: string, ctx: WorkflowContext): Promise<void> {
     const nodeConfig = ctx.config.nodes[nodeId];
     const parentIds  = nodeConfig.from ?? [];
     const inputs     = gatherInputs(parentIds, ctx.results);
+    // Inject parameters into options for this execution
+    const nodeOptions = ctx.parameters && Object.keys(ctx.parameters).length > 0
+        ? { ...ctx.options, parameters: ctx.parameters }
+        : ctx.options;

     let output: Items;
     switch (nodeConfig.type) {
-        case 'map':    output = await executeMap(nodeConfig, inputs, ctx.options); break;
+        case 'map':    output = await executeMap(nodeConfig, inputs, nodeOptions); break;
         // ... same for all node types
     }
 }
```

Wait — this is over-complicated. Simpler approach: **pass parameters alongside options to `resolvePrompt` calls inside each node executor.**

**Revised approach** — Store parameters on `WorkflowExecutionOptions` directly (already added above). Then in each node's `resolvePrompt` call:

**`packages/pipeline-core/src/workflow/nodes/map.ts`**
```diff
-const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options);
+const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options, options.parameters);
```

**`packages/pipeline-core/src/workflow/nodes/ai.ts`**
```diff
-const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options);
+const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options, options.parameters);
```

**`packages/pipeline-core/src/workflow/nodes/reduce.ts`**
```diff
-const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options);
+const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options, options.parameters);
```

**`packages/pipeline-core/src/workflow/executor.ts`**
- Merge config-level + runtime parameters and store on effective options:
```ts
const effectiveOptions = applySettingsDefaults(config.settings, {
    ...options,
    parameters: { ...config.parameters, ...options.parameters },
});
```

### Tests

**`packages/pipeline-core/src/workflow/__tests__/parameters.test.ts`** (new)
- Test `{{param}}` in inline prompt is substituted from `config.parameters`.
- Test runtime `options.parameters` overrides `config.parameters`.
- Test `{{fieldName}}` for item fields is NOT consumed by parameter substitution (preserved for item-level).
- Test `{{ITEMS}}`, `{{RESULTS}}`, `{{COUNT}}` special variables are preserved.
- Test parameters work with `promptFile` (loaded, then substituted).
- Test empty/missing parameters leaves template unchanged.

---

## Commit 3: `feat(workflow): add skill resolution to map, ai, and reduce nodes`

Add optional `skill` field to AI-invoking node configs. When present, resolve the skill content and prepend it to the prompt.

### Files changed

**`packages/pipeline-core/src/workflow/types.ts`**
```diff
 interface MapNodeConfig extends BaseNode {
     type: 'map';
     prompt?: string;
     promptFile?: string;
+    /** Skill name to resolve and prepend to prompt. */
+    skill?: string;
     output?: string[];
     ...
 }

 interface AINodeConfig extends BaseNode {
     type: 'ai';
     prompt?: string;
     promptFile?: string;
+    /** Skill name to resolve and prepend to prompt. */
+    skill?: string;
     output?: string[];
     ...
 }

 interface ReduceNodeConfig extends BaseNode {
     type: 'reduce';
     strategy: ReduceStrategy;
     prompt?: string;
     promptFile?: string;
+    /** Skill name to resolve and prepend to prompt (only used when strategy is 'ai'). */
+    skill?: string;
     output?: string[];
     ...
 }
```

**`packages/pipeline-core/src/workflow/nodes/utils.ts`**
- Add skill resolution to `resolvePrompt`:
```diff
 export async function resolvePrompt(
     prompt:     string | undefined,
     promptFile: string | undefined,
     options:    WorkflowExecutionOptions,
-    parameters?: Record<string, string>
+    parameters?: Record<string, string>,
+    skillName?: string
 ): Promise<string> {
     let resolved: string;
     if (prompt)     resolved = prompt;
     else if (promptFile) { ... }
     else throw new Error('...');

+    // Prepend skill content if specified
+    if (skillName && options.workspaceRoot) {
+        const skillContent = await resolveSkill(skillName, options.workspaceRoot);
+        resolved = skillContent + '\n\n' + resolved;
+    }

     // Substitute top-level parameters
     if (parameters && Object.keys(parameters).length > 0) {
         resolved = substituteVariables(resolved, parameters, { ... });
     }
     return resolved;
 }
```
- Import `resolveSkill` from `../../pipeline/skill-resolver`.

**`packages/pipeline-core/src/workflow/nodes/map.ts`**
```diff
-const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options, options.parameters);
+const resolvedPrompt = await resolvePrompt(
+    config.prompt, config.promptFile, options, options.parameters, config.skill
+);
```

**`packages/pipeline-core/src/workflow/nodes/ai.ts`**
- Same change: pass `config.skill` to `resolvePrompt`.

**`packages/pipeline-core/src/workflow/nodes/reduce.ts`**
- Same change in `executeAIReduce`: pass `config.skill` to `resolvePrompt`.

### Tests

**`packages/pipeline-core/src/workflow/__tests__/skill-resolution.test.ts`** (new)
- Mock `resolveSkill` (vi.mock the module).
- Test that `skill: 'my-skill'` on a map node prepends skill content to the prompt sent to `aiInvoker`.
- Test that skill content appears before parameter substitution and item substitution.
- Test that missing `workspaceRoot` silently skips skill resolution (or throws — design decision, recommend skip with warning).
- Test on `ai` and `reduce` (strategy: 'ai') nodes too.
- Test that nodes without `skill` field work unchanged.

---

## Commit 4: `feat(workflow): add rich structured progress events`

Replace the minimal `(nodeId, 'start'|'complete'|'warn')` callback with structured `WorkflowProgressEvent` modeled after `PipelinePhaseEvent`.

### Files changed

**`packages/pipeline-core/src/workflow/types.ts`**
```ts
// New types
export type WorkflowNodePhase = 'pending' | 'running' | 'completed' | 'failed' | 'warned';

export interface WorkflowProgressEvent {
    /** Node ID from the workflow config. */
    nodeId: string;
    /** Phase transition. */
    phase: WorkflowNodePhase;
    /** ISO 8601 timestamp. */
    timestamp: string;
    /** Duration in ms (present on 'completed' | 'failed'). */
    durationMs?: number;
    /** Number of input items entering this node. */
    inputItemCount?: number;
    /** Number of output items produced (present on 'completed'). */
    outputItemCount?: number;
    /** Error message (present on 'failed' | 'warned'). */
    error?: string;
    /** For map nodes: per-item progress. */
    itemProgress?: {
        completed: number;
        failed: number;
        total: number;
    };
}
```

Update `WorkflowExecutionOptions`:
```diff
 interface WorkflowExecutionOptions {
     ...
-    onProgress?: (nodeId: string, event: 'start' | 'complete' | 'warn') => void;
+    /** Structured progress callback for node-level events. */
+    onProgress?: (event: WorkflowProgressEvent) => void;
 }
```

**`packages/pipeline-core/src/workflow/executor.ts`**
- Replace all `onProgress?.(nodeId, 'start')` calls with structured events:
```ts
async function executeNode(nodeId: string, ctx: WorkflowContext): Promise<void> {
    const nodeConfig = ctx.config.nodes[nodeId];
    const parentIds  = nodeConfig.from ?? [];
    const inputs     = gatherInputs(parentIds, ctx.results);
    const nodeStart  = Date.now();

    // Emit 'running' event
    ctx.options.onProgress?.({
        nodeId,
        phase: 'running',
        timestamp: new Date().toISOString(),
        inputItemCount: inputs.length,
    });

    try {
        let output: Items;
        // ... switch(nodeConfig.type) ...

        const durationMs = Date.now() - nodeStart;
        ctx.results.set(nodeId, { nodeId, success: true, items: output, stats: { durationMs, inputCount: inputs.length, outputCount: output.length } });

        // Emit 'completed' event
        ctx.options.onProgress?.({
            nodeId,
            phase: 'completed',
            timestamp: new Date().toISOString(),
            durationMs,
            inputItemCount: inputs.length,
            outputItemCount: output.length,
        });
    } catch (err) {
        const durationMs = Date.now() - nodeStart;
        if (nodeConfig.onError === 'warn' || ctx.config.settings?.onError === 'warn') {
            // Emit 'warned' event
            ctx.options.onProgress?.({
                nodeId,
                phase: 'warned',
                timestamp: new Date().toISOString(),
                durationMs,
                inputItemCount: inputs.length,
                error: String(err),
            });
            ctx.results.set(nodeId, { nodeId, success: false, items: [], error: String(err), stats: { durationMs } });
        } else {
            // Emit 'failed' event
            ctx.options.onProgress?.({
                nodeId,
                phase: 'failed',
                timestamp: new Date().toISOString(),
                durationMs,
                inputItemCount: inputs.length,
                error: String(err),
            });
            throw err;
        }
    }
}
```

**`packages/pipeline-core/src/workflow/nodes/map.ts`**
- Add per-item progress tracking by accepting an optional `onItemProgress` callback or emitting through `options.onProgress`:
```ts
// Inside the limiter.run callback, after each item completes:
completedCount++;
if (result.success) successCount++; else failCount++;
options.onProgress?.({
    nodeId: '__current',  // placeholder — see design note
    phase: 'running',
    timestamp: new Date().toISOString(),
    itemProgress: { completed: completedCount, failed: failCount, total: inputs.length },
});
```

**Design note:** Map node doesn't know its own `nodeId` — it only receives `config` and `options`. Two options:
  - **Option A (recommended):** Add a `nodeId` field to `WorkflowExecutionOptions` that `executeNode` sets before dispatching. Lightweight — just one extra field.
  - **Option B:** Pass `nodeId` as a parameter to `executeMap`. Changes the public signature.

Choose **Option A**: add `currentNodeId?: string` to `WorkflowExecutionOptions` (set ephemerally in `executeNode`):
```diff
// executor.ts — executeNode
+const nodeOptions = { ...ctx.options, currentNodeId: nodeId };
 switch (nodeConfig.type) {
-    case 'map': output = await executeMap(nodeConfig, inputs, ctx.options); break;
+    case 'map': output = await executeMap(nodeConfig, inputs, nodeOptions); break;
     // ... same for all
 }
```
Then in `map.ts`:
```ts
options.onProgress?.({
    nodeId: options.currentNodeId ?? '',
    phase: 'running',
    timestamp: new Date().toISOString(),
    itemProgress: { completed: completedCount, failed: failCount, total: inputs.length },
});
```

### Tests

**`packages/pipeline-core/src/workflow/__tests__/progress-events.test.ts`** (new)
- Test that `onProgress` receives `running` → `completed` events for each node.
- Test that `durationMs` is present on `completed` events.
- Test `inputItemCount` and `outputItemCount` are accurate.
- Test that `warned` events are emitted instead of `failed` when `onError: 'warn'`.
- Test per-item `itemProgress` on map nodes (increments as items complete).
- Test multi-tier execution: tier 1 nodes complete before tier 2 starts.

---

## Commit 5: `feat(workflow): add per-item process tracking for map and ai nodes`

Add `onItemProcessCreated` callback so the server can persist child processes for each AI invocation within map/ai nodes.

### Files changed

**`packages/pipeline-core/src/workflow/types.ts`**
```ts
// New callback type
export interface WorkflowItemProcessEvent {
    /** Node ID in the workflow. */
    nodeId: string;
    /** Zero-based index of the item within the node's input array. */
    itemIndex: number;
    /** Process ID from the ProcessTracker. */
    processId: string;
    /** Status of the item process. */
    status: 'running' | 'completed' | 'failed';
    /** Short label for UI display (e.g., first field value). */
    itemLabel?: string;
    /** Error message when status is 'failed'. */
    error?: string;
}
```

```diff
 interface WorkflowExecutionOptions {
     ...
+    /** Called when a map/ai node creates a child process for an individual item. */
+    onItemProcess?: (event: WorkflowItemProcessEvent) => void;
 }
```

**`packages/pipeline-core/src/workflow/nodes/map.ts`**
- In single-item mode, wrap each AI call with process tracking:
```ts
// Inside limiter.run for single-item mode:
const itemLabel = String(Object.values(item)[0] ?? `item-${index}`);
const processId = options.processTracker?.registerProcess(
    `Map: ${itemLabel}`, /* parentGroupId */ undefined
);
options.onItemProcess?.({
    nodeId: options.currentNodeId ?? '',
    itemIndex: index,
    processId: processId ?? `${options.currentNodeId}-${index}`,
    status: 'running',
    itemLabel,
});

const result = await options.aiInvoker!(prompt, { ... });

options.processTracker?.updateProcess(processId!, result.success ? 'completed' : 'failed', result.response, result.error);
options.onItemProcess?.({
    nodeId: options.currentNodeId ?? '',
    itemIndex: index,
    processId: processId ?? `${options.currentNodeId}-${index}`,
    status: result.success ? 'completed' : 'failed',
    itemLabel,
    error: result.error,
});
```
- In batch mode: similar, but one process per batch (index = batch index).

**`packages/pipeline-core/src/workflow/nodes/ai.ts`**
- Single AI call, so simpler:
```ts
const processId = options.processTracker?.registerProcess(`AI: ${options.currentNodeId}`);
options.onItemProcess?.({
    nodeId: options.currentNodeId ?? '',
    itemIndex: 0,
    processId: processId ?? options.currentNodeId ?? 'ai',
    status: 'running',
});

const result = await options.aiInvoker!(prompt, { ... });

options.processTracker?.updateProcess(processId!, result.success ? 'completed' : 'failed', ...);
options.onItemProcess?.({
    nodeId: options.currentNodeId ?? '',
    itemIndex: 0,
    processId: processId ?? options.currentNodeId ?? 'ai',
    status: result.success ? 'completed' : 'failed',
    error: result.error,
});
```

### Tests

**`packages/pipeline-core/src/workflow/__tests__/item-process-tracking.test.ts`** (new)
- Test that `onItemProcess` is called with `running` then `completed` for each item in a map node.
- Test that `processTracker.registerProcess` is called when a tracker is provided.
- Test batch mode: one process per batch.
- Test AI node: one process per invocation.
- Test that `itemLabel` is populated from the first field value.
- Test that errors produce `status: 'failed'` with error message.
- Test that missing `processTracker` and `onItemProcess` don't cause errors.

---

## Commit 6: `feat(workflow): export workflow types and executeWorkflow from pipeline-core barrel`

Make the workflow engine publicly consumable from `pipeline-core`'s top-level import.

### Files changed

**`packages/pipeline-core/src/index.ts`**
```diff
+// ── Workflow engine ─────────────────────────────────────────────────────────
+export {
+    // Types
+    type Item as WorkflowItem,
+    type Items as WorkflowItems,
+    type WorkflowConfig,
+    type WorkflowSettings,
+    type WorkflowExecutionOptions,
+    type WorkflowResult,
+    type WorkflowProgressEvent,
+    type WorkflowNodePhase,
+    type WorkflowItemProcessEvent,
+    type NodeConfig,
+    type NodeResult,
+    type NodeStats,
+    type LoadNodeConfig,
+    type MapNodeConfig,
+    type AINodeConfig,
+    type ReduceNodeConfig,
+    type FilterNodeConfig,
+    type ScriptNodeConfig,
+    type MergeNodeConfig,
+    type TransformNodeConfig,
+    type BaseNode,
+    type ReduceStrategy,
+    type LoadSource,
+    type DAGGraph,
+    type ExecutionTier,
+    // Type guards
+    isLoadNode,
+    isScriptNode,
+    isFilterNode,
+    isMapNode,
+    isReduceNode,
+    isMergeNode,
+    isTransformNode,
+    isAINode,
+    isNodeConfig,
+    // Functions
+    executeWorkflow,
+    buildGraph,
+    detectCycle,
+    validate as validateWorkflow,
+    WorkflowValidationError,
+    schedule as scheduleWorkflow,
+    getExecutionOrder,
+} from './workflow';
```

**Naming note:** `validate` and `schedule` are renamed on export (`validateWorkflow`, `scheduleWorkflow`) to avoid collisions with any existing pipeline exports during the transition period. `Item`/`Items` are aliased to `WorkflowItem`/`WorkflowItems` to avoid collision with any generic `Item` that consumers might have.

### Tests

**`packages/pipeline-core/src/workflow/__tests__/barrel-exports.test.ts`** (new)
- Import all symbols from `pipeline-core/src/index` (or `../../index`).
- Assert each exported symbol is defined (not undefined).
- Assert `executeWorkflow` is a function.
- Assert type guards are functions.
- Assert `WorkflowValidationError` is a constructor.

---

## Dependency Graph

```
Commit 1 (settings)
    │
    ├──► Commit 2 (parameters)   ── uses applySettingsDefaults pattern
    │        │
    │        └──► Commit 3 (skills)  ── extends resolvePrompt signature from commit 2
    │
    ├──► Commit 4 (progress events)  ── adds currentNodeId to options
    │        │
    │        └──► Commit 5 (item tracking)  ── uses currentNodeId from commit 4
    │
    └─────────────────────────────────────► Commit 6 (barrel export)  ── exports everything
```

Commits 2–3 and 4–5 are two independent chains that can be developed in parallel. Commit 6 must come last.

## Estimated Blast Radius

| Commit | Files modified | Files created (tests) | Risk |
|--------|---------------|----------------------|------|
| 1 — Settings | 5 (`types.ts`, `executor.ts`, `map.ts`, `ai.ts`, `reduce.ts`) | 1 | Low |
| 2 — Parameters | 4 (`types.ts`, `executor.ts`, `nodes/utils.ts`, + 3 node files) | 1 | Low-Medium |
| 3 — Skills | 4 (`types.ts`, `nodes/utils.ts`, + 3 node files) | 1 | Low |
| 4 — Progress | 3 (`types.ts`, `executor.ts`, `map.ts`) | 1 | Medium — changes callback signature |
| 5 — Item tracking | 3 (`types.ts`, `map.ts`, `ai.ts`) | 1 | Low |
| 6 — Barrel | 1 (`index.ts`) | 1 | Low |

**Total:** ~10 source files modified, 6 test files created. All changes within `packages/pipeline-core/src/workflow/` except the final barrel export.
