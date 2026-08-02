/**
 * Workflow AI Invocation Kernel.
 *
 * Owns the AI-call lifecycle shared by every AI-capable node (map, ai, reduce,
 * ai-filter, ai-load): preflight `aiInvoker` guard, provider-option resolution,
 * cancellation guards, non-cancellation error normalization, and optional
 * process/progress reporting.
 *
 * The kernel is result-oriented: it never decides node-specific output shapes.
 * It returns a normalized {@link WorkflowAiResult} and lets each node adapter
 * map that result into its own invariants (map/ai/reduce annotate `__error`,
 * ai-filter returns a conservative `false`, ai-load throws).
 *
 * Cancellation is always surfaced by throwing (via `throwIfWorkflowCancelled`)
 * so callers never have to branch on it — matching the historical behavior of
 * every node.
 */

import type { WorkflowExecutionOptions, WorkflowItemProcessEvent } from '../types';
import type { ProcessTracker } from '../../ai/types';
import { isWorkflowCancellationError, throwIfWorkflowCancelled } from '../cancellation';

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/**
 * Optional per-invocation lifecycle reporting. When provided, the kernel emits
 * `running` before the call and `completed`/`failed` after it, driving both the
 * `processTracker` and the `onItemProcess` callback.
 *
 * Registration (and therefore the `processId`/description) stays node-specific
 * and is the caller's responsibility.
 */
export interface WorkflowAiLifecycle {
    /** Process tracker to update (optional integration point). */
    processTracker?: ProcessTracker;
    /** Per-item progress callback. */
    onItemProcess?: (event: WorkflowItemProcessEvent) => void;
    /** Process ID (already registered by the caller, or a generated fallback). */
    processId: string;
    /** Node ID for the emitted events. */
    nodeId: string;
    /** Zero-based item index for the emitted events. */
    itemIndex: number;
    /** Short label for UI display (omitted for whole-collection nodes). */
    itemLabel?: string;
}

/** A single AI invocation request handled by {@link invokeWorkflowAI}. */
export interface WorkflowAiRequest {
    /** Fully-resolved prompt to send to the provider. */
    prompt: string;
    /** Workflow execution options (invoker, signal, provider defaults). */
    options: WorkflowExecutionOptions;
    /** Node-level model override (falls back to `options.model`). */
    model?: string;
    /** Node-level timeout override in ms (falls back to `options.timeoutMs`). */
    timeoutMs?: number;
    /**
     * When true, a successful invocation with an empty/missing response is
     * treated as a failure (ai, reduce, load). Defaults to false (map, filter).
     */
    requireResponse?: boolean;
    /**
     * Message used for lifecycle reporting when the invoker reports failure
     * without an error string. Does not affect the returned `error`, which stays
     * raw so adapters can apply their own node-specific default.
     */
    failureMessage?: string;
    /** Optional lifecycle reporting hooks (map/ai nodes). */
    lifecycle?: WorkflowAiLifecycle;
}

/** Normalized outcome of an AI invocation. */
export interface WorkflowAiResult {
    /**
     * Whether the call is usable. False when the invoker threw (non-cancellation),
     * reported `success: false`, or (with `requireResponse`) returned an empty
     * response.
     */
    success: boolean;
    /** Raw response from the invoker (present on success). */
    response?: string;
    /**
     * Raw error message. For thrown errors this is the message; for reported
     * failures it is `result.error` (may be undefined). Undefined for an empty
     * response with no error — adapters supply their own default.
     */
    error?: string;
    /**
     * The original error object the invoker threw (non-cancellation only).
     * Lets adapters rethrow it verbatim (e.g. ai-load) instead of a wrapped copy.
     */
    thrownError?: unknown;
}

// ---------------------------------------------------------------------------
// Lifecycle reporting
// ---------------------------------------------------------------------------

function reportRunning(lifecycle?: WorkflowAiLifecycle): void {
    if (!lifecycle) return;
    lifecycle.onItemProcess?.({
        nodeId: lifecycle.nodeId,
        itemIndex: lifecycle.itemIndex,
        processId: lifecycle.processId,
        status: 'running',
        itemLabel: lifecycle.itemLabel,
    });
}

function reportFailure(lifecycle: WorkflowAiLifecycle | undefined, error: string): void {
    if (!lifecycle) return;
    lifecycle.processTracker?.updateProcess(lifecycle.processId, 'failed', undefined, error);
    lifecycle.onItemProcess?.({
        nodeId: lifecycle.nodeId,
        itemIndex: lifecycle.itemIndex,
        processId: lifecycle.processId,
        status: 'failed',
        itemLabel: lifecycle.itemLabel,
        error,
    });
}

function reportSuccess(lifecycle: WorkflowAiLifecycle | undefined, response?: string): void {
    if (!lifecycle) return;
    lifecycle.processTracker?.updateProcess(lifecycle.processId, 'completed', response);
    lifecycle.onItemProcess?.({
        nodeId: lifecycle.nodeId,
        itemIndex: lifecycle.itemIndex,
        processId: lifecycle.processId,
        status: 'completed',
        itemLabel: lifecycle.itemLabel,
    });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Invoke the AI provider for a workflow node with normalized lifecycle handling.
 *
 * Preconditions: `options.aiInvoker` must be set (throws otherwise).
 *
 * Cancellation (before, during, or after the call) is surfaced by throwing —
 * the returned result never represents a cancelled state.
 */
export async function invokeWorkflowAI(request: WorkflowAiRequest): Promise<WorkflowAiResult> {
    const { prompt, options, model, timeoutMs, requireResponse, failureMessage, lifecycle } = request;

    if (!options.aiInvoker) {
        throw new Error('WorkflowExecutionOptions.aiInvoker is required for AI-capable nodes');
    }

    reportRunning(lifecycle);

    let result;
    try {
        throwIfWorkflowCancelled(options.signal);
        result = await options.aiInvoker(prompt, {
            model: model ?? options.model,
            timeoutMs: timeoutMs ?? options.timeoutMs,
            workingDirectory: options.workingDirectory ?? options.workflowDirectory,
            signal: options.signal,
        });
        throwIfWorkflowCancelled(options.signal);
    } catch (err) {
        if (isWorkflowCancellationError(err) || options.signal?.aborted) {
            throwIfWorkflowCancelled(options.signal);
            throw err;
        }

        const error = err instanceof Error ? err.message : String(err);
        reportFailure(lifecycle, error);
        return { success: false, error, thrownError: err };
    }

    const failed = !result.success || (requireResponse === true && !result.response);
    if (failed) {
        reportFailure(lifecycle, result.error ?? failureMessage ?? 'AI invocation failed');
        return { success: false, response: result.response, error: result.error };
    }

    reportSuccess(lifecycle, result.response);
    return { success: true, response: result.response };
}
