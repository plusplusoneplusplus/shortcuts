# Map-Reduce AI Processing Framework

**Category:** AI Processing

## Overview

The Map-Reduce AI Processing Framework is a parallel AI execution engine located in `packages/pipeline-core/src/map-reduce/`. It splits an arbitrary input into discrete `WorkItem` units, fans them out to concurrent AI calls bounded by a `ConcurrencyLimiter`, then aggregates the results through a pluggable reducer. The framework is fully generic via TypeScript generics (`TInput → TWorkItemData → TMapOutput → TReduceOutput`) and ships with ready-made splitters (chunk, file, rule), reducers (deterministic, AI-powered, hybrid), and pre-built jobs (prompt-map, code-review, template).

It serves as the execution engine beneath **YAML pipelines** (consumed by `packages/pipeline-core/src/pipeline/`) and **code-review jobs** (consumed by `src/shortcuts/code-review/` in the VS Code extension).

---

## Architecture

```
MapReduceExecutor.execute(job, input)
        │
        ▼
┌───────────────────┐
│  1. Split Phase    │  job.splitter.split(input)
│                   │  → WorkItem<TWorkItemData>[]
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  2. Map Phase      │  ConcurrencyLimiter.all(tasks, isCancelled)
│  (concurrent)     │  for each WorkItem:
│                   │    job.mapper.map(item, context)
│                   │    → MapResult<TMapOutput>
│                   │  timeout retry: base → 2× base on timeout
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  3. Reduce Phase   │  job.reducer.reduce(mapResults, reduceContext)
│                   │  → ReduceResult<TReduceOutput>
└────────┬──────────┘
         │
         ▼
  MapReduceResult<TMapOutput, TReduceOutput>
```

**Source files:**

| File | Role |
|---|---|
| `map-reduce/types.ts` | All interfaces and types (`WorkItem`, `Mapper`, `Reducer`, `MapReduceJob`, …) |
| `map-reduce/executor.ts` | `MapReduceExecutor` — orchestrates split → map → reduce |
| `map-reduce/concurrency-limiter.ts` | `ConcurrencyLimiter` — bounded parallel execution |
| `map-reduce/splitters/chunk-splitter.ts` | Split text/content into overlapping chunks |
| `map-reduce/splitters/file-splitter.ts` | Split a list of `FileItem` objects |
| `map-reduce/splitters/rule-splitter.ts` | Split a list of `Rule` objects (for code review) |
| `map-reduce/reducers/deterministic.ts` | Code-based deduplication and aggregation |
| `map-reduce/reducers/ai-reducer.ts` | AI-powered synthesis with deterministic fallback |
| `map-reduce/reducers/hybrid-reducer.ts` | Combines deterministic pre-pass with optional AI synthesis |
| `map-reduce/jobs/prompt-map-job.ts` | Generic prompt-per-item job with multi-format output |
| `map-reduce/jobs/code-review-job.ts` | Code-review job wrapping `RuleSplitter` |
| `map-reduce/jobs/template-job.ts` | Template-driven reusable job builder |
| `map-reduce/prompt-template.ts` | `PromptTemplate` rendering and `ResponseParsers` |
| `map-reduce/temp-file-utils.ts` | Cross-platform temp files for large AI payloads |

---

## Key Types

### `WorkItem<TInput>` — unit of work

```typescript
interface WorkItem<TInput> {
    id: string;
    data: TInput;
    metadata?: Record<string, unknown>;
}
```

### `MapReduceJob<TInput, TWorkItemData, TMapOutput, TReduceOutput>`

```typescript
interface MapReduceJob<TInput, TWorkItemData, TMapOutput, TReduceOutput> {
    id: string;
    name: string;
    splitter: Splitter<TInput, TWorkItemData>;
    mapper: Mapper<TWorkItemData, TMapOutput>;
    reducer: Reducer<TMapOutput, TReduceOutput>;
    promptTemplate?: PromptTemplate;
    options?: Partial<MapReduceOptions>;
}
```

### `MapReduceOptions` — execution tuning

```typescript
interface MapReduceOptions {
    maxConcurrency: number;     // default: 5
    reduceMode: ReduceMode;     // 'deterministic' | 'ai' | 'hybrid'
    showProgress: boolean;
    retryOnFailure: boolean;
    retryAttempts?: number;     // default: 1
    timeoutMs?: number;         // default: 1 800 000 ms (30 min)
    jobName?: string;
}
```

### `ExecutorOptions` — combines options with runtime hooks

```typescript
interface ExecutorOptions extends MapReduceOptions {
    aiInvoker: AIInvoker;
    processTracker?: ProcessTracker;
    onProgress?: ProgressCallback;
    isCancelled?: () => boolean;
    onItemComplete?: ItemCompleteCallback;  // incremental save hook
}
```

### `MapReduceResult<TMapOutput, TReduceOutput>` — final output

```typescript
interface MapReduceResult<TMapOutput, TReduceOutput> {
    success: boolean;
    output?: TReduceOutput;
    mapResults: MapResult<TMapOutput>[];
    reduceStats?: ReduceStats;
    totalTimeMs: number;
    executionStats: ExecutionStats;
    error?: string;
}
```

