/**
 * Shared mutable state for a single workflow execution.
 *
 * Created once at the top of executeWorkflow() and passed to internal helpers.
 * Not part of the public API; do not export from index.ts.
 */

import type { WorkflowConfig, WorkflowExecutionOptions, NodeResult, ExecutionTier } from './types';

export interface WorkflowContext {
    /** The original validated configuration. Never mutated after creation. */
    config: WorkflowConfig;
    /** Caller-supplied options (aiInvoker, callbacks, cancellation). Never mutated. */
    options: WorkflowExecutionOptions;
    /** Accumulated node outputs, keyed by nodeId. Written by executeNode(). */
    results: Map<string, NodeResult>;
    /** Execution schedule produced by schedule(). Read-only after creation. */
    tiers: ExecutionTier[];
    /** Date.now() captured at the start of executeWorkflow(). */
    startTime: number;
}
