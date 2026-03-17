/**
 * Filter Executor
 *
 * Implements rule-based, AI-based, and hybrid filtering for pipeline items.
 * The filter phase reduces the number of items before the expensive map phase.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    AIInvoker,
    AIFilterConfig,
    FilterConfig,
    FilterResult,
    FilterRule,
    FilterStats,
    PromptItem,
    RuleFilterConfig,
    ProcessTracker
} from './types';
import { substituteTemplate } from './template';
import { getLogger, LogCategory } from '../logger';

/**
 * Options for filter execution
 */
export interface FilterExecuteOptions {
    /** AI invoker function (required for ai/hybrid filters) */
    aiInvoker?: AIInvoker;
    /** Optional process tracker for AI process manager integration */
    processTracker?: ProcessTracker;
    /** Progress callback */
    onProgress?: (progress: FilterProgress) => void;
    /** Optional cancellation check function */
    isCancelled?: () => boolean;
}

/**
 * Progress information for filter execution
 */
export interface FilterProgress {
    /** Current phase */
    phase: 'rule' | 'ai';
    /** Items processed so far */
    processed: number;
    /** Total items to process */
    total: number;
    /** Number of items included so far */
    included: number;
    /** Number of items excluded so far */
    excluded: number;
}

/**
 * Execute filter phase on input items
 * 
 * @param items Input items to filter
 * @param filterConfig Filter configuration
 * @param options Execution options
 * @returns Filtered items with metadata
 */
export async function executeFilter(
    items: PromptItem[],
    filterConfig: FilterConfig,
    options: FilterExecuteOptions
): Promise<FilterResult> {
    switch (filterConfig.type) {
        case 'rule':
            if (!filterConfig.rule) {
                throw new Error('Rule filter requires "rule" configuration');
            }
            return executeRuleFilter(items, filterConfig.rule, options);
        
        case 'ai':
            if (!filterConfig.ai) {
                throw new Error('AI filter requires "ai" configuration');
            }
            if (!options.aiInvoker) {
                throw new Error('AI filter requires aiInvoker in options');
            }
            return executeAIFilter(items, filterConfig.ai, options);
        
        case 'hybrid':
            if (!filterConfig.rule || !filterConfig.ai) {
                throw new Error('Hybrid filter requires both "rule" and "ai" configuration');
            }
            if (!options.aiInvoker) {
                throw new Error('Hybrid filter requires aiInvoker in options');
            }
            return executeHybridFilter(items, filterConfig, options);
        
        default:
            throw new Error(`Unknown filter type: ${(filterConfig as any).type}`);
    }
}

/**
 * Execute rule-based filter (synchronous, fast)
 */
export async function executeRuleFilter(
    items: PromptItem[],
    config: RuleFilterConfig,
    options: FilterExecuteOptions
): Promise<FilterResult> {
    const startTime = Date.now();
    const included: PromptItem[] = [];
    const excluded: PromptItem[] = [];

    for (let i = 0; i < items.length; i++) {
        // Check for cancellation
        if (options.isCancelled?.()) {
            throw new Error('Filter execution cancelled');
        }

        const item = items[i];
        const passed = evaluateAllRules(item, config);
        
        if (passed) {
            included.push(item);
        } else {
            excluded.push(item);
        }

        // Report progress
        if (options.onProgress && (i % 100 === 0 || i === items.length - 1)) {
            options.onProgress({
                phase: 'rule',
                processed: i + 1,
                total: items.length,
                included: included.length,
                excluded: excluded.length
            });
        }
    }

    return {
        included,
        excluded,
        stats: {
            totalItems: items.length,
            includedCount: included.length,
            excludedCount: excluded.length,
            executionTimeMs: Date.now() - startTime,
            filterType: 'rule'
        }
    };
}

/**
 * Execute AI-based filter (asynchronous, uses AI calls)
 */
export async function executeAIFilter(
    items: PromptItem[],
    config: AIFilterConfig,
    options: FilterExecuteOptions
): Promise<FilterResult> {
    const startTime = Date.now();
    const included: PromptItem[] = [];
    const excluded: PromptItem[] = [];
    const parallelLimit = config.parallel ?? 5;
    const timeoutMs = config.timeoutMs ?? 30000; // 30 seconds default
    
    // Process items in parallel batches
    for (let i = 0; i < items.length; i += parallelLimit) {
        // Check for cancellation
        if (options.isCancelled?.()) {
            throw new Error('Filter execution cancelled');
        }

        const batch = items.slice(i, Math.min(i + parallelLimit, items.length));
        const results = await Promise.all(
            batch.map(item => evaluateAIRule(item, config, options.aiInvoker!, timeoutMs))
        );

        // Categorize results
        for (let j = 0; j < batch.length; j++) {
            if (results[j]) {
                included.push(batch[j]);
            } else {
                excluded.push(batch[j]);
            }
        }

        // Report progress
        if (options.onProgress) {
            options.onProgress({
                phase: 'ai',
                processed: Math.min(i + parallelLimit, items.length),
                total: items.length,
                included: included.length,
                excluded: excluded.length
            });
        }
    }

    return {
        included,
        excluded,
        stats: {
            totalItems: items.length,
            includedCount: included.length,
            excludedCount: excluded.length,
            executionTimeMs: Date.now() - startTime,
            filterType: 'ai'
        }
    };
}

