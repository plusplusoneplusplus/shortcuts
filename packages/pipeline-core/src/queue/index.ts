/**
 * Queue Module
 *
 * AI task queue system for managing and executing tasks with priority-based ordering.
 *
 * Key Features:
 * - Priority-based task ordering (high > normal > low)
 * - Configurable concurrency control
 * - Pause/resume queue processing
 * - Task cancellation support
 * - Event-driven architecture (Node.js EventEmitter)
 * - In-memory storage (no persistence)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 *
 * @example
 * ```typescript
 * import {
 *     createTaskQueueManager,
 *     createQueueExecutor,
 *     createSimpleTaskExecutor
 * } from 'pipeline-core';
 *
 * // Create queue manager
 * const queueManager = createTaskQueueManager();
 *
 * // Create executor with simple task handler
 * const taskExecutor = createSimpleTaskExecutor(async (task) => {
 *     // Your task execution logic
 *     return { result: 'done' };
 * });
 *
 * // Create queue executor
 * const executor = createQueueExecutor(queueManager, taskExecutor, {
 *     maxConcurrency: 1
 * });
 *
 * // Enqueue a task
 * const taskId = queueManager.enqueue({
 *     type: 'follow-prompt',
 *     priority: 'normal',
 *     payload: { promptFilePath: '/path/to/prompt.md' },
 *     config: { timeoutMs: 60000 }
 * });
 *
 * // Listen for completion
 * executor.on('taskCompleted', (task, result) => {
 *     console.log(`Task ${task.id} completed:`, result);
 * });
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export {
    // Core types
    TaskType,
    TaskPriority,
    QueueStatus,

    // Payload types
    FollowPromptPayload,
    ResolveCommentsPayload,
    CodeReviewPayload,
    AIClarificationPayload,
    CustomTaskPayload,
    TaskPayload,

    // Task configuration
    TaskExecutionConfig,
    DEFAULT_TASK_CONFIG,

    // Queued task
    QueuedTask,
    CreateTaskInput,
    TaskUpdate,

    // Events
    QueueChangeType,
    QueueChangeEvent,
    QueueEvents,

    // Executor types
    TaskExecutionResult,
    TaskExecutor,
    QueueExecutorOptions,
    DEFAULT_EXECUTOR_OPTIONS,

    // Queue manager types
    TaskQueueManagerOptions,
    DEFAULT_QUEUE_MANAGER_OPTIONS,
    QueueStats,

    // Priority helpers
    PRIORITY_VALUES,
    comparePriority,

    // Type guards
    isFollowPromptPayload,
    isResolveCommentsPayload,
    isCodeReviewPayload,
    isAIClarificationPayload,
    isCustomTaskPayload,

    // Utilities
    generateTaskId,
} from './types';

// ============================================================================
// Task Queue Manager
// ============================================================================

export {
    TaskQueueManager,
    createTaskQueueManager,
} from './task-queue-manager';

// ============================================================================
// Queue Executor
// ============================================================================

export {
    QueueExecutor,
    createQueueExecutor,
    SimpleTaskExecutor,
    createSimpleTaskExecutor,
} from './queue-executor';
