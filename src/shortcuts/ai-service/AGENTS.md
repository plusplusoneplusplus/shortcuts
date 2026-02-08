# AI Service Module - Developer Reference

This module provides a generic, domain-agnostic service for tracking AI processes. It is designed to be used by any feature that needs to invoke AI tools and track their execution.

**Major Updates (2026-01):**
- **Pipeline Core Extraction:** Core AI functionality (CopilotSDKService, session pool, CLI utilities) moved to `pipeline-core` package
- Added GitHub Copilot SDK support as primary AI backend
- Created unified AI invoker factory with automatic SDK/CLI fallback
- Session pool for parallel workloads (code review, pipelines)
- Eliminated ~450 lines of duplicated backend selection code
- **Task Queue System:** Priority-based task queuing with VS Code integration
- **Interactive Sessions:** Management of interactive CLI sessions in external terminals

**Package Structure:**
- `pipeline-core` - Pure Node.js core (CopilotSDKService, SessionPool, CLI utils, TaskQueueManager)
- `src/shortcuts/ai-service/` - VS Code integration layer (AIProcessManager, tree provider, queue service, commands)

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
│  │ AIProcessManager│  │ AI Invoker      │  │  Tree Provider  │ │
│  │  (Generic API)  │  │ Factory (2026)  │  │    (UI View)    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Queue Service   │  │ Interactive     │  │ Session Pool    │ │
│  │ (Priority Queue)│  │ Session Manager │  │ (for parallel)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Copilot SDK     │  │ Copilot CLI     │  │ Process Monitor │ │
│  │ Service (2026)  │  │ Invoker         │  │ (Auto-terminate) │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    pipeline-core Package                        │
│  (TaskQueueManager, QueueExecutor, CopilotSDKService, etc.)     │
└─────────────────────────────────────────────────────────────────┘
```

## Module Files

This section lists all files in the `ai-service` module and their responsibilities:

### Core Process Management
- **ai-process-manager.ts** - Process lifecycle management with persistence. Handles process registration, updates, grouping, and state persistence via VSCode's Memento API. Provides generic API for any feature to track AI processes.

- **ai-process-tree-provider.ts** - Tree view provider with sections for processes, sessions, and queued tasks. Displays running/completed/failed processes, active/ended interactive sessions, and queued tasks in a hierarchical view.

- **ai-process-document-provider.ts** - Virtual document provider for read-only process viewing. Enables opening process details in a VS Code editor using `ai-process:` URI scheme.

### AI Invocation
- **ai-invoker-factory.ts** - Unified AI invoker factory (SDK/CLI/clipboard fallback). Automatically selects backend based on settings and handles fallback chain. Eliminates ~450 lines of duplicated backend selection code.

- **copilot-cli-invoker.ts** - CLI invocation and config helpers. Handles GitHub Copilot CLI execution, config file management, and clipboard fallback.

### Task Queue System
- **ai-queue-service.ts** - VS Code adapter for pipeline-core's TaskQueueManager. Wraps TaskQueueManager and QueueExecutor, integrates with AIProcessManager for tracking, provides VS Code events and settings integration.

- **ai-queue-commands.ts** - Queue management commands (pause, resume, clear, cancel, reorder). Registers VS Code commands for queue control: `shortcuts.queue.pauseQueue`, `shortcuts.queue.resumeQueue`, `shortcuts.queue.clearQueue`, `shortcuts.queue.cancelTask`, `shortcuts.queue.moveToTop`, `shortcuts.queue.moveUp`, `shortcuts.queue.moveDown`.

- **ai-queue-status-bar.ts** - Status bar showing queue state. Displays running/queued counts with spinning icon when executing, shows paused state, hides when empty.

- **queued-task-tree-item.ts** - Tree items for queued tasks. Custom tree items displaying task details, priority, position, and status in the tree view.

### Interactive Sessions
- **interactive-session-manager.ts** - Interactive CLI session management. Manages lifecycle of interactive AI CLI sessions in external terminals, tracks session state (starting, active, ended, error), integrates with ProcessMonitor for automatic termination detection.

- **interactive-session-tree-item.ts** - Tree items for interactive sessions. Custom tree items displaying session details, status, working directory, and tool type in the tree view.

- **process-monitor.ts** - Process monitoring wrapper. Monitors external terminal processes and automatically detects termination, notifies session manager when processes end.

### Configuration & Commands
- **ai-config-helpers.ts** - VS Code settings accessors. Helper functions to read AI service configuration from VS Code settings (backend, model, timeout, etc.).

- **ai-command-registry.ts** - Singleton registry for configurable AI commands. Manages dynamic AI commands that can be configured via settings, supports command templates and parameter substitution.

- **ai-command-types.ts** - Re-exports from pipeline-core. Type definitions for AI commands shared between VS Code extension and pipeline-core.

### Utilities
- **prompt-builder.ts** - Prompt building with template variable substitution. Builds prompts from templates with variable replacement (e.g., `{{filePath}}`, `{{selectedText}}`).

- **external-terminal-launcher.ts** - Re-export from pipeline-core. Launches external terminals for interactive CLI sessions, supports multiple terminal types (Terminal.app, iTerm, Windows Terminal, etc.).

- **window-focus-service.ts** - Re-export from pipeline-core. Service for managing window focus when launching external terminals.

- **ai-service-logger.ts** - Backward compat re-exports (deprecated). Legacy logger exports for backward compatibility, new code should use pipeline-core logger.

- **types.ts** - Re-exports + VS Code-specific types. Type definitions for the module, re-exports from pipeline-core, and VS Code-specific extensions.

### Testing & Exports
- **mock-ai-process-manager.ts** - Mock for testing. Mock implementation of AIProcessManager for unit tests.

- **index.ts** - Module exports. Main entry point exporting all public APIs from the module.

## Task Queue System

The task queue system provides priority-based queuing and execution of AI tasks. It wraps `pipeline-core`'s `TaskQueueManager` and `QueueExecutor` with VS Code integration.

### Overview

The `AIQueueService` wraps `pipeline-core`'s `TaskQueueManager` and `QueueExecutor` to provide:
- Priority-based task ordering (high, normal, low)
- Integration with `AIProcessManager` for process tracking
- VS Code event emitters for queue changes
- Configuration via VS Code settings
- Automatic execution with configurable concurrency

### Basic Usage

```typescript
import { getAIQueueService } from '../ai-service';

