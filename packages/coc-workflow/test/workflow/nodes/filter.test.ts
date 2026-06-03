import { describe, it, expect, vi } from 'vitest';
import { executeFilter, evaluateRule, evaluateFieldRule } from '../../../src/workflow/nodes/filter';
import type { FilterNodeConfig, WorkflowFilterRule, WorkflowExecutionOptions, Item } from '../../../src/workflow/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOptions(mockResponse: string, success = true): WorkflowExecutionOptions {
    return {
        aiInvoker: vi.fn().mockResolvedValue({ success, response: mockResponse }),
        workflowDirectory: '/tmp'
    } as unknown as WorkflowExecutionOptions;
}

function fieldRule(field: string, op: string, value?: unknown, values?: unknown[]): WorkflowFilterRule {
    return { type: 'field', field, op, value, values } as WorkflowFilterRule;
}

// ---------------------------------------------------------------------------
// evaluateFieldRule — synchronous field rules
// ---------------------------------------------------------------------------

describe('evaluateFieldRule', () => {
    it('eq matches', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'status', op: 'eq', value: 'open' },
            { status: 'open' }
        )).toBe(true);
    });

    it('eq does not match', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'status', op: 'eq', value: 'open' },
            { status: 'closed' }
        )).toBe(false);
    });

    it('eq with numeric field coerced to string', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'priority', op: 'eq', value: '3' },
            { priority: 3 }
        )).toBe(true);
    });

    it('neq matches', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'status', op: 'neq', value: 'closed' },
            { status: 'open' }
        )).toBe(true);
    });

    it('in value present', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'category', op: 'in', values: ['bug', 'security'] },
            { category: 'bug' }
        )).toBe(true);
    });

    it('in value absent', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'category', op: 'in', values: ['bug', 'security'] },
            { category: 'docs' }
        )).toBe(false);
    });

    it('nin value absent', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'category', op: 'nin', values: ['bug', 'security'] },
            { category: 'docs' }
        )).toBe(true);
    });

    it('nin value present', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'category', op: 'nin', values: ['bug', 'security'] },
            { category: 'bug' }
        )).toBe(false);
    });

    it('contains case-insensitive', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'title', op: 'contains', value: 'null' },
            { title: 'NullPointerException' }
        )).toBe(true);
    });

    it('not_contains', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'title', op: 'not_contains', value: 'memory' },
            { title: 'NullPointerException' }
        )).toBe(true);
    });

    it('gt numeric', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'score', op: 'gt', value: '5' },
            { score: 10 }
        )).toBe(true);
    });

    it('gt not greater', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'score', op: 'gt', value: '5' },
            { score: 3 }
        )).toBe(false);
    });

    it('lt numeric', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'score', op: 'lt', value: '5' },
            { score: 3 }
        )).toBe(true);
    });

    it('gte equal', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'score', op: 'gte', value: '5' },
            { score: 5 }
        )).toBe(true);
    });

    it('lte equal', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'score', op: 'lte', value: '5' },
            { score: 5 }
        )).toBe(true);
    });

    it('gt NaN field returns false', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'score', op: 'gt', value: '5' },
            { score: 'N/A' }
        )).toBe(false);
    });

    it('lt NaN value returns false', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'score', op: 'lt', value: 'N/A' },
            { score: 3 }
        )).toBe(false);
    });

    it('matches regex match', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'id', op: 'matches', value: '^PROJ-\\d+$' },
            { id: 'PROJ-123' }
        )).toBe(true);
    });

    it('matches regex no match', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'id', op: 'matches', value: '^PROJ-\\d+$' },
            { id: 'OTHER-123' }
        )).toBe(false);
    });

    it('unknown field returns false', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'z', op: 'eq', value: '1' },
            { a: 1 }
        )).toBe(false);
    });

    it('null field returns false', () => {
        expect(evaluateFieldRule(
            { type: 'field', field: 'a', op: 'eq', value: 'null' },
            { a: null }
        )).toBe(false);
    });

    it('unknown operator throws', () => {
        expect(() => evaluateFieldRule(
            { type: 'field', field: 'a', op: 'unknown' as any, value: 'x' },
            { a: 'x' }
        )).toThrow('Unknown filter operator');
    });
});

// ---------------------------------------------------------------------------
// Composition tests (via evaluateRule)
// ---------------------------------------------------------------------------

