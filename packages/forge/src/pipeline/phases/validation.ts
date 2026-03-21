/**
 * Pipeline Validation
 *
 * Validates pipeline configuration before execution.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    PipelineConfig,
    isCSVSource,
    isGenerateConfig,
} from '../types';
import { validateGenerateConfig } from '../input-generator';
import { PipelineExecutionError } from './shared';
import { getLogger, LogCategory } from '../../logger';

/**
 * Validate map configuration (prompt/promptFile and optional skill)
 */
export function validateMapConfig(config: PipelineConfig): void {
    if (!config.map) {
        throw new PipelineExecutionError('Pipeline config missing "map"');
    }

    // Validate prompt configuration (must have exactly one of prompt or promptFile)
    const hasPrompt = !!config.map.prompt;
    const hasPromptFile = !!config.map.promptFile;
    
    if (!hasPrompt && !hasPromptFile) {
        throw new PipelineExecutionError('Pipeline config must have either "map.prompt" or "map.promptFile"');
    }
    if (hasPrompt && hasPromptFile) {
        throw new PipelineExecutionError('Pipeline config cannot have both "map.prompt" and "map.promptFile"');
    }

    // Validate skill name if provided (skill is optional and can be combined with prompt/promptFile)
    if (config.map.skill !== undefined && typeof config.map.skill !== 'string') {
        throw new PipelineExecutionError('Pipeline config "map.skill" must be a string');
    }

    // map.output is optional - if omitted, text mode is used
    if (config.map.output !== undefined && !Array.isArray(config.map.output)) {
        throw new PipelineExecutionError('Pipeline config "map.output" must be an array if provided');
    }

    // Validate batchSize if provided
    if (config.map.batchSize !== undefined) {
        if (typeof config.map.batchSize !== 'number' || !Number.isInteger(config.map.batchSize)) {
            throw new PipelineExecutionError('Pipeline config "map.batchSize" must be a positive integer');
        }
        if (config.map.batchSize < 1) {
            throw new PipelineExecutionError('Pipeline config "map.batchSize" must be at least 1');
        }
        // When batchSize > 1, prompt should contain {{ITEMS}}
        if (config.map.batchSize > 1) {
            const prompt = config.map.prompt || '';
            if (!prompt.includes('{{ITEMS}}')) {
                getLogger().warn(LogCategory.PIPELINE, 'Warning: batchSize > 1 but prompt does not contain {{ITEMS}}. Consider using {{ITEMS}} to access batch items.');
            }
        }
    }
}

/**
 * Validate reduce configuration
 */
export function validateReduceConfig(config: PipelineConfig): void {
    if (!config.reduce) {
        throw new PipelineExecutionError('Pipeline config missing "reduce"');
    }

    const validReduceTypes = ['list', 'table', 'json', 'csv', 'ai', 'text'];
    if (!validReduceTypes.includes(config.reduce.type)) {
        throw new PipelineExecutionError(
            `Unsupported reduce type: ${config.reduce.type}. Supported types: ${validReduceTypes.join(', ')}`
        );
    }

    // Validate AI reduce configuration
    if (config.reduce.type === 'ai') {
        const hasPrompt = !!config.reduce.prompt;
        const hasPromptFile = !!config.reduce.promptFile;
        
        if (!hasPrompt && !hasPromptFile) {
            throw new PipelineExecutionError(
                'Pipeline config must have either "reduce.prompt" or "reduce.promptFile" when reduce.type is "ai"'
            );
        }
        if (hasPrompt && hasPromptFile) {
            throw new PipelineExecutionError('Pipeline config cannot have both "reduce.prompt" and "reduce.promptFile"');
        }
        
        // Validate skill name if provided (skill is optional and can be combined with prompt/promptFile)
        if (config.reduce.skill !== undefined && typeof config.reduce.skill !== 'string') {
            throw new PipelineExecutionError('Pipeline config "reduce.skill" must be a string');
        }
        
        if (config.reduce.output !== undefined && !Array.isArray(config.reduce.output)) {
            throw new PipelineExecutionError('Pipeline config "reduce.output" must be an array if provided');
        }
    }
}

/**
 * Validate input configuration
 */
