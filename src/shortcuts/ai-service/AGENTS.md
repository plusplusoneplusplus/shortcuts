# AI Service Module - Developer Reference

This module provides a generic, domain-agnostic service for tracking AI processes. It is designed to be used by any feature that needs to invoke AI tools and track their execution.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Feature Modules                          │
│  (code-review, discovery, clarification, your-new-feature)     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Uses adapter pattern
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AI Service Module                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ AIProcessManager│  │ Copilot Invoker │  │  Tree Provider  │ │
│  │  (Generic API)  │  │   (AI Tools)    │  │    (UI View)    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Key Interfaces

### GenericProcessMetadata

Base interface for feature-specific metadata. Feature modules should extend this for their own needs.

```typescript
interface GenericProcessMetadata {
    /** Type identifier for the metadata */
    type: string;
    /** Feature-specific data stored as key-value pairs */
    [key: string]: unknown;
}
```

### GenericGroupMetadata

For grouped/parallel processes that have child processes.

```typescript
interface GenericGroupMetadata extends GenericProcessMetadata {
    /** Child process IDs in this group */
    childProcessIds: string[];
}
```

### TypedProcessOptions

Options for registering a typed process.

```typescript
interface TypedProcessOptions {
    /** The process type identifier (e.g., 'my-feature') */
    type: AIProcessType;
    /** ID prefix for generated process IDs (e.g., 'myfeature' -> 'myfeature-1-timestamp') */
    idPrefix?: string;
    /** Feature-specific metadata */
    metadata?: GenericProcessMetadata;
    /** Parent process ID for grouped processes */
    parentProcessId?: string;
}
```

### ProcessGroupOptions

Options for registering a process group.

```typescript
interface ProcessGroupOptions {
    /** The group type identifier */
    type: AIProcessType;
    /** ID prefix for generated group IDs */
    idPrefix?: string;
    /** Feature-specific metadata */
    metadata?: Omit<GenericGroupMetadata, 'childProcessIds'>;
}
```

## Basic Usage Examples

### Example 1: Simple Process Tracking

Track a single AI invocation for a custom feature:

```typescript
import { AIProcessManager } from '../ai-service';

// Get the process manager (typically injected or from extension context)
const processManager: AIProcessManager = /* ... */;

// Register a process
const processId = processManager.registerTypedProcess(
    'Analyze code for security vulnerabilities',
    {
        type: 'security-scan',
        idPrefix: 'security',
        metadata: {
            type: 'security-scan',
            targetFile: 'src/auth/login.ts',
            scanType: 'full'
        }
    }
);

// Later, when the AI responds...
processManager.updateProcess(processId, 'completed', 'No vulnerabilities found');

// Or if it fails...
processManager.updateProcess(processId, 'failed', undefined, 'Timeout exceeded');
```

### Example 2: Parallel Process Group

Track multiple parallel AI invocations (e.g., reviewing multiple files):

```typescript
import { AIProcessManager } from '../ai-service';

const processManager: AIProcessManager = /* ... */;

// 1. Register the parent group
const groupId = processManager.registerProcessGroup(
    'Analyzing 5 files for performance issues',
    {
        type: 'perf-analysis-group',
        idPrefix: 'perf-group',
        metadata: {
            type: 'perf-analysis-group',
            totalFiles: 5,
            analysisType: 'performance'
        }
    }
);

// 2. Register child processes for each file
const childIds: string[] = [];
for (const file of filesToAnalyze) {
    const childId = processManager.registerTypedProcess(
        `Analyzing ${file}`,
        {
            type: 'perf-analysis',
            idPrefix: 'perf',
            metadata: {
                type: 'perf-analysis',
                file: file
            },
            parentProcessId: groupId  // Link to parent
        }
    );
    childIds.push(childId);
}

// 3. As each child completes, update it
processManager.updateProcess(childIds[0], 'completed', 'Found 2 issues');

// 4. When all children complete, complete the group
processManager.completeProcessGroup(groupId, {
    result: 'Analysis complete: 5 issues found across 5 files',
    structuredResult: JSON.stringify({ totalIssues: 5, byFile: { /* ... */ } }),
    executionStats: {
        totalFiles: 5,
        successfulAnalyses: 5,
        failedAnalyses: 0,
        totalTimeMs: 12500
    }
});
```

### Example 3: Creating a Feature Adapter

For features that need more structure, create an adapter:

```typescript
// my-feature/process-adapter.ts
import { AIProcessManager, GenericProcessMetadata } from '../ai-service';

// Define your feature's metadata type
export interface MyFeatureMetadata {
    featureField1: string;
    featureField2: number;
}

// Define constants
export const MY_FEATURE_TYPE = 'my-feature';

// Create an adapter class
export class MyFeatureProcessAdapter {
    constructor(private readonly processManager: AIProcessManager) {}

    registerProcess(prompt: string, data: MyFeatureMetadata): string {
        return this.processManager.registerTypedProcess(prompt, {
            type: MY_FEATURE_TYPE,
            idPrefix: 'myfeature',
            metadata: {
                type: MY_FEATURE_TYPE,
                ...data
            }
        });
    }

    completeProcess(id: string, result: string): void {
        this.processManager.updateProcess(id, 'completed', result);
    }

    failProcess(id: string, error: string): void {
        this.processManager.updateProcess(id, 'failed', undefined, error);
    }
}

// Usage in your feature:
const adapter = new MyFeatureProcessAdapter(processManager);
const id = adapter.registerProcess('Do something', {
    featureField1: 'value',
    featureField2: 42
});
```

