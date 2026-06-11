/**
 * Tests for Copilot context-tier resolution helpers.
 *
 * Long-context support is derived strictly from tiered billing metadata
 * (camelCase SDK shape or snake_case runtime shape) — never from model names
 * or max_context_window_tokens.
 */

import { describe, it, expect } from 'vitest';
import {
    getCopilotContextTierForModel,
    getCopilotLongContextPromptLimit,
} from '../../src/model-context-tier';
import type { ModelInfo } from '../../src/model-info';

function makeModel(billing?: unknown): ModelInfo {
    return {
        id: 'test-model',
        name: 'Test Model',
        capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128_000 },
        },
        ...(billing !== undefined ? { billing: billing as ModelInfo['billing'] } : {}),
    };
}

describe('getCopilotLongContextPromptLimit', () => {
    it('returns contextMax for camelCase metadata (billing.tokenPrices.longContext.contextMax)', () => {
        const model = makeModel({ tokenPrices: { longContext: { contextMax: 1_000_000 } } });
        expect(getCopilotLongContextPromptLimit(model)).toBe(1_000_000);
    });

    it('returns context_max for snake_case metadata (billing.token_prices.long_context.context_max)', () => {
        const model = makeModel({ token_prices: { long_context: { context_max: 900_000 } } });
        expect(getCopilotLongContextPromptLimit(model)).toBe(900_000);
    });

    it('returns undefined when billing metadata is missing', () => {
        expect(getCopilotLongContextPromptLimit(makeModel())).toBeUndefined();
    });

    it('returns undefined for an undefined model', () => {
        expect(getCopilotLongContextPromptLimit(undefined)).toBeUndefined();
    });

    it('returns undefined for standard-only pricing (no long-context entry)', () => {
        const model = makeModel({ multiplier: 1, tokenPrices: { standard: { input: 1 } } });
        expect(getCopilotLongContextPromptLimit(model)).toBeUndefined();
    });

    it.each([
        ['zero', 0],
        ['negative', -100],
        ['NaN', NaN],
        ['string', '1000000'],
        ['null', null],
    ])('returns undefined for %s contextMax', (_label, contextMax) => {
        const model = makeModel({ tokenPrices: { longContext: { contextMax } } });
        expect(getCopilotLongContextPromptLimit(model)).toBeUndefined();
    });

    it('does not infer support from max_context_window_tokens alone', () => {
        const model: ModelInfo = {
            id: 'big-window',
            name: 'Big Window',
            capabilities: {
                supports: { vision: false, reasoningEffort: false },
                limits: { max_context_window_tokens: 1_000_000 },
            },
        };
        expect(getCopilotLongContextPromptLimit(model)).toBeUndefined();
    });
});

describe('getCopilotContextTierForModel', () => {
    it('returns "long_context" for a model with camelCase long-context metadata', () => {
        const model = makeModel({ tokenPrices: { longContext: { contextMax: 1_000_000 } } });
        expect(getCopilotContextTierForModel(model)).toBe('long_context');
    });

    it('returns "long_context" for a model with snake_case long-context metadata', () => {
        const model = makeModel({ token_prices: { long_context: { context_max: 1_000_000 } } });
        expect(getCopilotContextTierForModel(model)).toBe('long_context');
    });

    it('returns undefined for a model without long-context metadata', () => {
        expect(getCopilotContextTierForModel(makeModel({ multiplier: 1 }))).toBeUndefined();
    });

    it('returns undefined for an undefined model', () => {
        expect(getCopilotContextTierForModel(undefined)).toBeUndefined();
    });

    it('returns undefined when contextMax is invalid', () => {
        const model = makeModel({ tokenPrices: { longContext: { contextMax: 0 } } });
        expect(getCopilotContextTierForModel(model)).toBeUndefined();
    });
});
