---
status: pending
---

# AI Task Queue System - Implementation Plan

## Problem Statement

Currently, when triggering AI tasks (like Follow Prompt from the Markdown Review Editor), tasks execute immediately with no queuing mechanism. Users need the ability to:
1. Queue multiple tasks for sequential execution
2. Continue working while tasks are queued and processed
3. Manage queued tasks (view, reorder, cancel)

The queue is in-memory only — it resets when VS Code restarts. This keeps the implementation simple and avoids stale queue state.

---

## Current State Analysis (Updated 2026-01-31)

### Existing Infrastructure (Strengths to Build On)

| Component | Location | Capability |
|-----------|----------|------------|
| **AIProcessManager** | `src/shortcuts/ai-service/ai-process-manager.ts` | Process tracking, parent-child relationships, persistence via Memento |
| **ConcurrencyLimiter** | `packages/pipeline-core/src/map-reduce/concurrency-limiter.ts` | Task queueing with concurrency control (`run()`, `all()`, `allSettled()`) |
| **SessionPool** | `packages/pipeline-core/src/ai/session-pool.ts` | Session management with acquire/release pattern |
| **AI Process Tree** | `src/shortcuts/ai-service/ai-process-tree-provider.ts` | Visual process tracking, hierarchical display, interactive sessions |
| **CopilotSDKService** | `packages/pipeline-core/src/ai/copilot-sdk-service.ts` | AI invocation with MCP support, permission handling |
| **InteractiveSessionManager** | `src/shortcuts/ai-service/interactive-session-manager.ts` | External terminal session management |

### Recent Refactoring (2026-01)

The codebase underwent significant refactoring:
- **Pipeline Core Extraction**: Core AI/pipeline logic extracted to `packages/pipeline-core/` as a standalone Node.js package
- **Modules in pipeline-core**: logger, utils, ai (SDK, session pool, CLI utils), map-reduce, pipeline execution
- **Tree Provider Base Classes**: New shared base classes eliminate duplication across tree providers
- All exports are available via `@plusplusoneplusplus/pipeline-core`

### Current Gaps

1. **No Task Queue Module**: No dedicated queue system in `pipeline-core` (ConcurrencyLimiter is execution-focused, not queue-focused)
2. **No Priority System**: All tasks are equal priority
3. **No Queue UI**: Cannot view/manage pending tasks before execution
4. **No Pause/Resume**: Cannot pause queue execution

---

## Proposed Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Task Queue System                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │ QueueManager │──▶│QueueExecutor │──▶│AIProcessMgr  │    │
│  │              │   │              │   │              │    │
│  │ - enqueue()  │   │ - run next   │   │ - track      │    │
│  │ - dequeue()  │   │ - concurrency│   │ - events     │    │
│  │ - reorder()  │   │ - retry      │   │              │    │
│  └──────────────┘   └──────────────┘   └──────────────┘    │
│                                                              │
│                     ┌──────────────────────────────────┐    │
│                     │       QueueTreeDataProvider       │    │
│                     │    - Queued section               │    │
│                     │    - Running section              │    │
│                     │    - Completed section            │    │
│                     └──────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### New Types

```typescript
interface QueuedTask {
    id: string;                      // Unique ID (e.g., 'queue-1706700000000')
    type: TaskType;                  // 'follow-prompt' | 'resolve-comments' | 'code-review' | etc.
    priority: TaskPriority;          // 'high' | 'normal' | 'low'
    status: QueueStatus;             // 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
    createdAt: number;               // Timestamp
    startedAt?: number;              // When execution began
    completedAt?: number;            // When execution finished

    // Task-specific payload
    payload: FollowPromptPayload | ResolveCommentsPayload | CodeReviewPayload;

    // Execution config
    config: {
        model?: string;
        timeoutMs?: number;
        retryOnFailure?: boolean;
        retryAttempts?: number;
    };

    // Result tracking
    processId?: string;              // Links to AIProcess when running
    result?: unknown;
    error?: string;
}

type TaskType = 'follow-prompt' | 'resolve-comments' | 'code-review' | 'ai-clarification';
type TaskPriority = 'high' | 'normal' | 'low';
type QueueStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

// Payload types for different tasks
interface FollowPromptPayload {
    promptFilePath: string;
    planFilePath?: string;
    skillName?: string;
    additionalContext?: string;
}

interface ResolveCommentsPayload {
    documentUri: string;
    commentIds: string[];
    promptTemplate: string;
}

interface CodeReviewPayload {
    commitSha?: string;
    diffType: 'staged' | 'pending' | 'commit';
    rulesFolder: string;
}
```

