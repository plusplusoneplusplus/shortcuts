# Workflow Engine

DAG-based workflow execution engine in `packages/coc-workflow/src/workflow/`, published as
`@plusplusoneplusplus/coc-workflow`. It compiles YAML pipeline/workflow definitions into
executable DAGs and runs them with concurrency control, cancellation, and structured progress
events.

It is a pure compiler/executor surface with no runtime dependency on Forge; AI execution is
injected via `WorkflowExecutionOptions.aiInvoker`. Forge depends on it and re-exports the
workflow surface from `@plusplusoneplusplus/forge` and `@plusplusoneplusplus/forge/workflow`.

`@plusplusoneplusplus/coc-workflow/ralph` is a sibling public module, not part of the DAG
internals: portable Ralph records, signal/final-check parsers, progress-section
parsing/formatting, prompt builders, and pure iteration/final-check action-decision intents.
Queue, process-store, route, WebSocket, and filesystem side effects stay in the CoC server
adapters.

## Key Exports

| Symbol | Purpose |
|--------|---------|
| `compileToWorkflow(yamlContent)` | Converts pipeline YAML or native workflow YAML to `WorkflowConfig` |
| `executeWorkflow(config, options)` | Runs the DAG with full lifecycle management |
| `flattenWorkflowResult(result)` | Flattens a workflow result for flat display output |
| `isCSVSource(value)`, `isGenerateConfig(value)` | Runtime guards for pipeline-YAML compatibility inputs |

## Architecture

```
YAML → compileToWorkflow() → WorkflowConfig → executeWorkflow() → WorkflowResult
                                    ↓
                              Graph Builder → DAG
                                    ↓
                              Scheduler (topological order + concurrency)
                                    ↓
                              Node Executors (per-type)
```

## Node Types

| Type | Executor | Description |
|------|----------|-------------|
| `load` | LoadNodeExecutor | Load data from files/URLs |
| `map` | MapNodeExecutor | Transform each item |
| `ai` | AINodeExecutor | AI invocation with tools |
| `reduce` | ReduceNodeExecutor | Aggregate items |
| `filter` | FilterNodeExecutor | Filter items by condition |
| `script` | ScriptNodeExecutor | Execute shell scripts |
| `merge` | MergeNodeExecutor | Combine multiple inputs |
| `transform` | TransformNodeExecutor | Data transformation |

## WorkflowConfig

```typescript
interface WorkflowConfig {
  name: string;
  description?: string;
  settings?: WorkflowSettings;
  nodes: Record<string, NodeConfig>;
  parameters?: Record<string, string>;
}

interface WorkflowSettings {
  model?: string;
  concurrency?: number;
  timeoutMs?: number;
  onError?: 'abort' | 'warn';
  workingDirectory?: string;
}
```

## Features

- **Concurrency control** — `ConcurrencyLimiter` caps parallel node execution.
- **AI invocation kernel** — `workflow/nodes/ai-invocation-kernel.ts` (`invokeWorkflowAI`) owns
  the AI-call lifecycle for every AI-capable node (map, ai, reduce, ai-filter, ai-load):
  missing-`aiInvoker` preflight guard, provider-option resolution (`model`/`timeoutMs` with node
  override, `workingDirectory ?? workflowDirectory`, `signal`), cancellation guards, error
  normalization, and opt-in `processTracker`/`onItemProcess` reporting. Executors are thin
  adapters building prompts and mapping the normalized result into their output shape: map/ai/
  reduce annotate `__error`, ai-filter excludes conservatively, ai-load throws.
- **Cancellation** — `AbortSignal` checked before and after node and AI invocations, centralized
  in the kernel for AI nodes.
- **Skill resolution** — per-node `skill`/`skills` field for single or multi-skill prompt
  injection.
- **Parameters** — template substitution via the `parameters` map.
- **Progress events** — structured `WorkflowProgressEvent` and per-item
  `WorkflowItemProcessEvent`.
- **Validation** — the graph validator checks cycles, missing dependencies, and type
  compatibility.
- **Template engine** — `utils/template-engine.ts` does Mustache-style `{{param}}` substitution
  in node configurations.
- **Filter expressions** — `workflow/nodes/filter.ts` evaluates comparison operators, regex
  matching, AI predicates, and logical combinators against items.

## Pipeline compatibility & code placement

`workflow/pipeline-compat.ts` holds the pipeline YAML config types the compiler accepts; all
execution goes through the workflow engine. `packages/forge/src/workflow/` is only
`index.ts` (`export * from '@plusplusoneplusplus/coc-workflow/workflow'`) — add no workflow
implementation code there, and prefer importing `@plusplusoneplusplus/coc-workflow` directly.
Forge's own runtime cancellation/concurrency utilities under `packages/forge/src/runtime/`
serve map-reduce and the task queue and are a separate class identity from the workflow package.

Forge's map-reduce package stays a higher-level abstraction for parallel processing:
`MapReduceExecutor` (split → map → reduce), `MapReduceJob` (config and state), splitters
(file/chunk/rule-based), and reducers (AI/deterministic/hybrid).
