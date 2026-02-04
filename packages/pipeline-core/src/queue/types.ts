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
 * Type of task that can be queued
 */
export type TaskType =
    | 'follow-prompt'
    | 'resolve-comments'
    | 'code-review'
    | 'ai-clarification'
    | 'custom';

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
// Payload Types
// ============================================================================

/**
 * Payload for follow-prompt tasks
 */
export interface FollowPromptPayload {
    /** Path to the prompt file */
    promptFilePath: string;
    /** Optional path to the plan file */
    planFilePath?: string;
    /** Optional skill name to use */
    skillName?: string;
    /** Optional additional context */
    additionalContext?: string;
    /** Working directory for execution */
    workingDirectory?: string;
}

/**
 * Payload for resolve-comments tasks
 */
export interface ResolveCommentsPayload {
    /** URI of the document containing comments */
    documentUri: string;
    /** IDs of comments to resolve */
    commentIds: string[];
    /** Template for generating the prompt */
    promptTemplate: string;
}

/**
 * Payload for code-review tasks
 */
export interface CodeReviewPayload {
    /** Commit SHA to review (optional) */
    commitSha?: string;
    /** Type of diff to review */
    diffType: 'staged' | 'pending' | 'commit';
    /** Path to the rules folder */
    rulesFolder: string;
    /** Working directory for the review */
    workingDirectory?: string;
}

/**
 * Payload for AI clarification tasks
 */
export interface AIClarificationPayload {
    /** The prompt to send to AI (if pre-built) */
    prompt?: string;
    /** Working directory for execution */
    workingDirectory?: string;
    /** Optional model to use */
    model?: string;
    /** Selected text for clarification */
    selectedText?: string;
    /** File path containing the selection */
    filePath?: string;
    /** Start line of selection */
    startLine?: number;
    /** End line of selection */
    endLine?: number;
    /** Surrounding lines for context */
    surroundingLines?: string;
    /** Nearest heading in the document */
    nearestHeading?: string | null;
    /** Instruction type (clarify, go-deeper, custom) */
    instructionType?: string;
    /** Custom instruction text */
    customInstruction?: string;
    /** Content from prompt file */
    promptFileContent?: string;
    /** Skill name if using a skill */
    skillName?: string;
}

/**
 * Payload for custom tasks
 */
export interface CustomTaskPayload {
    /** Custom data for the task */
    data: Record<string, unknown>;
}

/**
 * Union of all payload types
 */
export type TaskPayload =
    | FollowPromptPayload
    | ResolveCommentsPayload
    | CodeReviewPayload
    | AIClarificationPayload
    | CustomTaskPayload;

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
export interface QueuedTask<TPayload extends TaskPayload = TaskPayload, TResult = unknown> {
    /** Unique identifier for the task */
    id: string;
    /** Type of task */
    type: TaskType;
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
    payload: TPayload;

    /** Execution configuration */
    config: TaskExecutionConfig;

    /** Display name for the task (shown in UI) */
    displayName?: string;

    /** Links to AIProcess when running */
    processId?: string;

    /** Result of execution (when completed) */
    result?: TResult;

    /** Error message (when failed) */
    error?: string;

    /** Number of retry attempts made */
    retryCount?: number;
}

/**
 * Input for creating a new queued task (without auto-generated fields)
 */
export type CreateTaskInput<TPayload extends TaskPayload = TaskPayload> = Omit<
    QueuedTask<TPayload>,
    'id' | 'createdAt' | 'status' | 'startedAt' | 'completedAt' | 'result' | 'error' | 'retryCount'
>;

/**
 * Partial update for a queued task
 */
export type TaskUpdate<TPayload extends TaskPayload = TaskPayload, TResult = unknown> = Partial<
    Pick<
        QueuedTask<TPayload, TResult>,
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
    | 'resumed';

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
}

/**
 * Default queue executor options
 */
export const DEFAULT_EXECUTOR_OPTIONS: Required<QueueExecutorOptions> = {
    maxConcurrency: 1,
    autoStart: true,
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
}

/**
 * Default queue manager options
 */
export const DEFAULT_QUEUE_MANAGER_OPTIONS: Required<TaskQueueManagerOptions> = {
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

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a payload is a FollowPromptPayload
 */
export function isFollowPromptPayload(payload: TaskPayload): payload is FollowPromptPayload {
    return 'promptFilePath' in payload;
}

/**
 * Check if a payload is a ResolveCommentsPayload
 */
export function isResolveCommentsPayload(payload: TaskPayload): payload is ResolveCommentsPayload {
    return 'documentUri' in payload && 'commentIds' in payload;
}

/**
 * Check if a payload is a CodeReviewPayload
 */
export function isCodeReviewPayload(payload: TaskPayload): payload is CodeReviewPayload {
    return 'diffType' in payload && 'rulesFolder' in payload;
}

/**
 * Check if a payload is an AIClarificationPayload
 */
export function isAIClarificationPayload(payload: TaskPayload): payload is AIClarificationPayload {
    return 'prompt' in payload && !('data' in payload);
}

/**
 * Check if a payload is a CustomTaskPayload
 */
export function isCustomTaskPayload(payload: TaskPayload): payload is CustomTaskPayload {
    return 'data' in payload;
}

/**
 * Generate a unique task ID
 */
export function generateTaskId(): string {
    return `queue-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
