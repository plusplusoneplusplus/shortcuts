# R9: Refactor `executeAnalysisRound()` — 11 Parameters → Options Object

## Problem

`executeAnalysisRound()` in `packages/deep-wiki/src/analysis/analysis-executor.ts` (line 188) has 11 positional parameters, making call sites hard to read and maintain.

```typescript
async function executeAnalysisRound(
    modules: ModuleInfo[],
    graph: ModuleGraph,
    aiInvoker: AIInvoker,
    promptTemplate: string,
    outputFields: string[],
    concurrency: number,
    timeoutMs: number | undefined,
    model: string | undefined,
    onProgress: ((progress: JobProgress) => void) | undefined,
    isCancelled: (() => boolean) | undefined,
    onItemComplete: ItemCompleteCallback | undefined,
): Promise<{ analyses: ModuleAnalysis[]; failedModuleIds: string[] }>
```

## Approach

1. Create an `AnalysisRoundOptions` interface
2. Update function signature to accept single options object
3. Update both call sites (lines ~142 and ~160 in the same file)

## File Changes

### 1. Add interface in `analysis-executor.ts` (or in `types.ts`)

```typescript
interface AnalysisRoundOptions {
    modules: ModuleInfo[];
    graph: ModuleGraph;
    aiInvoker: AIInvoker;
    promptTemplate: string;
    outputFields: string[];
    concurrency: number;
    timeoutMs?: number;
    model?: string;
    onProgress?: (progress: JobProgress) => void;
    isCancelled?: () => boolean;
    onItemComplete?: ItemCompleteCallback;
}
```

Since `executeAnalysisRound` is a private function (not exported), the interface can stay local to the file.

### 2. Update function signature

**Before:**
```typescript
async function executeAnalysisRound(
    modules: ModuleInfo[],
    graph: ModuleGraph,
    // ... 9 more params
): Promise<{ analyses: ModuleAnalysis[]; failedModuleIds: string[] }>
```

**After:**
```typescript
async function executeAnalysisRound(
    options: AnalysisRoundOptions
): Promise<{ analyses: ModuleAnalysis[]; failedModuleIds: string[] }>
```

Destructure at function start:
```typescript
const { modules, graph, aiInvoker, promptTemplate, outputFields, concurrency, timeoutMs, model, onProgress, isCancelled, onItemComplete } = options;
```

### 3. Update call sites

There are **2 call sites**, both in `runAnalysisExecutor()` within the same file.

**Before (line ~142):**
```typescript
const result = await executeAnalysisRound(
    modulesToAnalyze, graph, aiInvoker, promptTemplate,
    outputFields, concurrency, timeoutMs, model,
    onProgress, isCancelled, onItemComplete
);
```

**After:**
```typescript
const result = await executeAnalysisRound({
    modules: modulesToAnalyze, graph, aiInvoker, promptTemplate,
    outputFields, concurrency, timeoutMs, model,
    onProgress, isCancelled, onItemComplete,
});
```

Similarly update the retry call site (line ~160).

## Tests

### Existing: `test/analysis/analysis-executor.test.ts`

All existing tests must pass unchanged. Since `executeAnalysisRound` is a private function, tests interact through the public `runAnalysisExecutor`, which is unchanged.

No new tests needed.

## Validation

```bash
cd packages/deep-wiki && npm run build && npm run test:run
```

## Impact

Purely a readability improvement. Makes parameter ordering irrelevant and makes optional params clearer at call sites.
