# Workflow Engine

DAG-based workflow execution engine in `packages/coc-workflow/src/workflow/`.

## Overview

Converts YAML pipeline/workflow definitions into executable DAGs and runs them with concurrency control, cancellation support, and structured progress events.

The published package is `@plusplusoneplusplus/coc-workflow`. It contains the pure workflow compiler/executor surface without taking a runtime dependency on Forge; AI execution is injected through `WorkflowExecutionOptions.aiInvoker`. Forge depends on `@plusplusoneplusplus/coc-workflow` and keeps backward-compatible workflow exports from both `@plusplusoneplusplus/forge` and `@plusplusoneplusplus/forge/workflow`.

`@plusplusoneplusplus/coc-workflow/ralph` is a sibling public module, not part of the DAG workflow internals. It exposes portable Ralph records, signal/final-check parsers, progress-section parsing/formatting, prompt builders, and pure iteration/final-check action-decision intents while CoC server adapters keep queue, process-store, route, WebSocket, and filesystem side effects.

## Key Exports

| Symbol | Purpose |
|--------|---------|
| `compileToWorkflow(yamlContent)` | Converts legacy pipeline YAML or native workflow YAML to `WorkflowConfig` |
| `executeWorkflow(config, options)` | Runs the DAG with full lifecycle management |
| `flattenWorkflowResult(result)` | Flattens workflow result for flat display output |
| `isCSVSource(value)`, `isGenerateConfig(value)` | Runtime guards for legacy pipeline YAML compatibility inputs |
| `@plusplusoneplusplus/coc-workflow/ralph` | Portable Ralph contracts, prompt builders, parsers, progress formatters, and pure action-decision helpers outside the DAG workflow barrel |

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

- **Concurrency control:** `ConcurrencyLimiter` enforces max parallel node execution
- **AI invocation kernel:** `workflow/nodes/ai-invocation-kernel.ts` (`invokeWorkflowAI`) owns the shared AI-call lifecycle for every AI-capable node (map, ai, reduce, ai-filter, ai-load): missing-`aiInvoker` preflight guard, provider-option resolution (`model`/`timeoutMs` with node override, `workingDirectory ?? workflowDirectory`, `signal`), cancellation guards, error normalization, and opt-in `processTracker`/`onItemProcess` reporting. Node executors are thin adapters that build prompts and map the normalized result into their own output shapes (map/ai/reduce annotate `__error`, ai-filter excludes conservatively, ai-load throws).
- **Cancellation:** `AbortSignal` checked before/after node and AI invocations (centralized in the invocation kernel for AI nodes)
- **Skill resolution:** Per-node `skill`/`skills` field for single or multi-skill prompt injection
- **Parameters:** Template substitution via `parameters` map
- **Progress events:** Structured `WorkflowProgressEvent` and per-item `WorkflowItemProcessEvent`
- **Validation:** Graph validator checks for cycles, missing dependencies, type compatibility

## Map-Reduce Compatibility

Legacy pipeline YAML compatibility types live with the workflow compiler. Forge's map-reduce package remains a separate higher-level abstraction for parallel processing:

| Component | Purpose |
|-----------|---------|
| `MapReduceExecutor` | Orchestrates split → map → reduce |
| `MapReduceJob` | Job configuration and state |
| Splitters | File/Chunk/Rule-based input splitting |
| Reducers | AI/Deterministic/Hybrid result aggregation |

## Pipeline Compatibility

`workflow/pipeline-compat.ts` contains legacy pipeline YAML config types used by the compiler. The old `pipeline/` directory has been deleted — all execution goes through the workflow engine.

Forge's workflow compatibility barrels are thin re-exports over `@plusplusoneplusplus/coc-workflow/workflow`. `packages/forge/src/workflow/` holds only `index.ts` (`export * from '@plusplusoneplusplus/coc-workflow/workflow'`); the engine has no Forge-local copy. Do not add new workflow implementation code there. Forge keeps its own runtime cancellation/concurrency utilities under `packages/forge/src/runtime/` for map-reduce and the task queue — these are a separate class identity from the workflow package. New workflow consumers should import from `@plusplusoneplusplus/coc-workflow` directly where practical.

## Template Engine

`utils/template-engine.ts` provides Mustache-style template substitution for workflow parameters, supporting `{{param}}` syntax in node configurations.

## Filter Executor

`workflow/nodes/filter.ts` evaluates filter expressions against items, supporting comparison operators, regex matching, AI predicates, and logical combinators.
