/**
 * Validate Command
 *
 * Validates a pipeline YAML file without executing it.
 * Checks structure, input sources, template variables, and filter configuration.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
    readCSVFileSync,
    resolveCSVPath,
    isCSVSource,
    isGenerateConfig,
} from '@plusplusoneplusplus/pipeline-core';
import type { PipelineConfig, FilterConfig } from '@plusplusoneplusplus/pipeline-core';
import {
    printSuccess,
    printError,
    printWarning,
    printHeader,
    green,
    yellow,
    red,
    SYMBOLS,
} from '../logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a validation check
 */
export interface ValidationCheck {
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail?: string;
}

/**
 * Overall validation result
 */
export interface ValidationResult {
    valid: boolean;
    pipelineName: string;
    checks: ValidationCheck[];
}

// ============================================================================
// Validate Command
// ============================================================================

/**
 * Execute the validate command
 *
 * @param pipelinePath Path to pipeline.yaml or the directory containing it
 * @returns exit code (0 = valid, 2 = invalid)
 */
export function executeValidate(pipelinePath: string): number {
    const resolvedPath = resolvePipelinePath(pipelinePath);

    if (!resolvedPath) {
        printError(`Pipeline file not found: ${pipelinePath}`);
        return 2;
    }

    const result = validatePipeline(resolvedPath);
    printValidationResult(result);

    return result.valid ? 0 : 2;
}

/**
 * Resolve a pipeline path to the actual pipeline.yaml file
 */
export function resolvePipelinePath(input: string): string | undefined {
    const resolved = path.resolve(input);

    // If it's a file, use it directly
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
    }

    // If it's a directory, look for pipeline.yaml inside
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        const yamlPath = path.join(resolved, 'pipeline.yaml');
        if (fs.existsSync(yamlPath)) {
            return yamlPath;
        }
    }

    return undefined;
}

/**
 * Validate a pipeline YAML file and return structured results
 */
export function validatePipeline(yamlPath: string): ValidationResult {
    const checks: ValidationCheck[] = [];
    let pipelineName = 'Unknown';
    let config: PipelineConfig | undefined;

    // 1. Parse YAML (raw parse without pipeline-core's strict validation)
    try {
        const content = fs.readFileSync(yamlPath, 'utf-8');
        const parsed = yaml.load(content) as PipelineConfig;
        if (!parsed || typeof parsed !== 'object') {
            checks.push({
                label: 'YAML parsing',
                status: 'fail',
                detail: 'File does not contain a valid YAML object',
            });
            return { valid: false, pipelineName, checks };
        }
        config = parsed;
        pipelineName = config.name || 'Unknown';

        if (!config.name) {
            checks.push({
                label: 'Pipeline name',
                status: 'fail',
                detail: 'Pipeline config missing "name"',
            });
        } else {
            checks.push({
                label: `Pipeline "${config.name}" is valid YAML`,
                status: 'pass',
            });
        }

        if (!config.map) {
            checks.push({
                label: 'Map configuration',
                status: 'fail',
                detail: 'Pipeline config missing "map"',
            });
        }

        if (!config.reduce) {
            checks.push({
                label: 'Reduce configuration',
                status: 'fail',
                detail: 'Pipeline config missing "reduce"',
            });
        }

        if (!config.input) {
            checks.push({
                label: 'Input configuration',
                status: 'fail',
                detail: 'Pipeline config missing "input"',
            });
        }

        // If any core sections are missing, return early
        if (!config.name || !config.map || !config.reduce || !config.input) {
            return { valid: false, pipelineName, checks };
        }
    } catch (error) {
        checks.push({
            label: 'YAML parsing',
            status: 'fail',
            detail: error instanceof Error ? error.message : String(error),
        });
        return { valid: false, pipelineName, checks };
    }

    const pipelineDir = path.dirname(yamlPath);

    // 2. Validate input configuration
    validateInput(config, pipelineDir, checks);

    // 3. Validate map configuration
    validateMap(config, checks);

    // 4. Validate reduce configuration
    validateReduce(config, checks);

    // 5. Validate filter configuration (if present)
    if (config.filter) {
        validateFilter(config.filter, checks);
    }

    const hasFailure = checks.some(c => c.status === 'fail');
    return { valid: !hasFailure, pipelineName, checks };
}

