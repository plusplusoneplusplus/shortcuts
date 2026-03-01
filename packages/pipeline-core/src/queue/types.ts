/**
 * Queue Types
 *
 * Type definitions for the AI task queue system.
 * These types are used by TaskQueueManager and QueueExecutor.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Priority level for queued tasks
 * Higher priority tasks are executed first
 */
export type TaskPriority = 'high' | 'normal' | 'low';

/**
 * Status of a queued task
 */
export type QueueStatus =
    | 'queued'      // Waiting in queue
    | 'running'     // Currently executing
    | 'completed'   // Finished successfully
    | 'failed'      // Finished with error
    | 'cancelled';  // Cancelled by user

// ============================================================================
// Task Configuration
// ============================================================================

/**
 * Configuration for task execution
 */
export interface TaskExecutionConfig {
    /** AI model to use */
    model?: string;
    /** Timeout in milliseconds */
    timeoutMs?: number;
    /** Whether to retry on failure */
    retryOnFailure?: boolean;
    /** Number of retry attempts */
    retryAttempts?: number;
    /** Delay between retries in milliseconds */
    retryDelayMs?: number;
}

/**
 * Default task execution configuration
 */
import {
    DEFAULT_AI_TIMEOUT_MS,
    DEFAULT_RETRY_ATTEMPTS,
    DEFAULT_RETRY_DELAY_MS
} from '../config/defaults';

export const DEFAULT_TASK_CONFIG: TaskExecutionConfig = {
    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
    retryOnFailure: false,
    retryAttempts: DEFAULT_RETRY_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
};

// ============================================================================
// Queued Task
// ============================================================================

/**
 * A task that has been queued for execution
 */
export interface QueuedTask {
    /** Unique identifier for the task */
    id: string;
    /** Repository identifier (for multi-repo workspaces) */
    repoId?: string;
    /** Folder path associated with this task (for folder-scoped queue badges) */
    folderPath?: string;
    /** Type of task */
    type: string;
    /** Priority level */
    priority: TaskPriority;
    /** Current status */
    status: QueueStatus;
    /** Timestamp when task was created */
    createdAt: number;
    /** Timestamp when execution started */
    startedAt?: number;
    /** Timestamp when execution completed */
    completedAt?: number;

    /** Task-specific payload */
    payload: Record<string, unknown>;

    /** Execution configuration */
    config: TaskExecutionConfig;

    /** Display name for the task (shown in UI) */
    displayName?: string;

    /** Links to AIProcess when running */
    processId?: string;

    /** Result of execution (when completed) */
    result?: unknown;

    /** Error message (when failed) */
    error?: string;

    /** Number of retry attempts made */
    retryCount?: number;

    /** Concurrency mode: 'shared' tasks run in the shared pool, 'exclusive' tasks in the exclusive pool */
    concurrencyMode?: 'shared' | 'exclusive';

    /** Whether this task is frozen (skipped by the executor but stays in queue) */
    frozen?: boolean;
}

/**
 * Input for creating a new queued task (without auto-generated fields)
 */
export type CreateTaskInput = Omit<
    QueuedTask,
    'id' | 'createdAt' | 'status' | 'startedAt' | 'completedAt' | 'result' | 'error' | 'retryCount'
>;

/**
 * Partial update for a queued task
 */
export type TaskUpdate = Partial<
    Pick<
        QueuedTask,
        'status' | 'startedAt' | 'completedAt' | 'processId' | 'result' | 'error' | 'retryCount' | 'priority' | 'displayName'
    >
>;

// ============================================================================
// Queue Events
// ============================================================================

/**
 * Type of queue change event
 */
export type QueueChangeType =
    | 'added'
    | 'removed'
    | 'updated'
    | 'reordered'
    | 'cleared'
    | 'paused'
    | 'resumed'
    | 'repo-paused'
    | 'repo-resumed'
    | 'drain-started'
    | 'drain-cancelled'
    | 'frozen'
    | 'unfrozen';

/**
 * Event emitted when the queue changes
 */
export interface QueueChangeEvent {
    /** Type of change */
    type: QueueChangeType;
    /** ID of the affected task (if applicable) */
    taskId?: string;
    /** The affected task (if applicable) */
    task?: QueuedTask;
    /** Timestamp of the event */
    timestamp: number;
}

/**
 * Event types for the queue event emitter
 */
export interface QueueEvents {
    change: (event: QueueChangeEvent) => void;
    taskAdded: (task: QueuedTask) => void;
    taskRemoved: (task: QueuedTask) => void;
    taskUpdated: (task: QueuedTask, updates: TaskUpdate) => void;
    taskStarted: (task: QueuedTask) => void;
    taskCompleted: (task: QueuedTask, result: unknown) => void;
    taskFailed: (task: QueuedTask, error: Error) => void;
    taskCancelled: (task: QueuedTask) => void;
    paused: () => void;
    resumed: () => void;
    'drain-started': () => void;
    'drain-cancelled': () => void;
}

/**
 * Event types for the queue executor drain lifecycle
 */
export interface DrainEvent {
    queued: number;
    running: number;
}

export interface DrainCompleteEvent extends DrainEvent {
    outcome: 'completed';
}

export interface DrainTimeoutEvent extends DrainEvent {
    timeoutMs?: number;
}

