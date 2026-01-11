# Map-Reduce Module - Developer Reference

This module provides a reusable framework for AI map-reduce workflows. It enables parallel AI processing with configurable splitters, mappers, reducers, and prompt templates.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Input Data                                 │
│  (Files, Rules, Text chunks, Custom items)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Split
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Splitters                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │FileSplitter │  │ChunkSplitter│  │ RuleSplitter│             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Work Items
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MapReduceExecutor                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Concurrency Limiter                            ││
│  │  - Controls parallel execution (default: 5)                 ││
│  │  - Prevents API rate limiting                               ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Mapper                                   ││
│  │  - Processes each work item with AI                         ││
│  │  - Uses prompt templates                                    ││
│  │  - Tracks progress via ProcessTracker                       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Map Results
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Reducers                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │DeterministicReduc│  │   AIReducer      │  │ HybridReducer │ │
│  │(Merge, Dedup)    │  │ (AI synthesis)   │  │(Determ + AI)  │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Final Output
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MapReduceResult                              │
│  { output, mapResults, executionStats, reduceStats }            │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### MapReduceExecutor

The main executor that orchestrates the map-reduce pipeline.

```typescript
import { MapReduceExecutor, createExecutor } from '../map-reduce';

// Create executor with options
const executor = createExecutor({
    maxConcurrency: 5,
    timeoutMs: 60000,
    retryOnFailure: true,
    retryAttempts: 2,
    processTracker: myProcessTracker,
    onProgress: (progress) => {
        console.log(`${progress.phase}: ${progress.percentage}%`);
    }
});

// Execute a job
const result = await executor.execute(myJob, inputData);

if (result.success) {
    console.log('Output:', result.output);
    console.log('Stats:', result.executionStats);
}
```

### Splitters

Split input data into work items for parallel processing.

```typescript
import { 
    createFileSplitter,
    createChunkSplitter,
    createRuleSplitter 
} from '../map-reduce';

// File splitter - split directory into file items
const fileSplitter = createFileSplitter({
    extensions: ['.ts', '.js'],
    excludePatterns: ['**/node_modules/**']
});

// Chunk splitter - split text into chunks
const chunkSplitter = createChunkSplitter({
    maxChunkSize: 4000,
    overlap: 200
});

// Rule splitter - split rules for parallel review
const ruleSplitter = createRuleSplitter({
    sortBy: 'priority'
});
```

### Reducers

Combine map results into final output.

```typescript
import {
    DeterministicReducer,
    AIReducer,
    HybridReducer,
    createDeterministicReducer,
    createAIReducer,
    createHybridReducer
} from '../map-reduce';

// Deterministic reducer - pure function aggregation
const deterministicReducer = createDeterministicReducer({
    deduplicateBy: 'id',
    sortBy: 'severity'
});

// AI reducer - use AI to synthesize results
const aiReducer = createAIReducer({
    promptTemplate: 'Summarize these findings: {{results}}',
    aiInvoker: copilotInvoker
});

// Hybrid reducer - deterministic first, then AI polish
const hybridReducer = createHybridReducer({
    deterministicOptions: { deduplicateBy: 'id' },
    aiOptions: { promptTemplate: '...' }
});
```

### Prompt Templates

Reusable prompt templates with variable substitution.

```typescript
import { 
    createTemplate, 
    renderTemplate, 
    extractVariables,
    validateTemplate 
} from '../map-reduce';

// Create a template
const template = createTemplate(`
Review this {{language}} code for {{ruleName}}:

\`\`\`{{language}}
{{code}}
\`\`\`

Focus on: {{focusAreas}}
`);

// Extract variables
const vars = extractVariables(template);
// ['language', 'ruleName', 'code', 'focusAreas']

// Validate template has all required variables
const isValid = validateTemplate(template, {
    language: 'TypeScript',
    ruleName: 'Security',
    code: 'const x = 1;',
    focusAreas: 'injection vulnerabilities'
});

// Render template
const prompt = renderTemplate(template, {
    language: 'TypeScript',
    ruleName: 'Security',
    code: 'const x = 1;',
    focusAreas: 'injection vulnerabilities'
});
```

### Pre-built Jobs

Ready-to-use job configurations.

```typescript
import { 
    createCodeReviewJob,
    createTemplateJob,
    createPromptMapJob 
} from '../map-reduce';

// Code review job
const reviewJob = createCodeReviewJob({
    rules: loadedRules,
    metadata: { type: 'commit', commitSha: 'abc123' },
    aiInvoker: copilotInvoker
});

// Generic template job
const templateJob = createTemplateJob({
    promptTemplate: 'Analyze: {{item}}',
    aiInvoker: copilotInvoker
});

// Prompt map job - process list of prompts
const promptMapJob = createPromptMapJob({
    aiInvoker: copilotInvoker,
    outputFormat: 'json'
});
```

## Usage Examples

### Example 1: Parallel Code Review

```typescript
import { createExecutor, createCodeReviewJob } from '../map-reduce';

async function reviewCommit(
    commitHash: string,
    rules: CodeRule[],
    aiInvoker: AIInvoker,
    processManager: AIProcessManager
) {
    // Create process tracker
    const tracker = createProcessTracker(processManager);
    
    // Create executor
    const executor = createExecutor({
        maxConcurrency: 3,
        processTracker: tracker,
        onProgress: updateProgressUI
    });
    
    // Create job
    const job = createCodeReviewJob({
        rules,
        metadata: { type: 'commit', commitSha: commitHash },
        aiInvoker
    });
    
    // Execute
    const result = await executor.execute(job, { commitHash, rules });
    
    return result;
}
```

### Example 2: Custom Map-Reduce Job

```typescript
import { 
    MapReduceJob,
    WorkItem,
    Splitter,
    Mapper,
    Reducer
} from '../map-reduce';