// ============================================================================
// Validation Helpers
// ============================================================================

function validateInput(
    config: PipelineConfig,
    pipelineDir: string,
    checks: ValidationCheck[]
): void {
    const { input } = config;

    if (input.items) {
        const count = input.items.length;
        checks.push({
            label: `Input: ${count} inline item${count !== 1 ? 's' : ''}`,
            status: 'pass',
        });
    } else if (input.from && isCSVSource(input.from)) {
        try {
            const csvPath = resolveCSVPath(input.from.path, pipelineDir);
            if (!fs.existsSync(csvPath)) {
                checks.push({
                    label: `Input: CSV at ${input.from.path}`,
                    status: 'fail',
                    detail: `File not found: ${csvPath}`,
                });
                return;
            }
            const csv = readCSVFileSync(csvPath, {
                delimiter: input.from.delimiter,
            });
            checks.push({
                label: `Input: CSV at ${input.from.path} (found, ${csv.rowCount} row${csv.rowCount !== 1 ? 's' : ''})`,
                status: 'pass',
            });
        } catch (error) {
            checks.push({
                label: `Input: CSV at ${input.from.path}`,
                status: 'fail',
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    } else if (input.from && Array.isArray(input.from)) {
        checks.push({
            label: `Input: ${input.from.length} inline list item${input.from.length !== 1 ? 's' : ''}`,
            status: 'pass',
        });
    } else if (input.generate && isGenerateConfig(input.generate)) {
        checks.push({
            label: `Input: AI-generated (schema: ${input.generate.schema.join(', ')})`,
            status: 'pass',
        });
    } else {
        checks.push({
            label: 'Input configuration',
            status: 'fail',
            detail: 'Must have exactly one of: items, from, or generate',
        });
    }

    if (input.limit !== undefined) {
        if (input.limit > 0) {
            checks.push({
                label: `Input limit: ${input.limit}`,
                status: 'pass',
            });
        } else {
            checks.push({
                label: 'Input limit',
                status: 'warn',
                detail: `Limit should be > 0, got ${input.limit}`,
            });
        }
    }

    if (input.parameters && input.parameters.length > 0) {
        const paramNames = input.parameters.map(p => p.name).join(', ');
        checks.push({
            label: `Parameters: ${paramNames}`,
            status: 'pass',
        });
    }
}

function validateMap(config: PipelineConfig, checks: ValidationCheck[]): void {
    const { map } = config;

    // Check prompt source
    if (map.prompt) {
        // Extract template variables
        const variables = extractTemplateVars(map.prompt);
        if (variables.length > 0) {
            checks.push({
                label: `Map: prompt uses variables {{${variables.join('}}, {{')}}}`,
                status: 'pass',
            });
        } else {
            checks.push({
                label: 'Map: prompt (no template variables)',
                status: 'warn',
                detail: 'No {{variable}} placeholders found in prompt',
            });
        }
    } else if (map.promptFile) {
        checks.push({
            label: `Map: prompt from file "${map.promptFile}"`,
            status: 'pass',
        });
    } else {
        checks.push({
            label: 'Map: prompt',
            status: 'fail',
            detail: 'Either "prompt" or "promptFile" must be specified',
        });
    }

    // Check output fields
    if (map.output && map.output.length > 0) {
        checks.push({
            label: `Map output fields: ${map.output.join(', ')}`,
            status: 'pass',
        });
    } else {
        checks.push({
            label: 'Map: text mode (no structured output fields)',
            status: 'pass',
        });
    }

    // Check batch size
    if (map.batchSize !== undefined) {
        if (map.batchSize > 1) {
            checks.push({
                label: `Map: batch mode (${map.batchSize} items per call)`,
                status: 'pass',
            });
        } else if (map.batchSize < 1) {
            checks.push({
                label: 'Map: batchSize',
                status: 'warn',
                detail: `batchSize should be >= 1, got ${map.batchSize}`,
            });
        }
    }

    // Check parallel
    if (map.parallel !== undefined && map.parallel < 1) {
        checks.push({
            label: 'Map: parallel',
            status: 'warn',
            detail: `parallel should be >= 1, got ${map.parallel}`,
        });
    }

    // Check skill
    if (map.skill) {
        checks.push({
            label: `Map: skill "${map.skill}"`,
            status: 'pass',
        });
    }
}

function validateReduce(config: PipelineConfig, checks: ValidationCheck[]): void {
    const { reduce } = config;
    const validTypes = ['list', 'table', 'json', 'csv', 'ai', 'text'];

    if (validTypes.includes(reduce.type)) {
        checks.push({
            label: `Reduce: ${reduce.type} format`,
            status: 'pass',
        });
    } else {
        checks.push({
            label: 'Reduce type',
            status: 'fail',
            detail: `Invalid reduce type: "${reduce.type}". Valid: ${validTypes.join(', ')}`,
        });
    }

    // AI reduce requires prompt
    if (reduce.type === 'ai') {
        if (reduce.prompt || reduce.promptFile) {
            checks.push({
                label: 'Reduce: AI prompt configured',
                status: 'pass',
            });
        } else {
            checks.push({
                label: 'Reduce: AI prompt',
                status: 'fail',
                detail: 'AI reduce requires either "prompt" or "promptFile"',
            });
        }
    }
}

function validateFilter(filter: FilterConfig, checks: ValidationCheck[]): void {
    const validTypes = ['rule', 'ai', 'hybrid'];

    if (!validTypes.includes(filter.type)) {
        checks.push({
            label: 'Filter type',
            status: 'fail',
            detail: `Invalid filter type: "${filter.type}". Valid: ${validTypes.join(', ')}`,
        });
        return;
    }

    if (filter.type === 'rule' || filter.type === 'hybrid') {
        if (filter.rule && filter.rule.rules && filter.rule.rules.length > 0) {
            const mode = filter.rule.mode || 'all';
            checks.push({
                label: `Filter: rule-based (${filter.rule.rules.length} rule${filter.rule.rules.length !== 1 ? 's' : ''}, mode: ${mode})`,
                status: 'pass',
            });
        } else if (filter.type === 'rule') {
            checks.push({
                label: 'Filter: rules',
                status: 'fail',
                detail: 'Rule filter requires at least one rule in rule.rules',
            });
        }
    }

    if (filter.type === 'ai' || filter.type === 'hybrid') {
        if (filter.ai && filter.ai.prompt) {
            checks.push({
                label: 'Filter: AI-based configured',
                status: 'pass',
            });
        } else if (filter.type === 'ai') {
            checks.push({
                label: 'Filter: AI config',
                status: 'fail',
                detail: 'AI filter requires ai.prompt',
            });
        }
    }

    if (filter.type === 'hybrid') {
        const combineMode = filter.combineMode || 'and';
        checks.push({
            label: `Filter: hybrid (combineMode: ${combineMode})`,
            status: 'pass',
        });
    }
}

/**
 * Extract template variable names from a prompt string
 */
function extractTemplateVars(template: string): string[] {
    const regex = /\{\{(\w+)\}\}/g;
    const vars = new Set<string>();
    let match;
    while ((match = regex.exec(template)) !== null) {
        vars.add(match[1]);
    }
    return Array.from(vars);
}

// ============================================================================
// Output Formatting
// ============================================================================

function printValidationResult(result: ValidationResult): void {
    printHeader(`Pipeline Validation: ${result.pipelineName}`);

    for (const check of result.checks) {
        const symbol = check.status === 'pass'
            ? green(SYMBOLS.success)
            : check.status === 'warn'
                ? yellow(SYMBOLS.warning)
                : red(SYMBOLS.error);

        process.stderr.write(`${symbol} ${check.label}\n`);
        if (check.detail) {
            process.stderr.write(`  ${check.status === 'fail' ? red(check.detail) : yellow(check.detail)}\n`);
        }
    }

    process.stderr.write('\n');

    if (result.valid) {
        printSuccess('Pipeline is valid');
    } else {
        printError('Pipeline has validation errors');
    }
}
