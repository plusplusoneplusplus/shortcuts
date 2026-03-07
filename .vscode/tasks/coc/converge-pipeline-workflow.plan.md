# Converge Pipeline + Workflow into Single Engine

## Problem
Two parallel execution systems exist in `pipeline-core`:
- **Pipeline** (`src/pipeline/`): Linear `input→filter→map→reduce` or single `job`. Production-grade, fully wired.
- **Workflow** (`src/workflow/`): Arbitrary DAG with 8 node types. Complete engine, zero integration.

They share overlapping concepts (map, reduce, filter, AI invocation) but are completely independent codebases. Maintaining both is wasteful.

## Approach: Workflow Absorbs Everything

**Delete the pipeline executor. The workflow DAG engine becomes the only execution engine.**

No backward compatibility. No shims. No deprecation. The linear pipeline YAML syntax is kept as ergonomic sugar that compiles to a `WorkflowConfig` before execution.

```
  Pipeline YAML (input/map/reduce)     Workflow YAML (nodes: {})
         │                                      │
         └──────► compileToWorkflow() ◄─────────┘
                         │
                         ▼
               ┌────────────────────┐
               │  executeWorkflow() │  ← THE engine
               └────────────────────┘
```

## Phases

### Phase 1 — Enhance Workflow Engine with Production Features

Bring the workflow engine to production parity. All work in `packages/pipeline-core/src/workflow/`.

- **Skill resolution** — Add optional `skill` field to `MapNodeConfig`, `AINodeConfig`, `ReduceNodeConfig`. Load skill content via `resolveSkill()` and prepend to prompt.
- **Rich progress events** — Replace the minimal `onProgress(nodeId, 'start'|'complete')` with structured events: node phase transitions, per-item tracking, duration, item counts. Model after `PipelinePhaseEvent` but node-scoped.
- **Per-item process tracking** — Add `onItemProcessCreated` callback to map/ai nodes so the server can persist child processes.
- **Parameter substitution** — Add a top-level `parameters` field to `WorkflowConfig`. Inject into context, available in all node prompts via `{{variable}}` syntax.
- **Settings enhancement** — `WorkflowSettings` already has `model`, `concurrency`, `timeoutMs`. Add `toolCallCache`, `workingDirectory` fields.
- **Export from barrel** — Add workflow types + `executeWorkflow` to `pipeline-core/src/index.ts`.

### Phase 2 — Build the Compiler: `compileToWorkflow()`

Create `packages/pipeline-core/src/workflow/compiler.ts`:

```typescript
function compileToWorkflow(yaml: string): WorkflowConfig
```

- Parse YAML, detect format by presence of `nodes:` key vs `input:`/`map:`/`job:` keys
- If already workflow format → validate and return
- If pipeline format → compile:
  - `input:` → `load` node (source: csv/inline/generate)
  - `filter:` → `filter` node (from: load)
  - `map:` → `map` node (from: filter or load, with concurrency/batchSize/model)
  - `reduce:` → `reduce` node (from: map)
  - `job:` → single `ai` node (from: load with inline empty input)
  - `parameters:` → top-level `parameters` on WorkflowConfig
  - `name:`, `workingDirectory:` → copied to WorkflowConfig

Write exhaustive tests: every pipeline pattern (A–D) compiles correctly.

### Phase 3 — Delete Pipeline Executor

- Delete `packages/pipeline-core/src/pipeline/executor.ts` (the `executePipeline` function)
- Delete `packages/pipeline-core/src/pipeline/types.ts` (`PipelineConfig`, `PipelineExecutionResult`, etc.)
- Keep or migrate utilities that workflow reuses: CSV reader, template engine, skill resolver
- Delete the map-reduce framework (`src/map-reduce/`) — workflow's map/reduce nodes replace it
- Remove all pipeline exports from `src/index.ts`, replace with workflow exports
- Update `src/pipeline/index.ts` to re-export `compileToWorkflow` + workflow types (or just delete the pipeline directory entirely)

### Phase 4 — Rewire All Integration Points

**`packages/coc/src/commands/run.ts`** (~8 files total in coc):
- Replace `parsePipelineYAMLSync` + `executePipeline` with `compileToWorkflow` + `executeWorkflow`
- Map CLI flags to `WorkflowExecutionOptions`
- Update progress display to consume new node-scoped events
- `validate.ts`, `list.ts` — use `WorkflowConfig` instead of `PipelineConfig`

**`packages/coc/src/server/queue-executor-bridge.ts`**:
- Replace `executePipeline` call with `compileToWorkflow` + `executeWorkflow`
- Map `WorkflowResult` to process metadata for persistence

**`src/shortcuts/yaml-pipeline/` (VS Code extension)**:
- `pipeline-executor-service.ts` — swap to `compileToWorkflow` + `executeWorkflow`
- `preview-mermaid.ts`, `preview-content.ts` — consume `WorkflowConfig` for DAG preview (this already works since `buildPreviewDAG` already handles `nodes:`)
- `result-viewer-provider.ts` — consume `WorkflowResult` instead of `PipelineExecutionResult`
- `commands.ts` — update pipeline creation templates to use workflow format for new pipelines

**SPA dashboard** (`packages/coc/src/server/spa/`):
- `buildPreviewDAG.ts` — already handles workflow format; remove the linear pipeline branch
- `PipelineDAGChart.tsx`, `DAGHoverTooltip.tsx` — update to use `WorkflowConfig`
- `WorkflowDAGChart.tsx`, `WorkflowDetailView.tsx` — these become the primary views

### Phase 5 — Update Skill & Schema

**`pipeline-generator` skill** (`resources/bundled-skills/pipeline-generator/`):
- Unify patterns A–E into a single workflow-first approach
- Simple patterns (A–D) can still be generated as linear YAML (the compiler handles it)
- Update `schema.md` and `workflow-schema.md` into a single schema reference
- Or: generate everything as `nodes:` format directly since no backward compat needed

**Rename/clean up:**
- Consider renaming `yaml-pipeline` → `yaml-workflow` in VS Code extension
- Update all user-facing strings: "Pipeline" → "Workflow" (or keep "Pipeline" as familiar UX term — dealer's choice)

## Blast Radius Summary

| Package | Files to change | Severity |
|---|---|---|
| `pipeline-core` | ~10 (delete pipeline/, enhance workflow/) | Heavy — but mostly deletion |
| `coc` | ~8 source + ~11 test files | Medium |
| `coc-server` | 0 (no direct pipeline refs) | None |
| `src/` (VS Code) | ~7 source + ~2 test files | Medium |

## Key Design Decisions

1. **Single YAML format or two?** — Keep both. Linear syntax compiles to nodes. The `nodes:` format is verbose for simple cases; `input/map/reduce` is cleaner for the 80% use case.
2. **Cancellation model** — Use `AbortSignal` (workflow's model). It's web-standard and better than polling `isCancelled()`.
3. **Result type** — `WorkflowResult` with `results: Map<string, NodeResult>` + `leaves: Map<string, NodeResult>`. Consumers that want a flat result can read the leaf node.
4. **Naming** — Keep "pipeline" in UX-facing names if desired (it's familiar). The internal engine is "workflow".
