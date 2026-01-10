# Map-Reduce AI Framework Design

## Summary
Extract the existing code-review map-reduce workflow into a reusable framework that can run other AI map-reduce jobs (list + template prompt, multi-file analysis, test generation, etc.). The framework should support pluggable splitters, mappers, reducers, and prompt templates while keeping UI/process tracking consistent with current behavior.

## Goals
- Provide a reusable map-reduce execution pipeline for AI workflows.
- Support concurrency limits, progress updates, and grouped AI processes.
- Allow deterministic or AI-assisted reduce strategies.
- Enable list + template prompt workflows with minimal boilerplate.
- Keep code-review behavior unchanged after refactor.

## Non-Goals
- Changing existing UX or UI output modes.
- Adding new commands or UI before core framework is stable.
- Rewriting AI services or process storage.

## Proposed Structure
```
src/shortcuts/map-reduce/
├── types.ts
├── executor.ts
├── prompt-template.ts
├── reducers/
│   ├── reducer.ts
│   ├── deterministic.ts
│   ├── ai-reducer.ts
│   └── hybrid-reducer.ts
├── splitters/
│   ├── file-splitter.ts
│   ├── chunk-splitter.ts
│   └── rule-splitter.ts
└── jobs/
    ├── code-review-job.ts
    └── template-job.ts
```

## Core Interfaces (Sketch)
```ts
interface MapReduceJob<TInput, TMapOutput, TReduceOutput> {
  id: string;
  name: string;
  splitter: (input: TInput) => WorkItem<TInput>[];
  mapper: (item: WorkItem<TInput>, context: MapContext) => Promise<TMapOutput>;
  reducer: Reducer<TMapOutput, TReduceOutput>;
  promptTemplate?: PromptTemplate;
  options?: MapReduceOptions;
}

interface MapReduceOptions {
  maxConcurrency: number;
  reduceMode: 'deterministic' | 'ai' | 'hybrid';
  showProgress: boolean;
  retryOnFailure: boolean;
  timeoutMs?: number;
}
```

## Execution Flow
1. Split input into work items.
2. Register a grouped AI process for tracking.
3. Execute map tasks with `ConcurrencyLimiter`.
4. Reduce map outputs into a final result.
5. Complete the group process with aggregated results.

## Reducer Strategy
- **DeterministicReducer**: Deduplicate and summarize findings without AI.
- **AIReducer**: Use AI to synthesize results; fall back to deterministic on failure.
- **HybridReducer**: Deterministic reduce plus AI polishing.

## Prompt Template Support
Provide a lightweight template system to build map prompts from list items.

```ts
interface PromptTemplate {
  template: string;
  requiredVariables: string[];
  systemPrompt?: string;
  responseParser?: (response: string) => unknown;
}
```

## Example Job: List + Template
```ts
const job = createTemplateJob({
  id: 'custom-review',
  name: 'Custom Template Review',
  template: 'Review {{item}} for {{criteria}}...',
  reducer: new DeterministicReducer(...)
});
```

## Migration Plan
1. Extract `Reducer` and `ConcurrencyLimiter` into map-reduce module.
2. Add `MapReduceExecutor` with process grouping hooks.
3. Refactor code review to use new executor with a `CodeReviewJob` wrapper.
4. Add `TemplateJob` helper for list + template prompts.
5. Verify behavior parity with existing code review outputs.

## Open Questions
- How should per-item failures be surfaced to users?
- Should reduce output support streaming updates?
- Do we need a shared response schema across jobs, or job-specific parsing only?
