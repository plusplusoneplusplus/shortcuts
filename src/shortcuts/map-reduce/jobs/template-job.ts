/**
 * Template Job
 *
 * Helper for creating list + template prompt workflows.
 * Applies a prompt template to each item in a list.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    AIInvoker,
    MapContext,
    Mapper,
    MapReduceJob,
    MapResult,
    ReduceContext,
    ReduceResult,
    Splitter,
    WorkItem
} from '../types';
import { createTemplate, renderTemplate, MissingVariableError } from '../prompt-template';
import { PromptTemplate } from '../types';
import { BaseReducer, FlattenReducer } from '../reducers';

/**
 * A single item in the template job input
 */
export interface TemplateItem {
    /** Unique identifier for this item */
    id?: string;
    /** Variables to substitute in the template */
    variables: Record<string, string | number | boolean>;
    /** Optional metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Input for template job
 */
export interface TemplateJobInput {
    /** Items to process */
    items: TemplateItem[];
    /** Global variables available to all items */
    globalVariables?: Record<string, string | number | boolean>;
}

/**
 * Work item data for template processing
 */
export interface TemplateWorkItemData {
    /** The template item */
    item: TemplateItem;
    /** Global variables */
    globalVariables?: Record<string, string | number | boolean>;
}

/**
 * Result from processing a single template item
 */
export interface TemplateItemResult<TOutput = string> {
    /** Item ID */
    itemId: string;
    /** Whether processing succeeded */
    success: boolean;
    /** The output (if successful) */
    output?: TOutput;
    /** Error message (if failed) */
    error?: string;
    /** Raw AI response */
    rawResponse?: string;
}

/**
 * Options for template job
 */
export interface TemplateJobOptions<TOutput = string> {
    /** AI invoker function */
    aiInvoker: AIInvoker;
    /** Template string with {{variable}} placeholders */
    template: string;
    /** Required variables that must be present */
    requiredVariables?: string[];
    /** Optional system prompt */
    systemPrompt?: string;
    /** Function to parse the AI response */
    responseParser?: (response: string) => TOutput;
    /** Custom reducer (default: flatten results) */
    reducer?: BaseReducer<TemplateItemResult<TOutput>, unknown>;
    /** Optional model to use */
    model?: string;
}

/**
 * Splitter for template jobs - creates a work item for each input item
 */
class TemplateSplitter implements Splitter<TemplateJobInput, TemplateWorkItemData> {
    split(input: TemplateJobInput): WorkItem<TemplateWorkItemData>[] {
        return input.items.map((item, index) => ({
            id: item.id || `item-${index}`,
            data: {
                item,
                globalVariables: input.globalVariables
            },
            metadata: {
                index,
                totalItems: input.items.length,
                ...item.metadata
            }
        }));
    }
}

/**
 * Mapper for template jobs - applies template and invokes AI
 */
class TemplateMapper<TOutput> implements Mapper<TemplateWorkItemData, TemplateItemResult<TOutput>> {
    private promptTemplate: PromptTemplate;

    constructor(
        private aiInvoker: AIInvoker,
        private options: {
            template: string;
            requiredVariables?: string[];
            systemPrompt?: string;
            responseParser?: (response: string) => TOutput;
            model?: string;
        }
    ) {
        this.promptTemplate = createTemplate({
            template: options.template,
            requiredVariables: options.requiredVariables,
            systemPrompt: options.systemPrompt
        });
    }