---

## Workplan

### Phase 1: Core Queue Infrastructure (pipeline-core)

- [x] **1.1 Create QueuedTask types**
  - File: `packages/pipeline-core/src/queue/types.ts`
  - Define interfaces for QueuedTask, TaskType, TaskPriority, QueueStatus
  - Define payload interfaces for each task type
  - Use Node.js EventEmitter (not VS Code) for cross-platform compatibility

- [x] **1.2 Implement TaskQueueManager**
  - File: `packages/pipeline-core/src/queue/task-queue-manager.ts`
  - Methods: `enqueue()`, `dequeue()`, `peek()`, `remove()`, `reorder()`, `getAll()`
  - Event emitter for queue changes (`onQueueChange`)
  - Priority-based ordering within queue
  - In-memory storage (array-backed)
  - **Note**: Pure Node.js, no VS Code dependencies

- [x] **1.3 Implement QueueExecutor**
  - File: `packages/pipeline-core/src/queue/queue-executor.ts`
  - Pull tasks from queue in priority order
  - Configurable concurrency (default: 1 for sequential)
  - Leverage existing `ConcurrencyLimiter` for execution control
  - Handle retries, timeouts, cancellation via `CancellationError`
  - Abstract task executor interface for different backends

- [x] **1.4 Create queue module index**
  - File: `packages/pipeline-core/src/queue/index.ts`
  - Export all queue types and classes
  - Update `packages/pipeline-core/src/index.ts` to export queue module

- [x] **1.5 Add Vitest tests for queue module**
  - File: `packages/pipeline-core/test/queue/task-queue-manager.test.ts`
  - File: `packages/pipeline-core/test/queue/queue-executor.test.ts`
  - Test enqueue/dequeue, priority ordering, cancellation, reordering

### Phase 2: VS Code Integration Layer

- [x] **2.1 Create AIQueueService (VS Code adapter)**
  - File: `src/shortcuts/ai-service/ai-queue-service.ts`
  - Wraps `TaskQueueManager` and `QueueExecutor` from pipeline-core
  - Integrates with `AIProcessManager` for process tracking
  - Integrates with `CopilotSDKService` for AI execution
  - VS Code EventEmitter for UI updates

- [x] **2.2 Update AI Process Tree Provider**
  - Add "Queued Tasks" section at top of tree
  - Show queue position and priority badge
  - Context menu: Cancel, Move to Top, Move Up/Down
  - Visual distinction (different icon/color) for queued vs running
  - **Note**: Leverage existing base classes (`FilterableTreeDataProvider`)

- [x] **2.3 Add Queue Commands**
  - `shortcuts.queue.addToQueue` - Queue a task (vs immediate execute)
  - `shortcuts.queue.cancelTask` - Cancel a queued task
  - `shortcuts.queue.moveToTop` - Prioritize a task
  - `shortcuts.queue.clearQueue` - Clear all queued tasks
  - `shortcuts.queue.pauseQueue` - Pause queue execution
  - `shortcuts.queue.resumeQueue` - Resume queue execution
  - Register in `src/shortcuts/commands.ts` or new `ai-queue-commands.ts`

### Phase 3: UI Integration for Follow Prompt

- [x] **3.1 Update Follow Prompt Dialog**
  - Add "Add to Queue" option alongside existing execution modes
  - Show current queue length in dialog
  - Option to set priority (high/normal/low)

- [x] **3.2 Update executeFollowPrompt()**
  - New execution path: `executeFollowPromptQueued()`
  - Creates QueuedTask instead of immediate execution
  - Returns queue position to user via notification

- [x] **3.3 Add Queue Status Bar Item**
  - Show queue count when tasks are queued (e.g., "$(loading~spin) 3 queued")
  - Click to reveal AI Processes panel
  - Spinning icon when actively executing

### Phase 4: Extended Task Types

