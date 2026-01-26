/**
 * AI-Powered Reducer
 *
 * A reducer that uses AI to intelligently synthesize and deduplicate results.
 * Falls back to deterministic reduction on failure.
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
import { ResponseParsers } from '../prompt-template';

/**
 * Options for the AI reducer
 */
export interface AIReducerOptions<TMapOutput, TReduceOutput> {
    /**
     * AI invoker function for making the reduce call
     */
    aiInvoker: AIInvoker;

    /**
     * Function to build the reduce prompt from map outputs
     */
    buildPrompt: (outputs: TMapOutput[], context: ReduceContext) => string;

    /**
     * Function to parse the AI response into the reduce output
     */
    parseResponse: (response: string, originalOutputs: TMapOutput[]) => TReduceOutput;

    /**
     * Fallback reducer to use when AI fails
     */
    fallbackReducer: BaseReducer<TMapOutput, TReduceOutput>;

    /**
     * Optional model to use for the AI call
     */
    model?: string;
}

/**
 * AI-powered reducer that uses an additional AI call to synthesize results.
 * Provides intelligent deduplication, conflict resolution, and prioritization.
 */
export class AIReducer<TMapOutput, TReduceOutput> extends BaseReducer<TMapOutput, TReduceOutput> {
    constructor(private options: AIReducerOptions<TMapOutput, TReduceOutput>) {
        super();
    }

    /**
     * Reduce using AI-powered synthesis
     */
    async reduce(
        results: MapResult<TMapOutput>[],
        context: ReduceContext
    ): Promise<ReduceResult<TReduceOutput>> {
        const startTime = Date.now();
        const outputs = this.extractSuccessfulOutputs(results);

        // If no outputs, use fallback
        if (outputs.length === 0) {
            const fallbackResult = await this.options.fallbackReducer.reduce(results, context);
            return {
                ...fallbackResult,
                stats: {
                    ...fallbackResult.stats,
                    usedAIReduce: false
                }
            };
        }

        // Build the reduce prompt
        const prompt = this.options.buildPrompt(outputs, context);

        try {
            // Invoke AI
            const aiResult = await this.options.aiInvoker(prompt, {
                model: this.options.model
            });

            if (aiResult.success && aiResult.response) {
                // Parse the response
                const output = this.options.parseResponse(aiResult.response, outputs);
                const reduceTimeMs = Date.now() - startTime;

                return {
                    output,
                    stats: {
                        inputCount: outputs.length,
                        outputCount: 1,
                        mergedCount: outputs.length - 1,
                        reduceTimeMs,
                        usedAIReduce: true
                    }
                };
            }

            // AI failed, use fallback
            console.warn('AI reduce failed, falling back to deterministic:', aiResult.error);
            return this.fallbackWithStats(results, context, startTime);

        } catch (error) {
            // On any error, use fallback
            console.warn('AI reduce error, falling back to deterministic:', error);
            return this.fallbackWithStats(results, context, startTime);
        }
    }

    /**
     * Run fallback reducer and update stats
     */
    private async fallbackWithStats(
        results: MapResult<TMapOutput>[],
        context: ReduceContext,
        startTime: number
    ): Promise<ReduceResult<TReduceOutput>> {
        const fallbackResult = await this.options.fallbackReducer.reduce(results, context);
        const reduceTimeMs = Date.now() - startTime;

        return {
            ...fallbackResult,
            stats: {
                ...fallbackResult.stats,
                reduceTimeMs,
                usedAIReduce: false
            }
        };
    }
}

/**
 * Factory function to create an AI reducer
 */
export function createAIReducer<TMapOutput, TReduceOutput>(
    options: AIReducerOptions<TMapOutput, TReduceOutput>
): AIReducer<TMapOutput, TReduceOutput> {
    return new AIReducer(options);
}

/**
 * Generic AI synthesis reducer for text outputs
 * Synthesizes multiple text outputs into a single coherent summary
 */
export interface TextSynthesisOutput {
    /** Synthesized summary */
    summary: string;
    /** Key points extracted */
    keyPoints: string[];
    /** Original count */
    originalCount: number;
}

/**
 * Options for text synthesis reducer
 */
export interface TextSynthesisOptions {
    /** AI invoker function */
    aiInvoker: AIInvoker;
    /** Optional custom prompt prefix */
    promptPrefix?: string;
    /** Optional model to use */
    model?: string;
}

/**
 * Create a text synthesis reducer that combines text outputs using AI
 */
export function createTextSynthesisReducer(
    options: TextSynthesisOptions
): AIReducer<string, TextSynthesisOutput> {
    // Create a simple fallback reducer
    const fallbackReducer = new class extends BaseReducer<string, TextSynthesisOutput> {
        async reduce(
            results: MapResult<string>[],
            context: ReduceContext
        ): Promise<ReduceResult<TextSynthesisOutput>> {
            const outputs = this.extractSuccessfulOutputs(results);
            return {
                output: {
                    summary: outputs.join('\n\n---\n\n'),
                    keyPoints: outputs.slice(0, 5),
                    originalCount: outputs.length
                },
                stats: this.createStats(outputs.length, 1, 0, false)
            };
        }
    }();

    return createAIReducer<string, TextSynthesisOutput>({
        aiInvoker: options.aiInvoker,
        model: options.model,
        fallbackReducer,

        buildPrompt: (outputs, context) => {
            const prefix = options.promptPrefix || 'Synthesize the following inputs into a coherent summary:';
            const numberedOutputs = outputs.map((o, i) => `[${i + 1}] ${o}`).join('\n\n');

            return `${prefix}

${numberedOutputs}

Please provide:
1. A concise summary that combines all the key information
2. A list of key points (as a JSON array of strings)

Format your response as JSON:
{
  "summary": "Your synthesized summary here",
  "keyPoints": ["Point 1", "Point 2", "..."]
}`;
        },

        parseResponse: (response, originalOutputs) => {
            try {
                const parsed = ResponseParsers.json<{ summary: string; keyPoints: string[] }>(response);
                return {
                    summary: parsed.summary || '',
                    keyPoints: parsed.keyPoints || [],
                    originalCount: originalOutputs.length
                };
            } catch {
                // If parsing fails, return raw response as summary
                return {
                    summary: response,
                    keyPoints: [],
                    originalCount: originalOutputs.length
                };
            }
        }
    });
}