/**
 * Execute hybrid filter (rule-based pre-filter + AI confirmation)
 */
export async function executeHybridFilter(
    items: PromptItem[],
    config: FilterConfig,
    options: FilterExecuteOptions
): Promise<FilterResult> {
    const startTime = Date.now();
    const combineMode = config.combineMode ?? 'and';

    // Step 1: Apply rule filter
    const ruleResult = await executeRuleFilter(items, config.rule!, options);

    if (combineMode === 'or') {
        // OR mode: AI filter evaluates excluded items, include if AI passes
        const aiResult = await executeAIFilter(ruleResult.excluded, config.ai!, options);
        
        return {
            included: [...ruleResult.included, ...aiResult.included],
            excluded: aiResult.excluded,
            stats: {
                totalItems: items.length,
                includedCount: ruleResult.included.length + aiResult.included.length,
                excludedCount: aiResult.excluded.length,
                executionTimeMs: Date.now() - startTime,
                filterType: 'hybrid'
            }
        };
    } else {
        // AND mode (default): AI filter evaluates included items, keep only if AI passes
        const aiResult = await executeAIFilter(ruleResult.included, config.ai!, options);
        
        return {
            included: aiResult.included,
            excluded: [...ruleResult.excluded, ...aiResult.excluded],
            stats: {
                totalItems: items.length,
                includedCount: aiResult.included.length,
                excludedCount: ruleResult.excluded.length + aiResult.excluded.length,
                executionTimeMs: Date.now() - startTime,
                filterType: 'hybrid'
            }
        };
    }
}

/**
 * Evaluate all rules for an item
 */
function evaluateAllRules(item: PromptItem, config: RuleFilterConfig): boolean {
    const mode = config.mode ?? 'all';
    
    if (mode === 'all') {
        // AND: Every rule must pass
        return config.rules.every(rule => evaluateRule(item, rule));
    } else {
        // OR: At least one rule must pass
        return config.rules.some(rule => evaluateRule(item, rule));
    }
}

/**
 * Evaluate a single rule against an item
 */
function evaluateRule(item: PromptItem, rule: FilterRule): boolean {
    const fieldValue = getNestedValue(item, rule.field);
    
    // Handle missing field - treat as false
    if (fieldValue === undefined || fieldValue === null) {
        return false;
    }
    
    switch (rule.operator) {
        case 'equals':
            return fieldValue === rule.value;
        
        case 'not_equals':
            return fieldValue !== rule.value;
        
        case 'in':
            return rule.values?.includes(fieldValue) ?? false;
        
        case 'not_in':
            return !rule.values?.includes(fieldValue);
        
        case 'contains':
            return String(fieldValue).toLowerCase()
                .includes(String(rule.value).toLowerCase());
        
        case 'not_contains':
            return !String(fieldValue).toLowerCase()
                .includes(String(rule.value).toLowerCase());
        
        case 'greater_than':
            return Number(fieldValue) > Number(rule.value);
        
        case 'less_than':
            return Number(fieldValue) < Number(rule.value);
        
        case 'gte':
            return Number(fieldValue) >= Number(rule.value);
        
        case 'lte':
            return Number(fieldValue) <= Number(rule.value);
        
        case 'matches':
            if (!rule.pattern) {
                throw new Error('matches operator requires pattern');
            }
            const regex = new RegExp(rule.pattern);
            return regex.test(String(fieldValue));
        
        default:
            throw new Error(`Unknown operator: ${rule.operator}`);
    }
}

/**
 * Get nested value from object using dot notation (e.g., "user.role")
 */
function getNestedValue(item: any, path: string): any {
    return path.split('.').reduce((obj, key) => obj?.[key], item);
}

/**
 * Evaluate an item using AI
 * Returns true if item should be included
 */
async function evaluateAIRule(
    item: PromptItem,
    config: AIFilterConfig,
    aiInvoker: AIInvoker,
    timeoutMs: number
): Promise<boolean> {
    try {
        // Render prompt with item data
        const prompt = substituteTemplate(config.prompt, item);
        
        // Call AI
        const result = await aiInvoker(prompt, {
            model: config.model,
            timeoutMs
        });

        if (!result.success) {
            // On error, default to excluding the item
            getLogger().error(LogCategory.PIPELINE, `AI filter error for item: ${result.error}`);
            return false;
        }

        // Parse response
        let response: any;
        if (config.output && config.output.length > 0) {
            // Structured output expected
            try {
                response = JSON.parse(result.response || '');
            } catch {
                // Failed to parse JSON, default to exclude
                getLogger().error(LogCategory.PIPELINE, `Failed to parse AI filter response as JSON: ${result.response}`);
                return false;
            }
        } else {
            // Text mode - check for affirmative response
            response = { include: /\b(yes|true|include|pass)\b/i.test(result.response || '') };
        }

        // Check for 'include' field
        if (typeof response.include === 'boolean') {
            return response.include;
        }

        // Fallback: if no clear include field, default to false
        getLogger().error(LogCategory.PIPELINE, `AI filter response missing 'include' field: ${JSON.stringify(response)}`);
        return false;

    } catch (error) {
        getLogger().error(LogCategory.PIPELINE, `AI filter exception: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}