---

## ConcurrencyLimiter

`ConcurrencyLimiter` is a queue-based semaphore preventing API overload.

```
limiter.all(tasks, isCancelled?)
  → Promise.all(tasks.map(task => limiter.run(task, isCancelled)))

limiter.run(fn):
  if running < maxConcurrency → increment running, execute fn
  else → enqueue a resolve callback and wait
  finally → decrement running, dequeue and start next if any
```

| Method | Semantics |
|---|---|
| `run<T>(fn, isCancelled?)` | Execute one task; queue if at limit |
| `all<T>(tasks, isCancelled?)` | `Promise.all` respecting max concurrency |
| `allSettled<T>(tasks, isCancelled?)` | `Promise.allSettled` respecting max concurrency |

`CancellationError` is thrown when `isCancelled()` returns `true` before or after acquiring a slot.

---

## Map Phase: Timeout and Retry

Each work item goes through `executeMapItem` → `executeMapItemWithTimeoutRetry` → `executeMapItemWithTimeout`:

```
Attempt 1: mapper.map(item, context) with baseTimeoutMs
  → on success: return output
  → on non-timeout error: propagate immediately
  → on timeout error: retry once with 2× timeout

Attempt 2 (timeout retry): mapper.map(item, context) with 2 × baseTimeoutMs
  → success or failure: final result (no further retry)

Separate retryOnFailure loop (wraps the above):
  maxAttempts = retryOnFailure ? retryAttempts + 1 : 1
  between attempts: exponential backoff (1 000 ms × attempt index)
```

Progress is reported after each item completes. `onItemComplete` callback is invoked for both successes and failures, enabling incremental disk writes (used by deep-wiki analysis cache).

---

## Splitters

### `ChunkSplitter`

Divides a single text into overlapping `ChunkWorkItemData` work items.

| Option | Default | Description |
|---|---|---|
| `maxChunkSize` | 4 000 chars | Maximum size per chunk |
| `overlapSize` | 200 chars | Overlap between consecutive chunks |
| `strategy` | `'character'` | `'character'` \| `'line'` \| `'paragraph'` \| `'sentence'` |
| `preserveBoundaries` | `true` | Avoid splitting at mid-word/mid-line |

Factory helpers: `createChunkSplitter()`, `createLineChunkSplitter()`, `createParagraphChunkSplitter()`.

### `FileSplitter`

Maps a `FileInput` (array of `FileItem`) to one work item per file. Supports a `filter` predicate and optional ID generator.

### `RuleSplitter`

Produces one `RuleWorkItemData` per `Rule` object, pairing each rule with a shared `targetContent` (e.g., a git diff). Used by `CodeReviewJob` to fan out review rules in parallel.

---

## Reducers

### `DeterministicReducer<T>`

Pure code-based deduplication. Accepts a `getKey` function, a `merge` function for duplicates, an optional `sort` comparator, and an optional `summarize` callback.

```typescript
interface DeterministicReducerOptions<T> {
    getKey: (item: T) => string;
    merge: (existing: T, newItem: T) => T;
    sort?: (a: T, b: T) => number;
    summarize?: (items: T[]) => Record<string, unknown>;
}
```

Convenience subclasses: `StringDeduplicationReducer`, `NumericAggregationReducer`.

### `AIReducer<TMapOutput, TReduceOutput>`

Calls AI once to synthesize all successful map outputs. Falls back to a deterministic reducer on AI failure.

```typescript
interface AIReducerOptions<TMapOutput, TReduceOutput> {
    aiInvoker: AIInvoker;
    buildPrompt: (outputs: TMapOutput[], context: ReduceContext) => string;
    parseResponse: (response: string, originalOutputs: TMapOutput[]) => TReduceOutput;
    fallbackReducer: BaseReducer<TMapOutput, TReduceOutput>;
    model?: string;
}
```

Factory: `createTextSynthesisReducer(options)` — combines multiple text outputs into `{ summary, keyPoints, originalCount }`.

### `HybridReducer`

Runs the deterministic reducer first, then optionally invokes AI for a second synthesis pass based on `ReduceMode`.

---

## Built-in Jobs

### `PromptMapJob` (most-used)

The primary job type consumed by YAML pipelines. One prompt-per-item fan-out with pluggable output formats.

**Type flow:** `PromptMapInput → PromptWorkItemData → PromptMapResult → PromptMapOutput`

```typescript
interface PromptMapInput {
    items: PromptItem[];           // CSV rows or any key-value records
    promptTemplate: string;        // {{variable}} placeholders; {{ITEMS}} = full JSON array
    outputFields: string[];        // expected JSON keys in AI response (empty = text mode)
}
```

**Output formats** (`OutputFormat`):

| Format | Description |
|---|---|
| `'list'` | Markdown list (default) |
| `'table'` | Markdown table |
| `'json'` | JSON array of `{input, output, success}` objects |
| `'csv'` | CSV with input and output columns |
| `'text'` | Raw text concatenation (no JSON parsing) |
| `'ai'` | Additional AI synthesis pass over map results |