    async map(
        workItem: WorkItem<TemplateWorkItemData>,
        context: MapContext
    ): Promise<TemplateItemResult<TOutput>> {
        const { item, globalVariables } = workItem.data;
        const itemId = item.id || workItem.id;

        // Merge global and item variables
        const variables = {
            ...globalVariables,
            ...item.variables
        };

        try {
            // Render the prompt
            const prompt = renderTemplate(this.promptTemplate, {
                variables,
                includeSystemPrompt: !!this.options.systemPrompt
            });

            // Invoke AI
            const result = await this.aiInvoker(prompt, {
                model: this.options.model
            });

            if (result.success && result.response) {
                // Parse response if parser provided
                const output = this.options.responseParser
                    ? this.options.responseParser(result.response)
                    : result.response as unknown as TOutput;

                return {
                    itemId,
                    success: true,
                    output,
                    rawResponse: result.response
                };
            }

            return {
                itemId,
                success: false,
                error: result.error || 'Unknown error',
                rawResponse: result.response
            };
        } catch (error) {
            if (error instanceof MissingVariableError) {
                return {
                    itemId,
                    success: false,
                    error: `Missing variable: ${error.variableName}`
                };
            }

            return {
                itemId,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
}

/**
 * Default reducer for template jobs - collects all results
 */
class TemplateResultsReducer<TOutput> extends BaseReducer<TemplateItemResult<TOutput>, TemplateItemResult<TOutput>[]> {
    async reduce(
        results: MapResult<TemplateItemResult<TOutput>>[],
        context: ReduceContext
    ): Promise<ReduceResult<TemplateItemResult<TOutput>[]>> {
        const startTime = Date.now();

        const outputs = results
            .filter(r => r.success && r.output)
            .map(r => r.output!);

        const reduceTimeMs = Date.now() - startTime;

        return {
            output: outputs,
            stats: {
                inputCount: results.length,
                outputCount: outputs.length,
                mergedCount: 0,
                reduceTimeMs,
                usedAIReduce: false
            }
        };
    }
}

/**
 * Create a template job
 */
export function createTemplateJob<TOutput = string>(
    options: TemplateJobOptions<TOutput>
): MapReduceJob<TemplateJobInput, TemplateWorkItemData, TemplateItemResult<TOutput>, TemplateItemResult<TOutput>[]> {
    return {
        id: 'template-job',
        name: 'Template Processing',
        splitter: new TemplateSplitter(),
        mapper: new TemplateMapper<TOutput>(options.aiInvoker, {
            template: options.template,
            requiredVariables: options.requiredVariables,
            systemPrompt: options.systemPrompt,
            responseParser: options.responseParser,
            model: options.model
        }),
        reducer: new TemplateResultsReducer<TOutput>(),
        options: {
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: true,
            retryOnFailure: false
        }
    };
}

/**
 * Create a simple string template job (no custom parsing)
 */
export function createSimpleTemplateJob(
    aiInvoker: AIInvoker,
    template: string,
    options?: {
        systemPrompt?: string;
        model?: string;
        maxConcurrency?: number;
    }
): MapReduceJob<TemplateJobInput, TemplateWorkItemData, TemplateItemResult<string>, TemplateItemResult<string>[]> {
    return createTemplateJob({
        aiInvoker,
        template,
        systemPrompt: options?.systemPrompt,
        model: options?.model
    });
}

/**
 * Create a JSON template job with type-safe parsing
 */
export function createJsonTemplateJob<TOutput>(
    aiInvoker: AIInvoker,
    template: string,
    options?: {
        systemPrompt?: string;
        model?: string;
        validator?: (obj: unknown) => obj is TOutput;
    }
): MapReduceJob<TemplateJobInput, TemplateWorkItemData, TemplateItemResult<TOutput>, TemplateItemResult<TOutput>[]> {
    const responseParser = (response: string): TOutput => {
        // Try to extract JSON from response
        const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : response;

        // Find JSON object or array
        const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
        const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
        const toParse = objectMatch?.[0] || arrayMatch?.[0] || jsonStr;

        const parsed = JSON.parse(toParse);

        if (options?.validator && !options.validator(parsed)) {
            throw new Error('Response validation failed');
        }

        return parsed;
    };

    return createTemplateJob<TOutput>({
        aiInvoker,
        template,
        systemPrompt: options?.systemPrompt,
        model: options?.model,
        responseParser
    });
}

/**
 * Create a list processing template job
 * Useful for processing a list of items and getting structured results
 */
export function createListProcessingJob<TInput, TOutput>(
    aiInvoker: AIInvoker,
    config: {
        /** Template with {{item}} placeholder for each list item */
        template: string;
        /** System prompt */
        systemPrompt?: string;
        /** Function to convert input items to template variables */
        itemToVariables: (item: TInput, index: number) => Record<string, string | number | boolean>;
        /** Function to parse AI response */
        responseParser: (response: string) => TOutput;
        /** Model to use */
        model?: string;
    }
): {
    createInput: (items: TInput[], globalVariables?: Record<string, string | number | boolean>) => TemplateJobInput;
    job: MapReduceJob<TemplateJobInput, TemplateWorkItemData, TemplateItemResult<TOutput>, TemplateItemResult<TOutput>[]>;
} {
    const job = createTemplateJob<TOutput>({
        aiInvoker,
        template: config.template,
        systemPrompt: config.systemPrompt,
        responseParser: config.responseParser,
        model: config.model
    });

    const createInput = (items: TInput[], globalVariables?: Record<string, string | number | boolean>): TemplateJobInput => ({
        items: items.map((item, index) => ({
            id: `item-${index}`,
            variables: config.itemToVariables(item, index)
        })),
        globalVariables
    });

    return { createInput, job };
}
