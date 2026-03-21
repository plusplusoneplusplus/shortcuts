/**
 * Pipeline Input Loader
 *
 * Loads and prepares input items from various sources (inline, CSV, generated).
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    AIInvoker,
    isCSVSource,
    isGenerateConfig,
} from '../types';
import {
    PromptItem,
} from '../../map-reduce';
import { readCSVFile, resolveCSVPath } from '../csv-reader';
import { extractVariables } from '../template';
import { validateGenerateConfig, generateInputItems } from '../input-generator';
import { PipelineExecutionError, MapReducePipelineConfig, convertParametersToObject } from './shared';

/**
 * Load items from input source (inline items, CSV, or inline array)
 */
export async function loadInputItems(config: MapReducePipelineConfig, pipelineDirectory: string, aiInvoker?: AIInvoker): Promise<PromptItem[]> {
    try {
        if (config.input.items) {
            return config.input.items;
        }
        
        if (config.input.from) {
            if (isCSVSource(config.input.from)) {
                const csvPath = resolveCSVPath(config.input.from.path, pipelineDirectory);
                const result = await readCSVFile(csvPath, {
                    delimiter: config.input.from.delimiter
                });
                return result.items;
            }
            
            if (Array.isArray(config.input.from)) {
                return config.input.from;
            }
            
            throw new PipelineExecutionError('Invalid "from" configuration', 'input');
        }

        if (config.input.generate && isGenerateConfig(config.input.generate)) {
            if (!aiInvoker) {
                throw new PipelineExecutionError('AI invoker is required for generate input', 'input');
            }
            const result = await generateInputItems(config.input.generate, aiInvoker);
            if (!result.success || !result.items) {
                throw new PipelineExecutionError(
                    `Failed to generate input items: ${result.error || 'unknown error'}`,
                    'input'
                );
            }
            return result.items;
        }
        
        throw new PipelineExecutionError('Input must have either "items", "from", or "generate"', 'input');
    } catch (error) {
        if (error instanceof PipelineExecutionError) {
            throw error;
        }
        throw new PipelineExecutionError(
            `Failed to read input: ${error instanceof Error ? error.message : String(error)}`,
            'input'
        );
    }
}

/**
 * Prepare items by applying limit, merging parameters, and validating template variables
 */
export function prepareItems(items: PromptItem[], config: MapReducePipelineConfig, mapPrompt: string): PromptItem[] {
    // Apply limit
    const limit = config.input.limit ?? items.length;
    let result = items.slice(0, limit);

    // Merge parameters into each item (parameters take lower precedence than item fields)
    if (config.input.parameters && config.input.parameters.length > 0) {
        const paramValues = convertParametersToObject(config.input.parameters);
        result = result.map(item => ({ ...paramValues, ...item }));
    }

    // Validate that items have required template variables
    if (result.length > 0) {
        const templateVars = extractVariables(mapPrompt);
        const firstItem = result[0];
        const missingVars = templateVars.filter(v => !(v in firstItem));
        if (missingVars.length > 0) {
            throw new PipelineExecutionError(
                `Items missing required fields: ${missingVars.join(', ')}`,
                'input'
            );
        }
    }

    return result;
}
