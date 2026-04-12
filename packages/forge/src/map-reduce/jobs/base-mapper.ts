/**
 * BaseMapper — shared scaffold for AI map-reduce mappers.
 *
 * Encapsulates the repetitive try/catch + aiInvoker call pattern that every
 * mapper uses. Subclasses override three focused abstract methods:
 *  - buildPromptAndModel — domain-specific prompt construction
 *  - parseSuccessResponse — domain-specific response parsing
 *  - buildAIFailureResult — domain-specific failure result when AI fails
 *  - buildExceptionResult — domain-specific failure result when an exception is thrown
 */

import type { AIInvokerResult } from '../../ai/types';
import type { AIInvoker, MapContext, Mapper, WorkItem } from '../types';

/**
 * Abstract base class for map-reduce mappers.
 *
 * Subclasses only implement domain-specific prompt building, response parsing,
 * and failure result construction. The shared try/catch + AI invocation scaffold
 * lives here so improvements to error handling propagate to all jobs automatically.
 */
export abstract class BaseMapper<TInput, TOutput> implements Mapper<TInput, TOutput> {
    constructor(protected readonly aiInvoker: AIInvoker) {}

    async map(workItem: WorkItem<TInput>, _context: MapContext): Promise<TOutput> {
        try {
            const { prompt, model } = this.buildPromptAndModel(workItem);
            const result = await this.aiInvoker(prompt, { model });

            if (result.success && result.response) {
                return await this.parseSuccessResponse(workItem, result);
            }

            return this.buildAIFailureResult(workItem, result);
        } catch (error) {
            return this.buildExceptionResult(workItem, error);
        }
    }

    /**
     * Build the prompt string and optional model for this work item.
     * May throw (e.g. `MissingVariableError` from template rendering);
     * any thrown error is forwarded to `buildExceptionResult`.
     */
    protected abstract buildPromptAndModel(workItem: WorkItem<TInput>): { prompt: string; model?: string };

    /**
     * Parse a successful AI response and return the output.
     * Called only when `result.success && result.response` are both truthy.
     * Implementations may return a failure-flagged result on parse errors
     * by catching those errors internally.
     */
    protected abstract parseSuccessResponse(
        workItem: WorkItem<TInput>,
        result: AIInvokerResult
    ): TOutput | Promise<TOutput>;

    /**
     * Build a failure result when the AI invocation itself fails
     * (`result.success` is false or `result.response` is missing).
     */
    protected abstract buildAIFailureResult(workItem: WorkItem<TInput>, result: AIInvokerResult): TOutput;

    /**
     * Build a failure result when an exception is thrown anywhere in `map()`.
     * This includes errors from `buildPromptAndModel` and unexpected errors from
     * `parseSuccessResponse`.
     */
    protected abstract buildExceptionResult(workItem: WorkItem<TInput>, error: unknown): TOutput;

    /** Extract a human-readable message from an unknown thrown value. */
    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
