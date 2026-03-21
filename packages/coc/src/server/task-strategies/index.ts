/**
 * Task Strategy Pattern
 *
 * Defines the `TaskStrategy` interface and `TaskStrategyRegistry` used by
 * CLITaskExecutor to dispatch tasks to dedicated strategy implementations.
 *
 * Each strategy is responsible for a single task sub-type (e.g. run-script,
 * replicate-template). Additional strategies will be added in future commits.
 */

import type { QueuedTask } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

// ============================================================================
// Execution Context
// ============================================================================

/** Shared runtime context passed by CLITaskExecutor to every strategy. */
export interface ExecutionContext {
    /** Canonical process ID for this task (format: `queue_<taskId>`). */
    processId: string;
    /** Process store for status updates and SSE event emission. */
    store: ProcessStore;
    /** Whether to auto-approve AI permission requests. */
    approvePermissions: boolean;
    /** Resolved working directory for the task (may be undefined). */
    workingDirectory: string | undefined;
}

// ============================================================================
// Strategy Interface
// ============================================================================

export type TaskResult = unknown;

export interface TaskStrategy {
    execute(task: QueuedTask, context: ExecutionContext): Promise<TaskResult>;
}

// ============================================================================
// Strategy Registry
// ============================================================================

export class TaskStrategyRegistry {
    private readonly strategies = new Map<string, TaskStrategy>();

    register(type: string, strategy: TaskStrategy): void {
        this.strategies.set(type, strategy);
    }

    get(type: string): TaskStrategy | undefined {
        return this.strategies.get(type);
    }
}