export interface QueueExecutorDrainEvents {
    'drain-start': (event: DrainEvent) => void;
    'drain-progress': (event: DrainEvent) => void;
    'drain-complete': (event: DrainCompleteEvent) => void;
    'drain-timeout': (event: DrainTimeoutEvent) => void;
}

// ============================================================================
// Executor Types
// ============================================================================

/**
 * Result of task execution
 */
export interface TaskExecutionResult<TResult = unknown> {
    /** Whether execution was successful */
    success: boolean;
    /** Result data (if successful) */
    result?: TResult;
    /** Error (if failed) */
    error?: Error;
    /** Duration of execution in milliseconds */
    durationMs: number;
}

/**
 * Abstract task executor interface
 * Implement this for different backends (AI service, mock, etc.)
 */
export interface TaskExecutor<TResult = unknown> {
    /**
     * Execute a queued task
     * @param task The task to execute
     * @returns Promise resolving to the execution result
     */
    execute(task: QueuedTask): Promise<TaskExecutionResult<TResult>>;

    /**
     * Cancel a running task (optional)
     * @param taskId ID of the task to cancel
     */
    cancel?(taskId: string): void;
}

/**
 * Options for the queue executor
 */
export interface QueueExecutorOptions {
    /** Maximum concurrent task executions (default: 1) */
    maxConcurrency?: number;
    /** Whether to auto-start processing (default: true) */
    autoStart?: boolean;
    /** Concurrency limit for shared (read-only) tasks (default: 5) */
    sharedConcurrency?: number;
    /** Concurrency limit for exclusive (write) tasks (default: 1) */
    exclusiveConcurrency?: number;
    /**
     * Policy callback to classify a task as exclusive.
     * Returns true for exclusive tasks, false for shared.
     * Default: () => true (all exclusive — preserves current serial behavior).
     */
    isExclusive?: (task: QueuedTask) => boolean;
}

/**
 * Default queue executor options
 */
export const DEFAULT_EXECUTOR_OPTIONS: Required<QueueExecutorOptions> = {
    maxConcurrency: 1,
    autoStart: true,
    sharedConcurrency: 5,
    exclusiveConcurrency: 1,
    isExclusive: () => true,
};

// ============================================================================
// Queue Manager Types
// ============================================================================

/**
 * Options for the task queue manager
 */
export interface TaskQueueManagerOptions {
    /** Maximum queue size (0 = unlimited, default: 0) */
    maxQueueSize?: number;
    /** Whether to keep completed tasks in history (default: true) */
    keepHistory?: boolean;
    /** Maximum history size (default: 100) */
    maxHistorySize?: number;
    /**
     * Optional callback to extract repository ID from a task.
     * Required for per-repository pause/resume functionality.
     * If not provided, queue operates in global pause mode (all tasks paused/resumed together).
     * 
     * @param task - The queued task to extract repo ID from
     * @returns Repository identifier string, or undefined if task has no repo association
     * 
     * @example
     * ```typescript
     * getTaskRepoId: (task) => task.payload.repoId || task.repoId
     * ```
     */
    getTaskRepoId?: (task: QueuedTask) => string | undefined;
}

/**
 * Default queue manager options
 */
export const DEFAULT_QUEUE_MANAGER_OPTIONS: Required<Omit<TaskQueueManagerOptions, 'getTaskRepoId'>> = {
    maxQueueSize: 0,
    keepHistory: true,
    maxHistorySize: 100,
};

/**
 * Statistics about the queue
 */
export interface QueueStats {
    /** Number of tasks waiting in queue */
    queued: number;
    /** Number of tasks currently running */
    running: number;
    /** Number of completed tasks (in history) */
    completed: number;
    /** Number of failed tasks (in history) */
    failed: number;
    /** Number of cancelled tasks (in history) */
    cancelled: number;
    /** Total tasks processed */
    total: number;
    /** Whether the queue is paused */
    isPaused: boolean;
    /** Whether the queue is in drain mode */
    isDraining: boolean;
    /** List of repository IDs that are currently paused (optional, for per-repo pause) */
    pausedRepos?: string[];
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Statistics for the registry (aggregated across all repos)
 */
export interface RegistryStats {
    /** Number of repositories with queues */
    repoCount: number;

    /** Aggregated totals across all repositories */
    totals: {
        queued: number;
        running: number;
        completed: number;
        failed: number;
        cancelled: number;
        total: number;
    };

    /** Per-repository statistics */
    byRepo: Record<string, QueueStats>;
}

// ============================================================================
// Priority Helpers
// ============================================================================

/**
 * Numeric values for priority comparison
 * Higher value = higher priority
 */
export const PRIORITY_VALUES: Record<TaskPriority, number> = {
    high: 3,
    normal: 2,
    low: 1,
};

/**
 * Compare two tasks by priority (for sorting)
 * Returns negative if a should come before b
 */
export function comparePriority(a: QueuedTask, b: QueuedTask): number {
    const priorityDiff = PRIORITY_VALUES[b.priority] - PRIORITY_VALUES[a.priority];
    if (priorityDiff !== 0) {
        return priorityDiff;
    }
    // Same priority: earlier created task comes first (FIFO within priority)
    return a.createdAt - b.createdAt;
}

/**
 * Generate a unique task ID.
 * Format: `<timestamp>-<random>` (e.g., `1771242852770-g94u3ig`).
 * The queue executor bridge prefixes this with the process type
 * to form the process ID (e.g., `queue-1771242852770-g94u3ig`).
 */
export function generateTaskId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