// Define work item data type
interface MyWorkItemData {
    filePath: string;
    content: string;
}

// Create splitter
const mySplitter: Splitter<string[], MyWorkItemData> = {
    split(input: string[]): WorkItem<MyWorkItemData>[] {
        return input.map((filePath, index) => ({
            id: `item-${index}`,
            data: {
                filePath,
                content: fs.readFileSync(filePath, 'utf-8')
            }
        }));
    }
};

// Create mapper
const myMapper: Mapper<MyWorkItemData, string> = {
    async map(item, context): Promise<string> {
        const prompt = `Analyze ${item.data.filePath}:\n${item.data.content}`;
        const result = await aiInvoker.invoke({ prompt });
        return result.response;
    }
};

// Create reducer
const myReducer: Reducer<string, string[]> = {
    async reduce(results, context) {
        const outputs = results
            .filter(r => r.success)
            .map(r => r.output!);
        
        return {
            output: outputs,
            stats: {
                inputCount: results.length,
                outputCount: outputs.length,
                mergedCount: 0,
                reduceTimeMs: 0,
                usedAIReduce: false
            }
        };
    }
};

// Create and execute job
const job: MapReduceJob<string[], MyWorkItemData, string, string[]> = {
    name: 'my-analysis',
    splitter: mySplitter,
    mapper: myMapper,
    reducer: myReducer
};

const result = await executor.execute(job, filePaths);
```

### Example 3: Processing with Progress Tracking

```typescript
const executor = createExecutor({
    maxConcurrency: 5,
    processTracker: {
        registerProcess(description, parentId) {
            return processManager.registerTypedProcess(description, {
                type: 'analysis',
                parentProcessId: parentId
            });
        },
        updateProcess(id, status, response, error, structuredResult) {
            processManager.updateProcess(id, status, response, error);
        },
        registerGroup(description) {
            return processManager.registerProcessGroup(description, {
                type: 'analysis-group'
            });
        },
        completeGroup(groupId, summary, stats) {
            processManager.completeProcessGroup(groupId, {
                result: summary,
                executionStats: stats
            });
        }
    },
    onProgress: (progress) => {
        vscode.window.setStatusBarMessage(
            `${progress.phase}: ${progress.completedItems}/${progress.totalItems}`
        );
    }
});
```

### Example 4: Batched Processing

```typescript
import { createBatchedFileSplitter, createBatchedRuleSplitter } from '../map-reduce';

// Process files in batches of 3
const batchedFileSplitter = createBatchedFileSplitter({
    batchSize: 3,
    extensions: ['.ts']
});

// Process rules in batches
const batchedRuleSplitter = createBatchedRuleSplitter({
    batchSize: 2
});
```

## Types

### MapReduceJob

```typescript
interface MapReduceJob<TInput, TWorkItemData, TMapOutput, TReduceOutput> {
    /** Job name for identification */
    name: string;
    /** Splits input into work items */
    splitter: Splitter<TInput, TWorkItemData>;
    /** Processes each work item */
    mapper: Mapper<TWorkItemData, TMapOutput>;
    /** Combines map results */
    reducer: Reducer<TMapOutput, TReduceOutput>;
    /** Optional job-specific options */
    options?: MapReduceOptions;
}
```

### MapReduceResult

```typescript
interface MapReduceResult<TMapOutput, TReduceOutput> {
    /** Overall success status */
    success: boolean;
    /** Final reduced output */
    output?: TReduceOutput;
    /** Individual map results */
    mapResults: MapResult<TMapOutput>[];
    /** Reduce phase statistics */
    reduceStats?: ReduceStats;
    /** Total execution time */
    totalTimeMs: number;
    /** Execution statistics */
    executionStats: ExecutionStats;
    /** Error message if failed */
    error?: string;
}
```

### ExecutionStats

```typescript
interface ExecutionStats {
    /** Total work items processed */
    totalItems: number;
    /** Successfully mapped items */
    successfulMaps: number;
    /** Failed map operations */
    failedMaps: number;
    /** Time spent in map phase */
    mapPhaseTimeMs: number;
    /** Time spent in reduce phase */
    reducePhaseTimeMs: number;
    /** Concurrency limit used */
    maxConcurrency: number;
}
```

### ProcessTracker

```typescript
interface ProcessTracker {
    /** Register a new process */
    registerProcess(description: string, parentGroupId?: string): string;
    /** Update process status */
    updateProcess(
        processId: string,
        status: 'running' | 'completed' | 'failed',
        response?: string,
        error?: string,
        structuredResult?: string
    ): void;
    /** Register a process group */
    registerGroup(description: string): string;
    /** Complete a process group */
    completeGroup(groupId: string, summary: string, stats: ExecutionStats): void;
}
```

## Best Practices

1. **Set appropriate concurrency**: Balance speed vs API rate limits.

2. **Use batching for large inputs**: Batch splitters reduce overhead.

3. **Handle failures gracefully**: Use retry options for transient failures.

4. **Track progress**: Provide ProcessTracker for UI feedback.

5. **Choose the right reducer**: 
   - Deterministic for simple aggregation
   - AI for synthesis/summarization
   - Hybrid for both

6. **Validate templates**: Use `validateTemplate` before execution.

## See Also

- `src/shortcuts/ai-service/AGENTS.md` - AI process tracking integration
- `src/shortcuts/code-review/AGENTS.md` - Code review using map-reduce
- `src/shortcuts/yaml-pipeline/AGENTS.md` - YAML configuration layer
- `docs/designs/map-reduce-framework.md` - Design documentation
