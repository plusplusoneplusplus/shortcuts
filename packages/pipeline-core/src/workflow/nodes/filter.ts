/**
 * Filter node executor — filters items using composable boolean rules.
 *
 * Evaluates a recursive `WorkflowFilterRule` tree against each item and
 * returns only items for which the rule evaluates to `true`.
 */

import type {
    FilterNodeConfig,
    WorkflowFilterRule,
    Item,
    Items,
    WorkflowExecutionOptions
} from '../types';
import { ConcurrencyLimiter } from '../../map-reduce';

// ---------------------------------------------------------------------------
// Module-level concurrency limiter cache
// ---------------------------------------------------------------------------

const limiters = new Map<number, ConcurrencyLimiter>();

function getLimiter(concurrency: number): ConcurrencyLimiter {
    if (!limiters.has(concurrency)) {
        limiters.set(concurrency, new ConcurrencyLimiter(concurrency));
    }
    return limiters.get(concurrency)!;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a filter node: evaluate `config.rule` against every item and
 * return only items that pass.
 */
export async function executeFilter(
    config: FilterNodeConfig,
    inputs: Items,
    options: WorkflowExecutionOptions
): Promise<Items> {
    const results = await Promise.all(
        inputs.map(item => evaluateRule(config.rule, item, options))
    );
    return inputs.filter((_, i) => results[i]);
}

/**
 * Recursively evaluate a composable filter rule against a single item.
 */
export async function evaluateRule(
    rule: WorkflowFilterRule,
    item: Item,
    options: WorkflowExecutionOptions
): Promise<boolean> {
    switch (rule.type) {
        case 'field':
            return evaluateFieldRule(rule, item);
        case 'ai':
            return evaluateAIRule(rule, item, options);
        case 'and':
            return (await Promise.all(
                rule.rules.map(r => evaluateRule(r, item, options))
            )).every(Boolean);
        case 'or':
            return (await Promise.all(
                rule.rules.map(r => evaluateRule(r, item, options))
            )).some(Boolean);
        case 'not':
            return !(await evaluateRule(rule.rule, item, options));
        default: {
            const _exhaustive: never = rule;
            throw new Error(`Unknown rule type: ${(_exhaustive as WorkflowFilterRule).type}`);
        }
    }
}

/**
 * Synchronously evaluate a field-based filter rule.
 */
export function evaluateFieldRule(
    rule: Extract<WorkflowFilterRule, { type: 'field' }>,
    item: Item
): boolean {
    const raw = item[rule.field];

    // Missing field: conservatively return false
    if (raw === undefined || raw === null) {
        return false;
    }

    const fieldStr = String(raw);
    const valueStr = String(rule.value ?? '');

    switch (rule.op) {
        case 'eq':
            return fieldStr === valueStr;
        case 'neq':
            return fieldStr !== valueStr;
        case 'in': {
            const vals = (rule.values ?? []).map(String);
            return vals.includes(fieldStr);
        }
        case 'nin': {
            const vals = (rule.values ?? []).map(String);
            return !vals.includes(fieldStr);
        }
        case 'contains':
            return fieldStr.toLowerCase().includes(valueStr.toLowerCase());
        case 'not_contains':
            return !fieldStr.toLowerCase().includes(valueStr.toLowerCase());
        case 'gt': {
            const a = parseFloat(fieldStr), b = parseFloat(valueStr);
            return !isNaN(a) && !isNaN(b) && a > b;
        }
        case 'lt': {
            const a = parseFloat(fieldStr), b = parseFloat(valueStr);
            return !isNaN(a) && !isNaN(b) && a < b;
        }
        case 'gte': {
            const a = parseFloat(fieldStr), b = parseFloat(valueStr);
            return !isNaN(a) && !isNaN(b) && a >= b;
        }
        case 'lte': {
            const a = parseFloat(fieldStr), b = parseFloat(valueStr);
            return !isNaN(a) && !isNaN(b) && a <= b;
        }
        case 'matches': {
            const pattern = rule.value !== undefined ? String(rule.value) : '';
            return new RegExp(pattern).test(fieldStr);
        }
        default: {
            const _exhaustive: never = rule.op;
            throw new Error(`Unknown filter operator: ${_exhaustive}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Private: AI rule evaluation
// ---------------------------------------------------------------------------

async function evaluateAIRule(
    rule: Extract<WorkflowFilterRule, { type: 'ai' }>,
    item: Item,
    options: WorkflowExecutionOptions
): Promise<boolean> {
    if (!options.aiInvoker) {
        throw new Error('WorkflowExecutionOptions.aiInvoker is required for ai filter rules');
    }

    const invoke = async (): Promise<boolean> => {
        const prompt = rule.prompt.replace(
            /\{\{(\w+)\}\}/g,
            (_, key) => String(item[key] ?? '')
        );

        let response: string;
        try {
            const result = await options.aiInvoker!(prompt, {
                model: rule.model,
                timeoutMs: rule.timeoutMs
            });
            if (!result.success) {
                return false;
            }
            response = result.response ?? '';
        } catch {
            return false;
        }

        return parseAIIncludeResponse(response);
    };

    if (rule.concurrency !== undefined && rule.concurrency > 0) {
        return getLimiter(rule.concurrency).run(invoke);
    }
    return invoke();
}

// ---------------------------------------------------------------------------
// Private: AI response parsing
// ---------------------------------------------------------------------------

function parseAIIncludeResponse(response: string): boolean {
    // Attempt 1: extract first JSON object
    const jsonMatch = response.match(/\{[^}]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);

            if (typeof parsed.include === 'boolean') {
                return parsed.include;
            }
            if (typeof parsed.include === 'string') {
                const lower = parsed.include.toLowerCase().trim();
                if (lower === 'true') return true;
                if (lower === 'false') return false;
            }
            if (typeof parsed.include === 'number') {
                return parsed.include !== 0;
            }
        } catch {
            // JSON.parse failed — fall through to text heuristic
        }
    }

    // Attempt 2: text heuristic
    const affirmative = /\b(yes|true|include|pass)\b/i.test(response);
    const negative = /\b(no|false|exclude|fail)\b/i.test(response);

    if (affirmative && !negative) return true;
    if (negative && !affirmative) return false;

    // Attempt 3: ambiguous or empty — conservative exclude
    return false;
}
