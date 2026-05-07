import { describe, expect, it } from 'vitest';
import type { ModelInfo } from '../../src/copilot-sdk-wrapper/model-info';
import { resolveReasoningEffort } from '../../src/copilot-sdk-wrapper/model-reasoning';

function model(
    id: string,
    options: {
        rawEfforts?: string[];
        supportedEfforts?: string[];
        defaultEffort?: string;
        supportsReasoning?: boolean;
    },
): ModelInfo {
    const supportsReasoning = options.supportsReasoning
        ?? (options.supportedEfforts !== undefined || options.rawEfforts !== undefined);

    return {
        id,
        name: id,
        capabilities: {
            supports: {
                vision: false,
                reasoningEffort: supportsReasoning,
                ...(options.rawEfforts ? { reasoning_effort: options.rawEfforts } : {}),
            },
            limits: { max_context_window_tokens: 200_000 },
        },
        ...(options.supportedEfforts ? { supportedReasoningEfforts: options.supportedEfforts } : {}),
        ...(options.defaultEffort ? { defaultReasoningEffort: options.defaultEffort } : {}),
    };
}

describe('resolveReasoningEffort', () => {
    it('chooses high for a high-only model', () => {
        expect(resolveReasoningEffort({
            modelId: 'high-only',
            model: model('high-only', { supportedEfforts: ['high'], defaultEffort: 'high' }),
        })).toBe('high');
    });

    it('chooses xhigh for an xhigh-only model', () => {
        expect(resolveReasoningEffort({
            modelId: 'xhigh-only',
            model: model('xhigh-only', { supportedEfforts: ['xhigh'] }),
        })).toBe('xhigh');
    });

    it('chooses medium for a medium-only model', () => {
        expect(resolveReasoningEffort({
            modelId: 'medium-only',
            model: model('medium-only', { supportedEfforts: ['medium'] }),
        })).toBe('medium');
    });

    it('uses a valid defaultReasoningEffort for multi-effort models', () => {
        expect(resolveReasoningEffort({
            modelId: 'multi-effort',
            model: model('multi-effort', {
                supportedEfforts: ['low', 'medium', 'high'],
                defaultEffort: 'medium',
            }),
        })).toBe('medium');
    });

    it('prefers raw capability efforts over stale top-level defaults', () => {
        expect(resolveReasoningEffort({
            modelId: 'claude-opus-4.7-high',
            model: model('claude-opus-4.7-high', {
                rawEfforts: ['high'],
                supportedEfforts: ['medium'],
                defaultEffort: 'medium',
            }),
        })).toBe('high');
    });

    it('throws for an explicitly requested unsupported effort', () => {
        expect(() => resolveReasoningEffort({
            modelId: 'high-only',
            requestedEffort: 'medium',
            model: model('high-only', { supportedEfforts: ['high'] }),
        })).toThrow('Unsupported reasoning effort "medium" requested for model "high-only". Supported efforts: high');
    });

    it('throws for an explicitly requested effort with unknown support', () => {
        expect(() => resolveReasoningEffort({
            modelId: 'unknown-support',
            requestedEffort: 'high',
        })).toThrow('Unsupported reasoning effort "high" requested for model "unknown-support". Supported efforts: unknown');
    });

    it('returns undefined for non-reasoning models', () => {
        expect(resolveReasoningEffort({
            modelId: 'plain-model',
            model: model('plain-model', { supportsReasoning: false }),
        })).toBeUndefined();
    });
});