### Example 4: Integration with Map-Reduce Framework

For parallel AI workflows using the map-reduce framework:

```typescript
import { AIProcessManager } from '../ai-service';
import { ProcessTracker, ExecutionStats } from '../map-reduce';

// Create a ProcessTracker that bridges to AIProcessManager
function createMyFeatureTracker(
    processManager: AIProcessManager
): ProcessTracker {
    return {
        registerProcess(description: string, parentGroupId?: string): string {
            return processManager.registerTypedProcess(description, {
                type: 'my-feature-item',
                parentProcessId: parentGroupId
            });
        },

        updateProcess(
            processId: string,
            status: 'running' | 'completed' | 'failed',
            response?: string,
            error?: string
        ): void {
            processManager.updateProcess(processId, status, response, error);
        },

        registerGroup(description: string): string {
            return processManager.registerProcessGroup(description, {
                type: 'my-feature-group'
            });
        },

        completeGroup(groupId: string, summary: string, stats: ExecutionStats): void {
            processManager.completeProcessGroup(groupId, {
                result: summary,
                structuredResult: JSON.stringify(stats),
                executionStats: {
                    total: stats.totalItems,
                    successful: stats.successfulMaps,
                    failed: stats.failedMaps
                }
            });
        }
    };
}
```

## AI Tool Invocation

### Using Copilot CLI

```typescript
import { invokeCopilotCLI, getAIToolSetting } from '../ai-service';

// Check which tool is configured
const tool = getAIToolSetting(); // 'copilot-cli' or 'clipboard'

if (tool === 'copilot-cli') {
    const result = await invokeCopilotCLI(
        'Explain this code: ...',
        '/path/to/workspace',
        processManager,  // Optional: for process tracking
        processId        // Optional: existing process ID
    );

    if (result.success) {
        console.log('Response:', result.response);
    } else {
        console.error('Error:', result.error);
    }
} else {
    // Fall back to clipboard mode
    await copyToClipboard(prompt);
}
```

## Process Lifecycle

```
┌──────────┐     ┌──────────┐     ┌───────────┐
│ Register │ ──▶ │ Running  │ ──▶ │ Completed │
└──────────┘     └──────────┘     └───────────┘
                      │                 
                      │           ┌──────────┐
                      └─────────▶ │  Failed  │
                      │           └──────────┘
                      │                 
                      │           ┌───────────┐
                      └─────────▶ │ Cancelled │
                                  └───────────┘
```

## Querying Processes

```typescript
// Get all processes
const all = processManager.getProcesses();

// Get only running processes
const running = processManager.getRunningProcesses();

// Get top-level processes (excludes children)
const topLevel = processManager.getTopLevelProcesses();

// Get a specific process
const process = processManager.getProcess(processId);

// Get child processes of a group
const children = processManager.getChildProcesses(groupId);

// Check if there are running processes
const hasRunning = processManager.hasRunningProcesses();

// Get counts by status
const counts = processManager.getProcessCounts();
// { running: 2, completed: 10, failed: 1, cancelled: 0 }
```

## Events

Subscribe to process changes:

```typescript
const disposable = processManager.onDidChangeProcesses((event) => {
    switch (event.type) {
        case 'process-added':
            console.log('New process:', event.process?.id);
            break;
        case 'process-updated':
            console.log('Updated:', event.process?.id, event.process?.status);
            break;
        case 'process-removed':
            console.log('Removed:', event.process?.id);
            break;
        case 'processes-cleared':
            console.log('All processes cleared');
            break;
    }
});

// Don't forget to dispose when done
disposable.dispose();
```

## Best Practices

1. **Use meaningful type identifiers**: Choose descriptive `type` values like `'code-review'`, `'security-scan'`, `'doc-generation'`.

2. **Use the adapter pattern**: For complex features, create an adapter class that encapsulates the AIProcessManager calls.

3. **Store structured results**: Use `structuredResult` for machine-readable data (JSON), and `result` for human-readable summaries.

4. **Group related processes**: Use `registerProcessGroup` and `parentProcessId` for parallel operations.

5. **Handle failures gracefully**: Always handle the failed state and provide meaningful error messages.

6. **Clean up**: Call `dispose()` on the process manager when the extension deactivates.

## Migration from Legacy API

If you're using the legacy code-review-specific methods, consider migrating:

| Legacy Method | Generic Replacement |
|--------------|---------------------|
| `registerCodeReviewProcess()` | `registerTypedProcess()` with `type: 'code-review'` |
| `registerCodeReviewGroup()` | `registerProcessGroup()` with `type: 'code-review-group'` |
| `completeCodeReviewGroup()` | `completeProcessGroup()` |

The legacy methods are still available but marked as `@deprecated`.

## See Also

- `src/shortcuts/code-review/process-adapter.ts` - Reference implementation of the adapter pattern
- `src/shortcuts/map-reduce/` - Map-reduce framework for parallel AI workflows
- `src/test/suite/ai-service-code-review-coupling.test.ts` - Test examples