const queueService = getAIQueueService();
if (!queueService) {
    return; // Queue service not initialized
}

// Queue a task
const result = queueService.queueTask({
    type: 'follow-prompt',
    payload: {
        promptFilePath: '/path/to/instruction.md',
        planFilePath: '/path/to/plan.md',
        workingDirectory: '/path/to/workspace',
        additionalContext: 'Additional context here'
    },
    priority: 'high',  // Optional: defaults to setting
    displayName: 'Follow instruction: Fix bug',
    config: {
        model: 'gpt-4',
        timeoutMs: 1800000  // 30 minutes
    }
});

console.log(`Task queued: ${result.taskId}, position: ${result.position}`);
```

### Queue Management Commands

The module provides VS Code commands for queue management:

- **`shortcuts.queue.pauseQueue`** - Pause queue processing (running tasks continue, no new tasks start)
- **`shortcuts.queue.resumeQueue`** - Resume queue processing
- **`shortcuts.queue.clearQueue`** - Clear all queued tasks (running tasks continue)
- **`shortcuts.queue.cancelTask`** - Cancel a queued or running task
- **`shortcuts.queue.moveToTop`** - Move a task to the top of the queue
- **`shortcuts.queue.moveUp`** - Move a task up one position
- **`shortcuts.queue.moveDown`** - Move a task down one position

### Status Bar Integration

The queue service automatically displays status in the VS Code status bar:
- Shows running count with spinning icon: `$(sync~spin) 2 running, 5 queued`
- Shows queued count when paused: `$(debug-pause) 5 queued (paused)`
- Shows queued count when active: `$(list-ordered) 5 queued`
- Hides when queue is empty

### Configuration

Queue behavior is controlled via VS Code settings:

```json
{
  "workspaceShortcuts.queue.enabled": true,
  "workspaceShortcuts.queue.maxConcurrency": 1,
  "workspaceShortcuts.queue.defaultPriority": "normal",
  "workspaceShortcuts.queue.notifyOnComplete": true
}
```

### Integration with AIProcessManager

Each queued task automatically registers a process in `AIProcessManager`:
- Process type: `queue-{taskType}` (e.g., `queue-follow-prompt`)
- Process ID linked to task ID via metadata
- Process status updates as task executes
- Process completion/failure tracked automatically

### Task Types

The queue supports multiple task types:

**Follow Prompt Tasks:**
```typescript
{
    type: 'follow-prompt',
    payload: {
        promptFilePath: string,
        planFilePath?: string,
        workingDirectory: string,
        additionalContext?: string
    }
}
```

**AI Clarification Tasks:**
```typescript
{
    type: 'ai-clarification',
    payload: {
        prompt: string,
        selectedText?: string,
        filePath?: string,
        workingDirectory: string,
        model?: string,
        // ... other context fields
    }
}
```

### Example: Batch Queueing

```typescript
// Queue multiple tasks at once
const batchResult = queueService.queueBatch([
    {
        type: 'follow-prompt',
        payload: { /* ... */ },
        priority: 'high',
        displayName: 'Task 1'
    },
    {
        type: 'follow-prompt',
        payload: { /* ... */ },
        priority: 'normal',
        displayName: 'Task 2'
    }
]);

