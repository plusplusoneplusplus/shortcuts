/**
 * Tests for filter-executor.ts
 *
 * Covers rule-based, AI-based, and hybrid filtering with all operators,
 * combine modes, cancellation, parallel batching, and fail-safe behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    executeFilter,
    executeRuleFilter,
    executeAIFilter,
    executeHybridFilter,
    type FilterExecuteOptions,
} from '../../src/utils/filter-executor';
import type { PromptItem } from '../../src/ai/types';
import type {
    FilterConfig,
    RuleFilterConfig,
    AIFilterConfig,
    FilterRule,
} from '../../src/workflow/pipeline-compat';

// Suppress logger output during tests
vi.mock('../../src/logger', () => ({
    getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
    LogCategory: { PIPELINE: 'pipeline' },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItems(...texts: string[]): PromptItem[] {
    return texts.map(text => ({ text }));
}

function mockAIInvoker(responseFn: (prompt: string) => string | null) {
    return vi.fn(async (prompt: string) => {
        const resp = responseFn(prompt);
        if (resp === null) {
            return { success: false, error: 'AI call failed' };
        }
        return { success: true, response: resp };
    });
}

const defaultOpts: FilterExecuteOptions = {};

// ---------------------------------------------------------------------------
// executeRuleFilter — operators
// ---------------------------------------------------------------------------

describe('executeRuleFilter', () => {
    describe('equals / not_equals', () => {
        it('includes item when field equals value', async () => {
            const items = makeItems('hello');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'equals', value: 'hello' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
            expect(result.excluded).toHaveLength(0);
        });

        it('excludes item when field does not equal value', async () => {
            const items = makeItems('hello');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'equals', value: 'world' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
            expect(result.excluded).toHaveLength(1);
        });

        it('not_equals includes when field differs', async () => {
            const items = makeItems('hello');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'not_equals', value: 'world' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });

        it('not_equals excludes when field matches', async () => {
            const items = makeItems('hello');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'not_equals', value: 'hello' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });
    });

    describe('contains / not_contains', () => {
        it('contains matches case-insensitively', async () => {
            const items = makeItems('Hello World');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'contains', value: 'hello' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });

        it('contains excludes when substring absent', async () => {
            const items = makeItems('Hello World');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'contains', value: 'foo' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });

        it('not_contains includes when substring absent', async () => {
            const items = makeItems('Hello World');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'not_contains', value: 'foo' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });

        it('not_contains excludes when substring present', async () => {
            const items = makeItems('Hello World');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'not_contains', value: 'world' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });
    });

    describe('greater_than / less_than / gte / lte', () => {
        it('greater_than includes when numeric value exceeds threshold', async () => {
            const items = [{ text: 'a', score: '10' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'score', operator: 'greater_than', value: '5' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });

        it('greater_than excludes when equal', async () => {
            const items = [{ text: 'a', score: '5' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'score', operator: 'greater_than', value: '5' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });

        it('less_than includes when below threshold', async () => {
            const items = [{ text: 'a', score: '3' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'score', operator: 'less_than', value: '5' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });

        it('less_than excludes when equal', async () => {
            const items = [{ text: 'a', score: '5' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'score', operator: 'less_than', value: '5' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });

        it('gte includes when equal', async () => {
            const items = [{ text: 'a', score: '5' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'score', operator: 'gte', value: '5' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });

        it('lte includes when equal', async () => {
            const items = [{ text: 'a', score: '5' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'score', operator: 'lte', value: '5' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });
    });

    describe('in / not_in', () => {
        it('in includes when value is in set', async () => {
            const items = [{ text: 'alpha' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'in', values: ['alpha', 'beta'] }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });

        it('in excludes when value is not in set', async () => {
            const items = [{ text: 'gamma' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'in', values: ['alpha', 'beta'] }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });

        it('in excludes when values array is missing', async () => {
            const items = [{ text: 'alpha' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'in' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });

        it('not_in includes when value is absent from set', async () => {
            const items = [{ text: 'gamma' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'not_in', values: ['alpha', 'beta'] }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });

        it('not_in excludes when value is in set', async () => {
            const items = [{ text: 'alpha' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'not_in', values: ['alpha', 'beta'] }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });
    });

    describe('matches (regex)', () => {
        it('matches includes when regex matches', async () => {
            const items = makeItems('abc123');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'matches', pattern: '^abc\\d+$' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });

        it('matches excludes when regex does not match', async () => {
            const items = makeItems('xyz');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'matches', pattern: '^abc\\d+$' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });

        it('matches throws when pattern is missing', async () => {
            const items = makeItems('abc');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'matches' }],
            };
            await expect(executeRuleFilter(items, config, defaultOpts)).rejects.toThrow(
                'matches operator requires pattern'
            );
        });
    });

    describe('missing / null fields', () => {
        it('excludes item when field is undefined', async () => {
            const items = [{ text: 'hello' }];
            const config: RuleFilterConfig = {
                rules: [{ field: 'missing', operator: 'equals', value: 'hello' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });

        it('handles nested field access via dot notation', async () => {
            const items = [{ text: 'hello', meta: JSON.stringify({ role: 'admin' }) } as any];
            // Note: getNestedValue splits on '.', so item.meta.role traverses object keys
            const nestedItems = [{ user: { role: 'admin' } }] as any[];
            const config: RuleFilterConfig = {
                rules: [{ field: 'user.role', operator: 'equals', value: 'admin' }],
            };
            const result = await executeRuleFilter(nestedItems, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });
    });

    describe('mode: all vs any (multiple rules)', () => {
        const items = [{ text: 'hello world', score: '10' }];

        it('mode:all (default) requires all rules to pass', async () => {
            const config: RuleFilterConfig = {
                rules: [
                    { field: 'text', operator: 'contains', value: 'hello' },
                    { field: 'score', operator: 'greater_than', value: '20' },
                ],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });

        it('mode:all passes when all rules match', async () => {
            const config: RuleFilterConfig = {
                rules: [
                    { field: 'text', operator: 'contains', value: 'hello' },
                    { field: 'score', operator: 'greater_than', value: '5' },
                ],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });

        it('mode:any passes when at least one rule matches', async () => {
            const config: RuleFilterConfig = {
                mode: 'any',
                rules: [
                    { field: 'text', operator: 'contains', value: 'hello' },
                    { field: 'score', operator: 'greater_than', value: '20' },
                ],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(1);
        });

        it('mode:any excludes when no rules match', async () => {
            const config: RuleFilterConfig = {
                mode: 'any',
                rules: [
                    { field: 'text', operator: 'contains', value: 'foo' },
                    { field: 'score', operator: 'greater_than', value: '20' },
                ],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.included).toHaveLength(0);
        });
    });

    describe('stats', () => {
        it('returns correct filter stats', async () => {
            const items = makeItems('aaa', 'bbb', 'ccc');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'contains', value: 'a' }],
            };
            const result = await executeRuleFilter(items, config, defaultOpts);
            expect(result.stats).toMatchObject({
                totalItems: 3,
                includedCount: 1,
                excludedCount: 2,
                filterType: 'rule',
            });
            expect(result.stats.executionTimeMs).toBeGreaterThanOrEqual(0);
        });
    });

    describe('cancellation', () => {
        it('throws when cancelled mid-loop', async () => {
            const items = makeItems('a', 'b', 'c', 'd', 'e');
            let callCount = 0;
            const opts: FilterExecuteOptions = {
                isCancelled: () => {
                    callCount++;
                    return callCount > 2;
                },
            };
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'contains', value: 'a' }],
            };
            await expect(executeRuleFilter(items, config, opts)).rejects.toThrow(
                'Filter execution cancelled'
            );
        });
    });

    describe('progress reporting', () => {
        it('calls onProgress callback', async () => {
            const items = makeItems('a', 'b');
            const progressCalls: any[] = [];
            const opts: FilterExecuteOptions = {
                onProgress: (p) => progressCalls.push({ ...p }),
            };
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'equals', value: 'a' }],
            };
            await executeRuleFilter(items, config, opts);
            expect(progressCalls.length).toBeGreaterThan(0);
            expect(progressCalls[0].phase).toBe('rule');
        });
    });

    describe('unknown operator', () => {
        it('throws for unknown operator', async () => {
            const items = makeItems('hello');
            const config: RuleFilterConfig = {
                rules: [{ field: 'text', operator: 'invalid_op' as any, value: 'hello' }],
            };
            await expect(executeRuleFilter(items, config, defaultOpts)).rejects.toThrow(
                'Unknown operator'
            );
        });
    });
});

// ---------------------------------------------------------------------------
// executeAIFilter
// ---------------------------------------------------------------------------

describe('executeAIFilter', () => {
    const aiConfig: AIFilterConfig = {
        prompt: 'Should we include "{{text}}"?',
        parallel: 2,
    };

    it('includes item when AI responds with "yes" (text mode)', async () => {
        const invoker = mockAIInvoker(() => 'yes');
        const items = makeItems('good item');
        const result = await executeAIFilter(items, aiConfig, { aiInvoker: invoker });
        expect(result.included).toHaveLength(1);
        expect(result.excluded).toHaveLength(0);
    });

    it('includes item when AI responds with "true" (text mode)', async () => {
        const invoker = mockAIInvoker(() => 'true, this looks fine');
        const items = makeItems('good item');
        const result = await executeAIFilter(items, aiConfig, { aiInvoker: invoker });
        expect(result.included).toHaveLength(1);
    });

    it('includes item when AI responds with "include" (text mode)', async () => {
        const invoker = mockAIInvoker(() => 'I would include this item');
        const items = makeItems('good item');
        const result = await executeAIFilter(items, aiConfig, { aiInvoker: invoker });
        expect(result.included).toHaveLength(1);
    });

    it('includes item when AI responds with "pass" (text mode)', async () => {
        const invoker = mockAIInvoker(() => 'pass');
        const items = makeItems('good item');
        const result = await executeAIFilter(items, aiConfig, { aiInvoker: invoker });
        expect(result.included).toHaveLength(1);
    });

    it('excludes item when AI responds with "no" (text mode)', async () => {
        const invoker = mockAIInvoker(() => 'no, skip this');
        const items = makeItems('bad item');
        const result = await executeAIFilter(items, aiConfig, { aiInvoker: invoker });
        expect(result.included).toHaveLength(0);
        expect(result.excluded).toHaveLength(1);
    });

    it('includes item when AI returns JSON {"include": true}', async () => {
        const configWithOutput: AIFilterConfig = {
            ...aiConfig,
            output: ['include'],
        };
        const invoker = mockAIInvoker(() => '{"include": true}');
        const items = makeItems('good item');
        const result = await executeAIFilter(items, configWithOutput, { aiInvoker: invoker });
        expect(result.included).toHaveLength(1);
    });

    it('excludes item when AI returns JSON {"include": false}', async () => {
        const configWithOutput: AIFilterConfig = {
            ...aiConfig,
            output: ['include'],
        };
        const invoker = mockAIInvoker(() => '{"include": false}');
        const items = makeItems('bad item');
        const result = await executeAIFilter(items, configWithOutput, { aiInvoker: invoker });
        expect(result.included).toHaveLength(0);
        expect(result.excluded).toHaveLength(1);
    });

    it('excludes item when AI response is not parseable JSON (fail-safe)', async () => {
        const configWithOutput: AIFilterConfig = {
            ...aiConfig,
            output: ['include'],
        };
        const invoker = mockAIInvoker(() => 'not valid json {{{');
        const items = makeItems('item');
        const result = await executeAIFilter(items, configWithOutput, { aiInvoker: invoker });
        expect(result.included).toHaveLength(0);
        expect(result.excluded).toHaveLength(1);
    });

    it('excludes item when AI JSON is missing "include" field (fail-safe)', async () => {
        const configWithOutput: AIFilterConfig = {
            ...aiConfig,
            output: ['include'],
        };
        const invoker = mockAIInvoker(() => '{"relevant": true}');
        const items = makeItems('item');
        const result = await executeAIFilter(items, configWithOutput, { aiInvoker: invoker });
        expect(result.included).toHaveLength(0);
    });

    it('excludes item when AI call fails (fail-safe)', async () => {
        const invoker = mockAIInvoker(() => null);
        const items = makeItems('item');
        const result = await executeAIFilter(items, aiConfig, { aiInvoker: invoker });
        expect(result.included).toHaveLength(0);
        expect(result.excluded).toHaveLength(1);
    });

    it('excludes item when AI throws an exception (fail-safe)', async () => {
        const invoker = vi.fn(async () => {
            throw new Error('network timeout');
        });
        const items = makeItems('item');
        const result = await executeAIFilter(items, aiConfig, { aiInvoker: invoker });
        expect(result.included).toHaveLength(0);
        expect(result.excluded).toHaveLength(1);
    });

    describe('cancellation', () => {
        it('throws when cancelled between batches', async () => {
            let batchIndex = 0;
            const invoker = mockAIInvoker(() => 'yes');
            const items = makeItems('a', 'b', 'c', 'd', 'e', 'f');
            const config: AIFilterConfig = { ...aiConfig, parallel: 2 };
            const opts: FilterExecuteOptions = {
                aiInvoker: invoker,
                isCancelled: () => {
                    batchIndex++;
                    return batchIndex > 1; // cancel after first batch
                },
            };
            await expect(executeAIFilter(items, config, opts)).rejects.toThrow(
                'Filter execution cancelled'
            );
            // Only the first batch should have been processed
            expect(invoker).toHaveBeenCalledTimes(2);
        });
    });

    describe('parallel batching', () => {
        it('processes items in batches of parallel limit', async () => {
            const callOrder: number[] = [];
            let callIdx = 0;
            const invoker = vi.fn(async () => {
                callOrder.push(callIdx++);
                return { success: true, response: 'yes' };
            });
            const items = makeItems('a', 'b', 'c', 'd', 'e');
            const config: AIFilterConfig = { ...aiConfig, parallel: 2 };
            const result = await executeAIFilter(items, config, { aiInvoker: invoker });

            // All 5 items should be processed
            expect(invoker).toHaveBeenCalledTimes(5);
            expect(result.included).toHaveLength(5);
        });

        it('defaults parallel to 5 when not set', async () => {
            const invoker = mockAIInvoker(() => 'yes');
            const items = makeItems('1', '2', '3', '4', '5', '6', '7');
            const config: AIFilterConfig = { prompt: '{{text}}' };
            await executeAIFilter(items, config, { aiInvoker: invoker });
            // Should process all 7 items across 2 batches (5 + 2)
            expect(invoker).toHaveBeenCalledTimes(7);
        });
    });

    describe('progress reporting', () => {
        it('reports progress after each batch', async () => {
            const invoker = mockAIInvoker(() => 'yes');
            const items = makeItems('a', 'b', 'c');
            const config: AIFilterConfig = { ...aiConfig, parallel: 2 };
            const progressCalls: any[] = [];
            const opts: FilterExecuteOptions = {
                aiInvoker: invoker,
                onProgress: (p) => progressCalls.push({ ...p }),
            };
            await executeAIFilter(items, config, opts);
            expect(progressCalls.length).toBe(2); // 2 batches
            expect(progressCalls[0].phase).toBe('ai');
            expect(progressCalls[0].processed).toBe(2);
            expect(progressCalls[1].processed).toBe(3);
        });
    });

    describe('template substitution', () => {
        it('substitutes item fields into the prompt', async () => {
            const invoker = mockAIInvoker(() => 'yes');
            const items = [{ text: 'hello', category: 'greeting' }];
            const config: AIFilterConfig = {
                prompt: 'Is {{text}} a {{category}}?',
            };
            await executeAIFilter(items, config, { aiInvoker: invoker });
            expect(invoker).toHaveBeenCalledWith(
                'Is hello a greeting?',
                expect.objectContaining({ timeoutMs: 30000 })
            );
        });
    });

    describe('stats', () => {
        it('returns correct filter stats', async () => {
            const invoker = mockAIInvoker((prompt) =>
                prompt.includes('good') ? 'yes' : 'no'
            );
            const items = makeItems('good', 'bad', 'good');
            const result = await executeAIFilter(items, aiConfig, { aiInvoker: invoker });
            expect(result.stats).toMatchObject({
                totalItems: 3,
                includedCount: 2,
                excludedCount: 1,
                filterType: 'ai',
            });
        });
    });
});

// ---------------------------------------------------------------------------
// executeHybridFilter
// ---------------------------------------------------------------------------

describe('executeHybridFilter', () => {
    const ruleConfig: RuleFilterConfig = {
        rules: [{ field: 'text', operator: 'contains', value: 'keep' }],
    };
    const aiConfig: AIFilterConfig = {
        prompt: 'Include {{text}}?',
        parallel: 5,
    };

    describe('combine: and (default)', () => {
        it('includes item only when both rule and AI include', async () => {
            const invoker = mockAIInvoker(() => 'yes');
            const items = makeItems('keep-this', 'drop-this');
            const config: FilterConfig = {
                type: 'hybrid',
                rule: ruleConfig,
                ai: aiConfig,
            };
            const result = await executeHybridFilter(items, config, { aiInvoker: invoker });
            expect(result.included).toHaveLength(1);
            expect(result.included[0].text).toBe('keep-this');
        });

        it('excludes item when rule passes but AI rejects', async () => {
            const invoker = mockAIInvoker(() => 'no');
            const items = makeItems('keep-this');
            const config: FilterConfig = {
                type: 'hybrid',
                rule: ruleConfig,
                ai: aiConfig,
            };
            const result = await executeHybridFilter(items, config, { aiInvoker: invoker });
            expect(result.included).toHaveLength(0);
            expect(result.excluded).toHaveLength(1);
        });

        it('excludes item when rule rejects (AI not called for it)', async () => {
            const invoker = mockAIInvoker(() => 'yes');
            const items = makeItems('drop-this');
            const config: FilterConfig = {
                type: 'hybrid',
                rule: ruleConfig,
                ai: aiConfig,
            };
            const result = await executeHybridFilter(items, config, { aiInvoker: invoker });
            expect(result.included).toHaveLength(0);
            // AI should not be called for rule-excluded items in AND mode
            expect(invoker).not.toHaveBeenCalled();
        });
    });

    describe('combine: or', () => {
        it('includes item when rule passes even if AI not called', async () => {
            const invoker = mockAIInvoker(() => 'no');
            const items = makeItems('keep-this');
            const config: FilterConfig = {
                type: 'hybrid',
                rule: ruleConfig,
                ai: aiConfig,
                combineMode: 'or',
            };
            const result = await executeHybridFilter(items, config, { aiInvoker: invoker });
            expect(result.included).toHaveLength(1);
            expect(result.included[0].text).toBe('keep-this');
            // AI should not be called for rule-included items in OR mode
            expect(invoker).not.toHaveBeenCalled();
        });

        it('includes item when rule fails but AI includes', async () => {
            const invoker = mockAIInvoker(() => 'yes');
            const items = makeItems('no-rule-match');
            const config: FilterConfig = {
                type: 'hybrid',
                rule: ruleConfig,
                ai: aiConfig,
                combineMode: 'or',
            };
            const result = await executeHybridFilter(items, config, { aiInvoker: invoker });
            expect(result.included).toHaveLength(1);
        });

        it('excludes item when both rule and AI reject', async () => {
            const invoker = mockAIInvoker(() => 'no');
            const items = makeItems('no-rule-match');
            const config: FilterConfig = {
                type: 'hybrid',
                rule: ruleConfig,
                ai: aiConfig,
                combineMode: 'or',
            };
            const result = await executeHybridFilter(items, config, { aiInvoker: invoker });
            expect(result.included).toHaveLength(0);
        });
    });

    describe('stats', () => {
        it('returns hybrid filter type in stats', async () => {
            const invoker = mockAIInvoker(() => 'yes');
            const items = makeItems('keep-a', 'drop-b');
            const config: FilterConfig = {
                type: 'hybrid',
                rule: ruleConfig,
                ai: aiConfig,
            };
            const result = await executeHybridFilter(items, config, { aiInvoker: invoker });
            expect(result.stats.filterType).toBe('hybrid');
            expect(result.stats.totalItems).toBe(2);
        });
    });
});

// ---------------------------------------------------------------------------
// executeFilter — routing
// ---------------------------------------------------------------------------

describe('executeFilter', () => {
    it('routes type:rule to executeRuleFilter', async () => {
        const items = makeItems('hello');
        const config: FilterConfig = {
            type: 'rule',
            rule: {
                rules: [{ field: 'text', operator: 'equals', value: 'hello' }],
            },
        };
        const result = await executeFilter(items, config, defaultOpts);
        expect(result.included).toHaveLength(1);
        expect(result.stats.filterType).toBe('rule');
    });

    it('routes type:ai to executeAIFilter', async () => {
        const invoker = mockAIInvoker(() => 'yes');
        const items = makeItems('item');
        const config: FilterConfig = {
            type: 'ai',
            ai: { prompt: '{{text}}' },
        };
        const result = await executeFilter(items, config, { aiInvoker: invoker });
        expect(result.included).toHaveLength(1);
        expect(result.stats.filterType).toBe('ai');
    });

    it('routes type:hybrid to executeHybridFilter', async () => {
        const invoker = mockAIInvoker(() => 'yes');
        const items = makeItems('keep-this');
        const config: FilterConfig = {
            type: 'hybrid',
            rule: {
                rules: [{ field: 'text', operator: 'contains', value: 'keep' }],
            },
            ai: { prompt: '{{text}}' },
        };
        const result = await executeFilter(items, config, { aiInvoker: invoker });
        expect(result.included).toHaveLength(1);
        expect(result.stats.filterType).toBe('hybrid');
    });

    describe('validation errors', () => {
        it('throws when rule filter missing rule config', async () => {
            const config: FilterConfig = { type: 'rule' };
            await expect(executeFilter([], config, defaultOpts)).rejects.toThrow(
                'Rule filter requires "rule" configuration'
            );
        });

        it('throws when AI filter missing ai config', async () => {
            const config: FilterConfig = { type: 'ai' };
            await expect(
                executeFilter([], config, { aiInvoker: mockAIInvoker(() => 'yes') })
            ).rejects.toThrow('AI filter requires "ai" configuration');
        });

        it('throws when AI filter missing aiInvoker', async () => {
            const config: FilterConfig = { type: 'ai', ai: { prompt: 'test' } };
            await expect(executeFilter([], config, defaultOpts)).rejects.toThrow(
                'AI filter requires aiInvoker in options'
            );
        });

        it('throws when hybrid filter missing rule config', async () => {
            const config: FilterConfig = { type: 'hybrid', ai: { prompt: 'test' } };
            await expect(
                executeFilter([], config, { aiInvoker: mockAIInvoker(() => 'yes') })
            ).rejects.toThrow('Hybrid filter requires both "rule" and "ai" configuration');
        });

        it('throws when hybrid filter missing ai config', async () => {
            const config: FilterConfig = {
                type: 'hybrid',
                rule: { rules: [] },
            };
            await expect(
                executeFilter([], config, { aiInvoker: mockAIInvoker(() => 'yes') })
            ).rejects.toThrow('Hybrid filter requires both "rule" and "ai" configuration');
        });

        it('throws when hybrid filter missing aiInvoker', async () => {
            const config: FilterConfig = {
                type: 'hybrid',
                rule: { rules: [] },
                ai: { prompt: 'test' },
            };
            await expect(executeFilter([], config, defaultOpts)).rejects.toThrow(
                'Hybrid filter requires aiInvoker in options'
            );
        });

        it('throws for unknown filter type', async () => {
            const config = { type: 'unknown' } as any;
            await expect(executeFilter([], config, defaultOpts)).rejects.toThrow(
                'Unknown filter type'
            );
        });
    });
});