- [x] **4.1 Add Resolve Comments queueing**
  - Queue option in AI Action menu ("Add to Queue" submenu)
  - `AIClarificationPayload` handling in executor with context-based prompt building
  - Added `requestAskAIQueued` bridge function and `handleAskAIQueued` handler

- [~] **4.2 Add Code Review queueing** (Deferred)
  - Complex map-reduce integration needed
  - Code review already uses parallel execution framework
  - Would require significant refactoring to integrate with queue

- [x] **4.3 Add batch queuing support**
  - `queueBatch()` method in AIQueueService
  - Maintains order within batch
  - Returns `BatchQueueResult` with all task IDs and positions

### Phase 5: Testing & Polish

- [x] **5.1 Extension integration tests**
  - File: `src/test/suite/ai-queue-service.test.ts`
  - Test queue UI updates, command execution, AIProcess linking
  - Test pause/resume behavior

- [x] **5.2 Queue settings in package.json**
  - `workspaceShortcuts.queue.enabled` - Enable/disable queue feature
  - `workspaceShortcuts.queue.maxConcurrency` - Max parallel tasks (default: 1)
  - `workspaceShortcuts.queue.defaultPriority` - Default task priority

- [x] **5.3 Queue notifications**
  - Notification when task completes (configurable)
  - Notification when queue is empty
  - `workspaceShortcuts.queue.notifyOnComplete` setting

---

## Implementation Details

### TaskQueueManager API (Updated)

```typescript
import { EventEmitter } from 'events';

interface ITaskQueueManager {
    // Core operations
    enqueue(task: Omit<QueuedTask, 'id' | 'createdAt' | 'status'>): string;
    dequeue(): QueuedTask | undefined;
    peek(): QueuedTask | undefined;

    // Queue management
    getAll(): QueuedTask[];
    getQueued(): QueuedTask[];
    getRunning(): QueuedTask[];
    getCompleted(): QueuedTask[];
    size(): number;

    // Task operations
    getTask(id: string): QueuedTask | undefined;
    updateTask(id: string, updates: Partial<QueuedTask>): void;
    removeTask(id: string): boolean;
    cancelTask(id: string): boolean;

    // Reordering
    moveToTop(id: string): void;
    moveUp(id: string): void;
    moveDown(id: string): void;

    // Queue control
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    clear(): void;

    // Events (Node.js EventEmitter)
    on(event: 'change', listener: (event: QueueChangeEvent) => void): this;
    on(event: 'taskAdded', listener: (task: QueuedTask) => void): this;
    on(event: 'taskRemoved', listener: (task: QueuedTask) => void): this;
    on(event: 'taskUpdated', listener: (task: QueuedTask) => void): this;
}

interface QueueChangeEvent {
    type: 'added' | 'removed' | 'updated' | 'reordered' | 'cleared';
    taskId?: string;
    task?: QueuedTask;
}
```

### QueueExecutor API (Updated)

```typescript
import { EventEmitter } from 'events';
import { ConcurrencyLimiter, CancellationError } from '../map-reduce/concurrency-limiter';

/**
 * Abstract task executor - implement for different backends
 */
interface TaskExecutor<TResult = unknown> {
    execute(task: QueuedTask): Promise<TResult>;
    cancel?(taskId: string): void;
}

interface IQueueExecutor {
    // Lifecycle
    start(): void;
    stop(): void;
    isRunning(): boolean;

    // Configuration
    setMaxConcurrency(n: number): void;
    getMaxConcurrency(): number;

    // Execution (internal, driven by queue events)
    // executeNext(): Promise<void>;  // internal
    // executeTask(task: QueuedTask): Promise<TaskResult>;  // internal

    // Events (Node.js EventEmitter)
    on(event: 'taskStarted', listener: (task: QueuedTask) => void): this;
    on(event: 'taskCompleted', listener: (task: QueuedTask, result: unknown) => void): this;
    on(event: 'taskFailed', listener: (task: QueuedTask, error: Error) => void): this;
    on(event: 'taskCancelled', listener: (task: QueuedTask) => void): this;
}
```

---

## File Structure