export function validateInputConfig(config: PipelineConfig): void {
    if (!config.input) {
        throw new PipelineExecutionError('Pipeline config missing "input"');
    }

    // Count how many input sources are specified
    const hasItems = !!config.input.items;
    const hasFrom = !!config.input.from;
    const hasGenerate = !!config.input.generate;
    const sourceCount = [hasItems, hasFrom, hasGenerate].filter(Boolean).length;

    if (sourceCount === 0) {
        throw new PipelineExecutionError('Input must have one of "items", "from", or "generate"');
    }
    if (sourceCount > 1) {
        throw new PipelineExecutionError('Input can only have one of "items", "from", or "generate"');
    }

    // Validate generate config if present
    if (hasGenerate) {
        if (!isGenerateConfig(config.input.generate)) {
            throw new PipelineExecutionError('Invalid generate configuration');
        }
        const validation = validateGenerateConfig(config.input.generate);
        if (!validation.valid) {
            throw new PipelineExecutionError(
                `Invalid generate configuration: ${validation.errors.join('; ')}`
            );
        }
        if (!config.input.generate.autoApprove) {
            throw new PipelineExecutionError(
                'Pipelines with "generate" input require interactive approval. Use the Pipeline Preview to generate and approve items first, or set "autoApprove: true" in the generate config.',
                'input'
            );
        }
    }

    // Validate from source if present
    if (config.input.from) {
        if (!Array.isArray(config.input.from) && !isCSVSource(config.input.from)) {
            const fromObj = config.input.from as Record<string, unknown>;
            if (fromObj.type && fromObj.type !== 'csv') {
                throw new PipelineExecutionError(
                    `Unsupported source type: ${fromObj.type}. Only "csv" is supported.`
                );
            }
            throw new PipelineExecutionError(
                'Invalid "from" configuration. Must be either a CSV source {type: "csv", path: "..."} or an inline array.'
            );
        }
        if (isCSVSource(config.input.from) && !config.input.from.path) {
            throw new PipelineExecutionError('Pipeline config missing "input.from.path"');
        }
    }

    // Validate inline items if present
    if (config.input.items && !Array.isArray(config.input.items)) {
        throw new PipelineExecutionError('Pipeline config "input.items" must be an array');
    }

    // Validate parameters if present
    if (config.input.parameters) {
        if (!Array.isArray(config.input.parameters)) {
            throw new PipelineExecutionError('Pipeline config "input.parameters" must be an array');
        }
        for (const param of config.input.parameters) {
            if (!param.name || typeof param.name !== 'string') {
                throw new PipelineExecutionError('Each parameter must have a "name" string');
            }
            if (param.value === undefined || param.value === null) {
                throw new PipelineExecutionError(`Parameter "${param.name}" must have a "value"`);
            }
        }
    }
}

/**
 * Validate job configuration
 */
export function validateJobConfig(config: PipelineConfig): void {
    if (!config.job!.prompt && !config.job!.promptFile) {
        throw new PipelineExecutionError('Job config must have either "job.prompt" or "job.promptFile"', 'job');
    }
    if (config.job!.prompt && config.job!.promptFile) {
        throw new PipelineExecutionError('Job config cannot have both "job.prompt" and "job.promptFile"', 'job');
    }
}

/**
 * Validate full pipeline configuration (including input)
 */
export function validatePipelineConfig(config: PipelineConfig): void {
    if (!config.name) {
        throw new PipelineExecutionError('Pipeline config missing "name"');
    }

    // Check mutual exclusion
    if (config.job && config.map) {
        throw new PipelineExecutionError('Cannot use `job` and `map` in the same pipeline');
    }

    // Job mode
    if (config.job) {
        validateJobConfig(config);
        return;
    }

    // Map-reduce mode
    validateInputConfig(config);
    validateMapConfig(config);
    validateReduceConfig(config);
}

/**
 * Validate pipeline configuration for execution (without input source validation)
 * Used when executing with pre-approved items.
 */
export function validatePipelineConfigForExecution(config: PipelineConfig): void {
    if (!config.name) {
        throw new PipelineExecutionError('Pipeline config missing "name"');
    }

    // Job mode doesn't need map/reduce validation
    if (config.job) {
        validateJobConfig(config);
        return;
    }

    validateMapConfig(config);
    validateReduceConfig(config);
}