describe('evaluateRule — composition', () => {
    const opts = { workflowDirectory: '/tmp' } as WorkflowExecutionOptions;

    it('and both true', async () => {
        const rule: WorkflowFilterRule = {
            type: 'and',
            rules: [
                fieldRule('f1', 'eq', 'x'),
                fieldRule('f2', 'eq', 'y')
            ]
        };
        expect(await evaluateRule(rule, { f1: 'x', f2: 'y' }, opts)).toBe(true);
    });

    it('and first false', async () => {
        const rule: WorkflowFilterRule = {
            type: 'and',
            rules: [
                fieldRule('f1', 'eq', 'x'),
                fieldRule('f2', 'eq', 'y')
            ]
        };
        expect(await evaluateRule(rule, { f1: 'WRONG', f2: 'y' }, opts)).toBe(false);
    });

    it('and second false', async () => {
        const rule: WorkflowFilterRule = {
            type: 'and',
            rules: [
                fieldRule('f1', 'eq', 'x'),
                fieldRule('f2', 'eq', 'y')
            ]
        };
        expect(await evaluateRule(rule, { f1: 'x', f2: 'WRONG' }, opts)).toBe(false);
    });

    it('or first true', async () => {
        const rule: WorkflowFilterRule = {
            type: 'or',
            rules: [
                fieldRule('f1', 'eq', 'x'),
                fieldRule('f2', 'eq', 'y')
            ]
        };
        expect(await evaluateRule(rule, { f1: 'x', f2: 'z' }, opts)).toBe(true);
    });

    it('or both false', async () => {
        const rule: WorkflowFilterRule = {
            type: 'or',
            rules: [
                fieldRule('f1', 'eq', 'x'),
                fieldRule('f2', 'eq', 'y')
            ]
        };
        expect(await evaluateRule(rule, { f1: 'a', f2: 'b' }, opts)).toBe(false);
    });

    it('or both true', async () => {
        const rule: WorkflowFilterRule = {
            type: 'or',
            rules: [
                fieldRule('f1', 'eq', 'x'),
                fieldRule('f2', 'eq', 'y')
            ]
        };
        expect(await evaluateRule(rule, { f1: 'x', f2: 'y' }, opts)).toBe(true);
    });

    it('not inverts true to false', async () => {
        const rule: WorkflowFilterRule = {
            type: 'not',
            rule: fieldRule('status', 'eq', 'open')
        };
        expect(await evaluateRule(rule, { status: 'open' }, opts)).toBe(false);
    });

    it('not inverts false to true', async () => {
        const rule: WorkflowFilterRule = {
            type: 'not',
            rule: fieldRule('status', 'eq', 'open')
        };
        expect(await evaluateRule(rule, { status: 'closed' }, opts)).toBe(true);
    });

    it('nested and wrapping or and not', async () => {
        // and: [ or: [status eq open, priority eq high], not: [tag eq wontfix] ]
        const rule: WorkflowFilterRule = {
            type: 'and',
            rules: [
                {
                    type: 'or',
                    rules: [
                        fieldRule('status', 'eq', 'open'),
                        fieldRule('priority', 'eq', 'high')
                    ]
                },
                {
                    type: 'not',
                    rule: fieldRule('tag', 'eq', 'wontfix')
                }
            ]
        };
        // or-branch: status=open passes, not-branch: tag=bug != wontfix → true
        expect(await evaluateRule(rule, { status: 'open', priority: 'low', tag: 'bug' }, opts)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AI rule tests (mocked aiInvoker)
// ---------------------------------------------------------------------------

describe('evaluateRule — ai rules', () => {
    it('include true (boolean JSON)', async () => {
        const opts = makeOptions('{"include": true}');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'classify {{title}}' };
        expect(await evaluateRule(rule, { title: 'Bug' }, opts)).toBe(true);
    });

    it('include false (boolean JSON)', async () => {
        const opts = makeOptions('{"include": false}');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'classify {{title}}' };
        expect(await evaluateRule(rule, { title: 'Bug' }, opts)).toBe(false);
    });

    it('include string "true"', async () => {
        const opts = makeOptions('{"include": "true"}');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'classify {{title}}' };
        expect(await evaluateRule(rule, { title: 'Bug' }, opts)).toBe(true);
    });

    it('include string "false"', async () => {
        const opts = makeOptions('{"include": "false"}');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'classify {{title}}' };
        expect(await evaluateRule(rule, { title: 'Bug' }, opts)).toBe(false);
    });

    it('ambiguous response defaults to false', async () => {
        const opts = makeOptions('Maybe, not sure if to include or exclude.');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'classify {{title}}' };
        // Both affirmative ("include") and negative ("exclude") present → ambiguous → false
        expect(await evaluateRule(rule, { title: 'Bug' }, opts)).toBe(false);
    });

    it('clear negative text', async () => {
        const opts = makeOptions('No, exclude this item.');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'classify {{title}}' };
        expect(await evaluateRule(rule, { title: 'Bug' }, opts)).toBe(false);
    });

    it('clear affirmative text', async () => {
        const opts = makeOptions('Yes, include.');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'classify {{title}}' };
        expect(await evaluateRule(rule, { title: 'Bug' }, opts)).toBe(true);
    });

    it('AI failure (success: false) returns false', async () => {
        const opts = makeOptions('', false);
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'classify {{title}}' };
        expect(await evaluateRule(rule, { title: 'Bug' }, opts)).toBe(false);
    });

    it('prompt has {{field}} substituted', async () => {
        const opts = makeOptions('{"include": true}');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'Review {{id}}: {{title}}' };
        await evaluateRule(rule, { id: 'X-1', title: 'Bug' }, opts);
        expect(opts.aiInvoker).toHaveBeenCalledWith('Review X-1: Bug', expect.any(Object));
    });

    it('missing aiInvoker throws', async () => {
        const opts = { workflowDirectory: '/tmp' } as WorkflowExecutionOptions;
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'classify {{title}}' };
        await expect(evaluateRule(rule, { title: 'Bug' }, opts)).rejects.toThrow('aiInvoker');
    });

    it('include numeric 1 returns true', async () => {
        const opts = makeOptions('{"include": 1}');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'test' };
        expect(await evaluateRule(rule, {}, opts)).toBe(true);
    });

    it('include numeric 0 returns false', async () => {
        const opts = makeOptions('{"include": 0}');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'test' };
        expect(await evaluateRule(rule, {}, opts)).toBe(false);
    });

    it('malformed JSON falls through to heuristic', async () => {
        const opts = makeOptions('{malformed json');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'test' };
        // No clear affirmative/negative keywords → false
        expect(await evaluateRule(rule, {}, opts)).toBe(false);
    });

    it('empty response returns false', async () => {
        const opts = makeOptions('');
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'test' };
        expect(await evaluateRule(rule, {}, opts)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Concurrency limiter test
// ---------------------------------------------------------------------------

describe('evaluateRule — ai concurrency', () => {
    it('respects rule.concurrency', async () => {
        let maxConcurrent = 0;
        let current = 0;

        const aiInvoker = vi.fn().mockImplementation(async () => {
            current++;
            if (current > maxConcurrent) maxConcurrent = current;
            await new Promise(r => setTimeout(r, 50));
            current--;
            return { success: true, response: '{"include": true}' };
        });

        const opts = { aiInvoker, workflowDirectory: '/tmp' } as unknown as WorkflowExecutionOptions;
        const rule: WorkflowFilterRule = { type: 'ai', prompt: 'test', concurrency: 2 };

        const config: FilterNodeConfig = {
            id: 'f1', type: 'filter', rule,
            inputs: []
        };

        const items: Item[] = Array.from({ length: 10 }, (_, i) => ({ idx: i }));
        await executeFilter(config, items, opts);

        expect(maxConcurrent).toBeLessThanOrEqual(2);
        expect(aiInvoker).toHaveBeenCalledTimes(10);
    });
});

// ---------------------------------------------------------------------------
// Integration tests (executeFilter)
// ---------------------------------------------------------------------------

describe('executeFilter', () => {
    const opts = { workflowDirectory: '/tmp' } as WorkflowExecutionOptions;

    it('field rule filters correct subset', async () => {
        const items = [
            { status: 'open', id: 1 },
            { status: 'closed', id: 2 },
            { status: 'open', id: 3 },
            { status: 'closed', id: 4 },
            { status: 'open', id: 5 }
        ];
        const config: FilterNodeConfig = {
            id: 'f1', type: 'filter',
            rule: { type: 'field', field: 'status', op: 'eq', value: 'open' },
            inputs: []
        };
        const result = await executeFilter(config, items, opts);
        expect(result).toHaveLength(3);
        expect(result.map(r => r.id)).toEqual([1, 3, 5]);
    });

    it('ai rule filters correct subset', async () => {
        let callIndex = 0;
        const aiInvoker = vi.fn().mockImplementation(async () => {
            const idx = callIndex++;
            // include even-index items (0, 2, 4)
            return { success: true, response: idx % 2 === 0 ? '{"include": true}' : '{"include": false}' };
        });
        const aiOpts = { aiInvoker, workflowDirectory: '/tmp' } as unknown as WorkflowExecutionOptions;

        const items = [
            { val: 'a' }, { val: 'b' }, { val: 'c' }, { val: 'd' }, { val: 'e' }
        ];
        const config: FilterNodeConfig = {
            id: 'f1', type: 'filter',
            rule: { type: 'ai', prompt: 'test {{val}}' },
            inputs: []
        };
        const result = await executeFilter(config, items, aiOpts);
        expect(result).toHaveLength(3);
        expect(result.map(r => r.val)).toEqual(['a', 'c', 'e']);
    });

    it('empty input returns empty array', async () => {
        const config: FilterNodeConfig = {
            id: 'f1', type: 'filter',
            rule: { type: 'field', field: 'x', op: 'eq', value: 'y' },
            inputs: []
        };
        const result = await executeFilter(config, [], opts);
        expect(result).toEqual([]);
    });

    it('all items excluded', async () => {
        const items = [{ status: 'closed' }, { status: 'closed' }];
        const config: FilterNodeConfig = {
            id: 'f1', type: 'filter',
            rule: { type: 'field', field: 'status', op: 'eq', value: 'open' },
            inputs: []
        };
        const result = await executeFilter(config, items, opts);
        expect(result).toEqual([]);
    });

    it('all items included', async () => {
        const items = [{ status: 'open' }, { status: 'open' }];
        const config: FilterNodeConfig = {
            id: 'f1', type: 'filter',
            rule: { type: 'field', field: 'status', op: 'eq', value: 'open' },
            inputs: []
        };
        const result = await executeFilter(config, items, opts);
        expect(result).toHaveLength(2);
        expect(result).toEqual(items);
    });
});
