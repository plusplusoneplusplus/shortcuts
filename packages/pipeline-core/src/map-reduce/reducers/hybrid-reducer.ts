/**
 * Hybrid Reducer
 *
 * Combines deterministic reduction with AI polishing.
 * First performs code-based deduplication, then uses AI to refine the results.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    AIInvoker,
    MapResult,
    ReduceContext,
    ReduceResult,
    ReduceStats
} from '../types';
import { BaseReducer } from './reducer';
import { DeterministicReducer, DeterministicReducerOptions, DeterministicReduceOutput, Deduplicatable } from './deterministic';

/**
 * Options for the hybrid reducer
 */
export interface HybridReducerOptions<T extends Deduplicatable, TPolished> {
    /**
     * Options for the deterministic reduction phase
     */
    deterministicOptions: DeterministicReducerOptions<T>;

    /**
     * AI invoker for the polishing phase
     */
    aiInvoker: AIInvoker;

    /**
     * Function to build the polishing prompt from deterministic results
     */
    buildPolishPrompt: (deterministicOutput: DeterministicReduceOutput<T>, context: ReduceContext) => string;

    /**
     * Function to parse the polished AI response
     */
    parsePolishedResponse: (response: string, deterministicOutput: DeterministicReduceOutput<T>) => TPolished;

    /**
     * Function to create output when AI polishing is skipped or fails
     */
    createFallbackOutput: (deterministicOutput: DeterministicReduceOutput<T>) => TPolished;

    /**
     * Optional model to use for AI polishing
     */
    model?: string;

    /**
     * Whether to skip AI polishing if deterministic output is empty
     * Default: true
     */
    skipPolishIfEmpty?: boolean;
}

/**
 * Hybrid reducer that combines deterministic reduction with AI polishing.
 * 
 * Flow:
 * 1. Deterministic reduction (deduplication, merging)
 * 2. AI polishing (summarization, prioritization, formatting)
 */
export class HybridReducer<T extends Deduplicatable, TPolished> extends BaseReducer<T[], TPolished> {
    private deterministicReducer: DeterministicReducer<T>;

    constructor(private options: HybridReducerOptions<T, TPolished>) {
        super();
        this.deterministicReducer = new DeterministicReducer(options.deterministicOptions);
    }

    /**
     * Reduce using hybrid approach
     */
    async reduce(
        results: MapResult<T[]>[],
        context: ReduceContext
    ): Promise<ReduceResult<TPolished>> {
        const startTime = Date.now();

        // Step 1: Deterministic reduction
        const deterministicResult = await this.deterministicReducer.reduce(results, context);
        const deterministicOutput = deterministicResult.output;
        const deterministicTimeMs = deterministicResult.stats.reduceTimeMs;

        // Skip AI polishing if empty and configured to skip
        const skipPolishIfEmpty = this.options.skipPolishIfEmpty ?? true;
        if (skipPolishIfEmpty && deterministicOutput.items.length === 0) {
            const reduceTimeMs = Date.now() - startTime;
            return {
                output: this.options.createFallbackOutput(deterministicOutput),
                stats: {
                    ...deterministicResult.stats,
                    reduceTimeMs,
                    usedAIReduce: false
                }
            };
        }

        // Step 2: AI polishing
        const polishStartTime = Date.now();
        const prompt = this.options.buildPolishPrompt(deterministicOutput, context);

        try {
            const aiResult = await this.options.aiInvoker(prompt, {
                model: this.options.model
            });

            if (aiResult.success && aiResult.response) {
                const polishedOutput = this.options.parsePolishedResponse(
                    aiResult.response,
                    deterministicOutput
                );
                const reduceTimeMs = Date.now() - startTime;

                return {
                    output: polishedOutput,
                    stats: {
                        inputCount: deterministicResult.stats.inputCount,
                        outputCount: deterministicResult.stats.outputCount,
                        mergedCount: deterministicResult.stats.mergedCount,
                        reduceTimeMs,
                        usedAIReduce: true
                    }
                };
            }

            // AI failed, use fallback
            console.warn('AI polishing failed, using deterministic result:', aiResult.error);
            return this.createFallbackResult(deterministicOutput, deterministicResult.stats, startTime);

        } catch (error) {
            console.warn('AI polishing error, using deterministic result:', error);
            return this.createFallbackResult(deterministicOutput, deterministicResult.stats, startTime);
        }
    }

    /**
     * Create a fallback result using the deterministic output
     */
    private createFallbackResult(
        deterministicOutput: DeterministicReduceOutput<T>,
        deterministicStats: ReduceStats,
        startTime: number
    ): ReduceResult<TPolished> {
        const reduceTimeMs = Date.now() - startTime;

        return {
            output: this.options.createFallbackOutput(deterministicOutput),
            stats: {
                ...deterministicStats,
                reduceTimeMs,
                usedAIReduce: false
            }
        };
    }
}

/**
 * Factory function to create a hybrid reducer
 */
export function createHybridReducer<T extends Deduplicatable, TPolished>(
    options: HybridReducerOptions<T, TPolished>
): HybridReducer<T, TPolished> {
    return new HybridReducer(options);
}

/**
 * Simple polished output interface for common use cases
 */
export interface SimplePolishedOutput<T> {
    /** The processed items */
    items: T[];
    /** AI-generated summary */
    summary: string;
    /** Statistics */
    stats: {
        originalCount: number;
        processedCount: number;
        dedupedCount: number;
    };
}

/**
 * Create a simple hybrid reducer with default polishing behavior
 */
export function createSimpleHybridReducer<T extends Deduplicatable>(
    deterministicOptions: DeterministicReducerOptions<T>,
    aiInvoker: AIInvoker,
    formatForPrompt: (items: T[]) => string,
    model?: string
): HybridReducer<T, SimplePolishedOutput<T>> {
    return createHybridReducer<T, SimplePolishedOutput<T>>({
        deterministicOptions,
        aiInvoker,
        model,

        buildPolishPrompt: (deterministicOutput, context) => {
            const formatted = formatForPrompt(deterministicOutput.items);
            return `Review and summarize the following ${deterministicOutput.items.length} items:

${formatted}

Provide a brief summary (2-3 sentences) of the key findings.`;
        },

        parsePolishedResponse: (response, deterministicOutput) => {
            return {
                items: deterministicOutput.items,
                summary: response.trim(),
                stats: {
                    originalCount: deterministicOutput.items.length,
                    processedCount: deterministicOutput.items.length,
                    dedupedCount: 0
                }
            };
        },

        createFallbackOutput: (deterministicOutput) => {
            return {
                items: deterministicOutput.items,
                summary: `Found ${deterministicOutput.items.length} items.`,
                stats: {
                    originalCount: deterministicOutput.items.length,
                    processedCount: deterministicOutput.items.length,
                    dedupedCount: 0
                }
            };
        }
    });
}
