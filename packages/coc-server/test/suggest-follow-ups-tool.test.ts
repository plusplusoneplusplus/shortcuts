import { describe, it, expect } from 'vitest';
import { createSuggestFollowUpsTool, type FollowUpSuggestion } from '../src/suggest-follow-ups-tool';

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

    it('parameters match the expected JSON schema', () => {
        const tool = createSuggestFollowUpsTool();
        const params = tool.parameters as Record<string, unknown>;
        expect(params).toEqual({
            type: 'object',
            properties: {
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 2,
                    maxItems: 3,
                    description: '2-3 short follow-up action phrases the user might take next (imperative, not questions)',
                },
            },
            required: ['suggestions'],
        });
    });

    it('handler returns 2 suggestions unchanged', async () => {
        const tool = createSuggestFollowUpsTool();
        const input = { suggestions: ['Q1', 'Q2'] };
        const result = await tool.handler(input);
        expect(result).toEqual({ suggestions: ['Q1', 'Q2'] });
    });

    it('handler returns 3 suggestions unchanged', async () => {
        const tool = createSuggestFollowUpsTool();
        const input = { suggestions: ['Q1', 'Q2', 'Q3'] };
        const result = await tool.handler(input);
        expect(result).toEqual({ suggestions: ['Q1', 'Q2', 'Q3'] });
    });

    it('handler is a passthrough — output equals input (deep equality)', async () => {
        const tool = createSuggestFollowUpsTool();
        const input = { suggestions: ['How does auth work?', 'Show me the API routes'] };
        const result = await tool.handler(input);
        expect(result).toEqual(input);
    });

    it('FollowUpSuggestion type is importable', () => {
        // Compile-time check: if this file compiles, the type is importable
        const _check: FollowUpSuggestion = { suggestions: ['a', 'b'] };
        expect(_check.suggestions).toHaveLength(2);
    });
});
