import { CocToolRuntime } from '@plusplusoneplusplus/coc-agent-sdk';
import { describe, it, expect } from 'vitest';
import { createSuggestFollowUpsTool, SENTINEL_NEXT_STEPS_GUIDANCE } from '../../../src/server/llm-tools/suggest-follow-ups-tool';

describe('createSuggestFollowUpsTool', () => {
    it('returns a tool with name "suggest_follow_ups"', () => {
        const tool = createSuggestFollowUpsTool();
        expect(tool.name).toBe('suggest_follow_ups');
    });

    it('has description, parameters, and handler properties', () => {
        const tool = createSuggestFollowUpsTool();
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(tool.parameters).toBeDefined();
        expect(tool.handler).toBeDefined();
        expect(typeof tool.handler).toBe('function');
    });

    it('tells the model to write its answer as visible text before calling', () => {
        // Regression: Claude sometimes left the whole answer in thinking and only
        // called this tool, so the chat showed nothing but a closing line.
        const tool = createSuggestFollowUpsTool();
        expect(tool.description).toMatch(/full answer as normal visible text before calling this tool/);
    });

    it('parameters match the expected JSON schema', () => {
        const tool = createSuggestFollowUpsTool();
        const params = tool.parameters as Record<string, unknown>;
        expect(params).toEqual({
            type: 'object',
            properties: {
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 3,
                    maxItems: 3,
                    description: '3 short follow-up action phrases the user might take next (imperative, not questions)',
                },
            },
            required: ['suggestions'],
        });
    });

    it('handler returns exactly 3 suggestions unchanged', async () => {
        const tool = createSuggestFollowUpsTool();
        const input = { suggestions: ['Q1', 'Q2', 'Q3'] };
        const result = await tool.handler(input);
        expect(result).toEqual({ suggestions: ['Q1', 'Q2', 'Q3'] });
    });

    it('handler is a passthrough — output equals input (deep equality)', async () => {
        const tool = createSuggestFollowUpsTool();
        const input = { suggestions: ['How does auth work?', 'Show me the API routes', 'Generate the fix'] };
        const result = await tool.handler(input);
        expect(result).toEqual(input);
    });

    it('keeps added Sentinel guidance within 45 words and optional', () => {
        expect(SENTINEL_NEXT_STEPS_GUIDANCE.split(/\s+/).length).toBeLessThanOrEqual(45);
        expect(SENTINEL_NEXT_STEPS_GUIDANCE).toMatch(/^When useful/);
        expect(SENTINEL_NEXT_STEPS_GUIDANCE).toContain('Suggesting grants no execution authority');
        const tool = createSuggestFollowUpsTool(true);
        expect(tool.description).not.toMatch(/exactly 3|At the end of your response/);
        expect(tool.description).toContain('distinct imperative');
        expect(tool.description).toContain('full answer as normal visible text before calling this tool');
    });

    it.each([1, 2, 3])('accepts %i Sentinel actions without changing count or order', async count => {
        const tool = createSuggestFollowUpsTool(true);
        const suggestions = ['Finish safeguards', 'Run checks', 'Commit changes'].slice(0, count);
        expect((tool.parameters as any).properties.suggestions).toMatchObject({ minItems: 1, maxItems: 3 });
        const runtime = new CocToolRuntime([tool]);
        expect(runtime.listTools()[0].inputSchema).toEqual(tool.parameters);
        const result = await runtime.callTool(tool.name, { suggestions });
        expect(result.isError).not.toBe(true);
        expect(JSON.parse((result.content[0] as any).text)).toEqual({ suggestions });
        runtime.dispose();
    });

    it.each([{ suggestions: [] }, { suggestions: ['A', 'B', 'C', 'D'] }, { suggestions: [42] }])('rejects invalid Sentinel actions $suggestions through the handler', async ({ suggestions }) => {
        const runtime = new CocToolRuntime([createSuggestFollowUpsTool(true)]);
        const result = await runtime.callTool('suggest_follow_ups', { suggestions });
        expect(result.isError).toBe(true);
        expect((result.content[0] as any).text).toContain('Expected 1–3');
        runtime.dispose();
    });

});