console.log(`Queued ${batchResult.batchSize} tasks, total queued: ${batchResult.totalQueued}`);
```

### Queue Statistics

```typescript
const stats = queueService.getStats();
// {
//   queued: 5,
//   running: 2,
//   completed: 10,
//   failed: 1,
//   cancelled: 0,
//   isPaused: false
// }
```

## Interactive Sessions

The interactive session system manages AI CLI sessions running in external terminals. It provides lifecycle management, state tracking, and automatic termination detection.

### Overview

`InteractiveSessionManager` manages interactive AI CLI sessions:
- Launches sessions in external terminals (Terminal.app, iTerm, Windows Terminal, etc.)
- Tracks session lifecycle (starting → active → ended/error)
- Monitors processes for automatic termination detection
- Provides events for session state changes
- Integrates with tree view for session display

### Basic Usage

```typescript
import { getInteractiveSessionManager } from '../ai-service';

const sessionManager = getInteractiveSessionManager();

// Start a new interactive session
const sessionId = await sessionManager.startSession({
    workingDirectory: '/path/to/workspace',
    tool: 'copilot',  // Optional: defaults to 'copilot'
    initialPrompt: 'Explain this code',
    preferredTerminal: 'iterm'  // Optional: auto-detected if not specified
});

if (sessionId) {
    console.log(`Session started: ${sessionId}`);
} else {
    console.error('Failed to start session');
}
```

### Session Lifecycle

Sessions progress through these states:

1. **`starting`** - Session is being launched, terminal opening
2. **`active`** - Session is running, terminal is active
3. **`ended`** - Session terminated normally (user closed terminal or process ended)
4. **`error`** - Session failed to start or encountered an error

### Process Monitoring

The session manager integrates with `ProcessMonitor` to automatically detect when terminal processes terminate:

```typescript
// ProcessMonitor automatically detects when PID terminates
// and calls endSession() to update state
sessionManager.startSession({ /* ... */ });
// ... user closes terminal ...
// ProcessMonitor detects termination → sessionManager.endSession() called automatically
```

### Session Management

```typescript
// Get all sessions
const allSessions = sessionManager.getSessions();

// Get active sessions only
const activeSessions = sessionManager.getActiveSessions();

// Get ended sessions only
const endedSessions = sessionManager.getEndedSessions();

// Check if there are active sessions
if (sessionManager.hasActiveSessions()) {
    console.log('There are active AI sessions');
}

// Get session counts by status
const counts = sessionManager.getSessionCounts();
// { starting: 0, active: 2, ended: 5, error: 1 }

// End a session manually
sessionManager.endSession(sessionId);

// Remove a session from tracking
sessionManager.removeSession(sessionId);

// Rename a session with custom name
sessionManager.renameSession(sessionId, 'My Custom Session Name');

// Clear all ended sessions
sessionManager.clearEndedSessions();
```

### Events

Subscribe to session state changes:

```typescript
const disposable = sessionManager.onDidChangeSessions((event) => {
    switch (event.type) {
        case 'session-started':
            console.log('Session started:', event.session.id);
            break;
        case 'session-updated':
            console.log('Session updated:', event.session.id, event.session.status);
            break;
        case 'session-ended':
            console.log('Session ended:', event.session.id);
            break;
        case 'session-error':
            console.error('Session error:', event.session.id, event.session.error);
            break;
    }
});

// Don't forget to dispose
disposable.dispose();
```

### Tree View Integration

Sessions are displayed in the AI Processes tree view via `InteractiveSessionItem`:
- Active sessions shown with running indicator
- Ended sessions shown in collapsed section
- Error sessions shown with error icon
- Click to view session details

### Terminal Types

The system supports multiple terminal types (auto-detected or specified):

- **macOS**: `Terminal.app`, `iTerm`, `Alacritty`
- **Linux**: `gnome-terminal`, `konsole`, `xterm`, `Alacritty`
- **Windows**: `Windows Terminal`, `cmd`, `PowerShell`

### Example: Session with Custom Name

```typescript
const sessionId = await sessionManager.startSession({
    workingDirectory: workspaceRoot,
    tool: 'copilot',
    initialPrompt: 'Review the authentication code'
});

if (sessionId) {
    // Rename for better identification in tree view
    sessionManager.renameSession(sessionId, 'Auth Code Review');
}
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