For `'ai'` format, the reduce prompt supports template variables:
- `{{RESULTS}}` — all successful map outputs as JSON
- `{{RESULTS_FILE}}` — path to a temp JSON file (avoids shell escaping on Windows)
- `{{COUNT}}`, `{{SUCCESS_COUNT}}`, `{{FAILURE_COUNT}}` — statistics
- Any custom parameter from `aiReduceParameters`

Factory: `createPromptMapJob(options)` / `createPromptMapInput(items, template, fields)`.

### `CodeReviewJob`

Wraps `RuleSplitter` + a custom mapper that reviews a diff against each rule, producing `ReviewFinding[]` items. The reducer uses `DeterministicReducer` to deduplicate findings by ID.

```typescript
interface ReviewFinding {
    id: string;
    severity: 'error' | 'warning' | 'info' | 'suggestion';
    rule: string;
    ruleFile?: string;
    file?: string;
    line?: number;
    description: string;
    codeSnippet?: string;
    suggestion?: string;
}
```

### `TemplateJob`

A thin wrapper that wires together a user-supplied splitter, mapper function, and reducer from a declarative `TemplateJobConfig` without requiring a full class hierarchy.

---

## ProcessTracker Integration

When an optional `ProcessTracker` is injected into `ExecutorOptions`, the executor registers each map item and the group in the AI process manager for VS Code tree-view visibility:

```
registerGroup(jobName)          → groupId
  for each item:
    registerProcess(description, groupId)  → processId
    map(item) → success/failure
    updateProcess(processId, 'completed' | 'failed', ...)
    attachSessionMetadata(processId, { sessionId, backend })  // enables session resume
  completeGroup(groupId, summary, executionStats)
```

The `onItemComplete` callback is also used for incremental caching — deep-wiki writes per-component analysis to disk immediately after each successful map, so interrupted runs resume from the last cached item.

---

## Progress Reporting

`JobProgress` events are emitted via `onProgress` callback at key milestones:

| Phase | Trigger |
|---|---|
| `'splitting'` | Before `splitter.split()` |
| `'mapping'` | After each item completes (`percentage` 0–85%) |
| `'reducing'` | After map phase completes |
| `'complete'` | After reduce phase completes |

---

## Error Handling

- **Split failure** → immediately returns a failed `MapReduceResult` with `success: false`.
- **Map item failure** → captured in `MapResult.success = false`, does not abort sibling items.
- **Timeout** → retried once at 2× timeout; final failure captured in `MapResult.error`.
- **Cancellation** → `CancellationError` propagates from `ConcurrencyLimiter`; already-started items complete; pending items receive `error: 'Operation cancelled'`.
- **Reduce failure** → returns partial `MapReduceResult` including all map results with `success: false`.
- **AI reduce failure** → `AIReducer` falls back to its `fallbackReducer` automatically.

---

## Usage

### Minimal usage

```typescript
import { createExecutor, createPromptMapJob, createPromptMapInput } from '@plusplusoneplusplus/pipeline-core';

const executor = createExecutor({
    aiInvoker: myAIInvoker,   // (prompt, opts) => Promise<AIInvokerResult>
    maxConcurrency: 5,
    reduceMode: 'deterministic',
    showProgress: true,
    retryOnFailure: false
});

const job = createPromptMapJob({
    aiInvoker: myAIInvoker,
    outputFormat: 'json',
    maxConcurrency: 5
});

const input = createPromptMapInput(
    [{ title: 'Bug #1', description: 'App crashes' }],
    'Analyze: {{title}}\n{{description}}\nReturn severity and category.',
    ['severity', 'category']
);

const result = await executor.execute(job, input);
console.log(result.output?.formattedOutput);
```

### With process tracking and cancellation

```typescript
import { createExecutor, createCodeReviewJob } from '@plusplusoneplusplus/pipeline-core';

let cancelled = false;

const executor = createExecutor({
    aiInvoker: myAIInvoker,
    maxConcurrency: 3,
    reduceMode: 'deterministic',
    showProgress: true,
    retryOnFailure: false,
    processTracker: myProcessTracker,
    isCancelled: () => cancelled,
    onProgress: (p) => console.log(`${p.phase}: ${p.percentage}%`)
});

const job = createCodeReviewJob({ aiInvoker: myAIInvoker });
const result = await executor.execute(job, { rules, targetContent: diff });
```

---

## Consumers

| Consumer | Splitter used | Job used |
|---|---|---|
| `packages/pipeline-core/src/pipeline/` (YAML pipeline executor) | `PromptMapSplitter` (internal) | `PromptMapJob` |
| `src/shortcuts/code-review/` (VS Code extension) | `RuleSplitter` | `CodeReviewJob` |
| `packages/deep-wiki/src/analysis/` (component analysis) | Custom per-component splitter | Custom mapper with `onItemComplete` cache hook |
| `packages/deep-wiki/src/writing/` (article writing) | Custom article splitter | Custom mapper |