```
packages/pipeline-core/src/
├── queue/
│   ├── index.ts                    # Public exports
│   ├── types.ts                    # Queue interfaces and types
│   ├── task-queue-manager.ts       # Core queue logic (in-memory, Node.js EventEmitter)
│   └── queue-executor.ts           # Task execution logic (uses ConcurrencyLimiter)
├── index.ts                        # Updated to export queue module
└── map-reduce/
    └── concurrency-limiter.ts      # (existing) Reused for execution control

packages/pipeline-core/test/
└── queue/
    ├── task-queue-manager.test.ts  # Vitest tests
    └── queue-executor.test.ts      # Vitest tests

src/shortcuts/ai-service/
├── ai-queue-service.ts             # VS Code adapter (new)
├── queue-tree-items.ts             # Tree view items for queue (new)
├── ai-process-tree-provider.ts     # (update) Add queue section
├── ai-process-manager.ts           # (existing) Links to queue tasks
└── types.ts                        # (update) Add queue-related types
```

---

## Testing Strategy

### Unit Tests (Vitest - pipeline-core)
- `packages/pipeline-core/test/queue/task-queue-manager.test.ts`
  - Enqueue/dequeue operations
  - Priority ordering (high > normal > low)
  - Reordering (moveToTop, moveUp, moveDown)
  - Pause/resume behavior
  - Event emission
- `packages/pipeline-core/test/queue/queue-executor.test.ts`
  - Concurrency control (respects limit)
  - Task execution lifecycle
  - Cancellation handling (CancellationError)
  - Retry logic
  - Integration with ConcurrencyLimiter

### Integration Tests (Mocha - extension)
- `src/test/suite/ai-queue.test.ts`
  - Queue UI updates on changes
  - Command execution and queue interaction
  - AIProcess linking (QueuedTask.id ↔ AIProcess.id)
  - Tree view updates
  - Status bar updates

---

## Configuration Options

```json
{
    "workspaceShortcuts.queue.enabled": {
        "type": "boolean",
        "default": true,
        "description": "Enable task queueing system"
    },
    "workspaceShortcuts.queue.maxConcurrency": {
        "type": "number",
        "default": 1,
        "description": "Maximum concurrent task executions"
    },
    "workspaceShortcuts.queue.defaultPriority": {
        "type": "string",
        "enum": ["high", "normal", "low"],
        "default": "normal",
        "description": "Default priority for queued tasks"
    },
    "workspaceShortcuts.queue.notifyOnComplete": {
        "type": "boolean",
        "default": true,
        "description": "Show notification when task completes"
    }
}
```

---

## Dependencies

### Existing (No New Packages Required)
- `ConcurrencyLimiter` from `pipeline-core` - Execution control with cancellation
- `CopilotSDKService` from `pipeline-core` - AI execution
- `AIProcessManager` from extension - Process tracking
- Node.js `EventEmitter` - Cross-platform events (for pipeline-core)
- VS Code `EventEmitter` - UI updates (for extension)

### New Files to Create
- 4 files in `packages/pipeline-core/src/queue/`
- 2 test files in `packages/pipeline-core/test/queue/`
- 2-3 files in `src/shortcuts/ai-service/`
- Updates to existing tree provider, commands, and package.json

---

## Success Criteria

1. Tasks can be queued instead of immediate execution
2. Users can view queued tasks in the AI Processes tree
3. Users can manage queued tasks (cancel, reorder, clear)
4. Tasks execute sequentially by default (configurable concurrency)
5. Integration with existing AI Process tracking (linked IDs)
6. All existing functionality continues to work (backward compatible)
7. Queue logic is usable outside VS Code (in pipeline-core)

---

## Design Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default concurrency | 1 (sequential) | Predictability, avoids API rate limits |
| Queue position display | Show position (#2 in queue) | Simple, no estimation complexity |
| Failed task behavior | Manual retry by default | User control, configurable auto-retry later |
| Event system | Node.js EventEmitter in pipeline-core | Cross-platform, no VS Code dependency |
| Queue persistence | None (in-memory) | Simplicity, avoids stale state on restart |

---

## Notes

- Build on existing `ConcurrencyLimiter` pattern for execution control
- Keep queue logic in `pipeline-core` for potential CLI usage
- VS Code-specific parts (UI, tree items) remain in extension
- Queue is ephemeral — starts empty each session, no persistence overhead
- Use `CancellationError` from `ConcurrencyLimiter` for task cancellation
- Consider future: priority decay, ETA estimation, queue persistence (not in v1)