### Using AI Invoker Factory (Recommended - Added 2026-01)

**New in 2026-01:** Unified factory function that handles SDK/CLI/clipboard fallback automatically. This eliminates ~450 lines of duplicated code across features.

```typescript
import { createAIInvoker, AIInvokerFactoryOptions } from '../ai-service';

// Create an AI invoker with automatic backend selection and fallback
const invoker = createAIInvoker({
    workingDirectory: workspaceRoot,
    featureName: 'My Feature',
    model: 'gpt-4',
    usePool: false,  // true for parallel workloads (code review, pipelines)
    clipboardFallback: true  // Copy to clipboard if all backends fail
});

// Use the invoker
const result = await invoker({
    prompt: 'Explain this code: ...',
    model: 'gpt-4',  // Optional: override default
    options: { timeout: 60000 }  // Optional: SDK-specific options
});

if (result.success) {
    console.log('Response:', result.response);
    // result.sessionId available if SDK was used
} else {
    console.error('Error:', result.error);
}
```

**Backend Selection:**
1. Checks `workspaceShortcuts.aiService.backend` setting
2. If `copilot-sdk`: Tries SDK → falls back to CLI on failure
3. If `copilot-cli`: Uses CLI directly
4. If `clipboard`: Copies prompt to clipboard
5. Optional clipboard fallback for user-facing features

**Use Cases:**
- `usePool: false` - One-off requests (clarification, discovery)
- `usePool: true` - Parallel workloads (code review, pipelines)
- `clipboardFallback: true` - User-facing features
- `clipboardFallback: false` - Background/automated features

### Using Copilot CLI Directly (Legacy)

For direct CLI usage without factory:

```typescript
import { invokeCopilotCLI, getAIBackendSetting } from '../ai-service';

// Check which backend is configured
const backend = getAIBackendSetting(); // 'copilot-sdk' | 'copilot-cli' | 'clipboard'

if (backend === 'copilot-cli') {
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

## Copilot SDK Integration (Added 2026-01)

The module now supports **GitHub Copilot SDK** as the primary AI backend:

### Benefits of SDK
- Native VSCode integration
- Automatic authentication
- Better performance and reliability
- Session management and cancellation
- No external process spawning

### Configuration

```json
{
  "workspaceShortcuts.aiService.backend": "copilot-sdk",  // or "copilot-cli", "clipboard"
  "workspaceShortcuts.aiService.sessionPool.enabled": true,  // for parallel workloads
  "workspaceShortcuts.aiService.sessionPool.maxSessions": 5
}
```

### Backend Selection Strategy

The `createAIInvoker()` factory automatically handles:
1. **SDK-first approach**: Try SDK if configured and available
2. **CLI fallback**: Fall back to CLI if SDK fails or unavailable
3. **Clipboard fallback**: Optionally copy to clipboard as last resort

### Session Pool for Parallel Workloads

For features with concurrent requests (code review, pipelines):

```typescript
const invoker = createAIInvoker({
    workingDirectory: workspaceRoot,
    usePool: true,  // Use session pool
    featureName: 'Code Review'
});

// Multiple concurrent invocations will reuse sessions from pool
const results = await Promise.all([
    invoker({ prompt: 'Review rule 1...' }),
    invoker({ prompt: 'Review rule 2...' }),
    invoker({ prompt: 'Review rule 3...' })
]);
```

## Migration from Legacy API

If you're using the legacy code-review-specific methods, consider migrating:

| Legacy Method | Generic Replacement |
|--------------|---------------------|
| `registerCodeReviewProcess()` | `registerTypedProcess()` with `type: 'code-review'` |
| `registerCodeReviewGroup()` | `registerProcessGroup()` with `type: 'code-review-group'` |
| `completeCodeReviewGroup()` | `completeProcessGroup()` |

The legacy methods are still available but marked as `@deprecated`.

## See Also

- `packages/pipeline-core/src/ai/` - Core AI service (CopilotSDKService, SessionPool, CLI utils)
- `packages/pipeline-core/src/queue/` - Task queue core (TaskQueueManager, QueueExecutor)
- `src/shortcuts/code-review/process-adapter.ts` - Reference implementation of the adapter pattern
- `src/shortcuts/map-reduce/` - Map-reduce framework for parallel AI workflows
- `src/shortcuts/ai-service/ai-invoker-factory.ts` - Unified AI invoker factory (2026-01)
- `src/shortcuts/ai-service/ai-queue-service.ts` - Task queue VS Code integration
- `src/shortcuts/ai-service/interactive-session-manager.ts` - Interactive session management
- `src/test/suite/ai-service-code-review-coupling.test.ts` - Test examples
