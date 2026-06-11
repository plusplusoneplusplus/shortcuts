import { describe, expect, it } from 'vitest';
import type { ModelInfo } from '@plusplusoneplusplus/coc-agent-sdk';
import { resolveReasoningEffort, resolveReasoningSelection } from '@plusplusoneplusplus/coc-agent-sdk';

function model(
    id: string,
    options: {
        rawEfforts?: string[];
        supportedEfforts?: string[];
        defaultEffort?: string;
        supportsReasoning?: boolean;
        family?: string;
    },
): ModelInfo {
    const supportsReasoning = options.supportsReasoning
        ?? (options.supportedEfforts !== undefined || options.rawEfforts !== undefined);

    return {
        id,
        name: id,
        capabilities: {
            ...(options.family ? { family: options.family } : {}),
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

    it('uses the base model family for raw-effort variant models', () => {
        expect(resolveReasoningSelection({
            modelId: 'claude-opus-4.7-high',
            model: model('claude-opus-4.7-high', {
                family: 'claude-opus-4.7',
                rawEfforts: ['high'],
                supportedEfforts: ['medium'],
                defaultEffort: 'medium',
            }),
        })).toEqual({
            modelId: 'claude-opus-4.7',
            reasoningEffort: 'high',
        });
    });

    it('strips raw-effort suffix when family is self-referential (upstream regression)', () => {
        expect(resolveReasoningSelection({
            modelId: 'claude-opus-4.7-xhigh',
            model: model('claude-opus-4.7-xhigh', {
                family: 'claude-opus-4.7-xhigh',
                rawEfforts: ['xhigh'],
                supportedEfforts: ['medium'],
                defaultEffort: 'medium',
            }),
        })).toEqual({
            modelId: 'claude-opus-4.7',
            reasoningEffort: 'xhigh',
        });
    });

    it('strips raw-effort suffix when family is missing entirely', () => {
        expect(resolveReasoningSelection({
            modelId: 'claude-opus-4.7-high',
            model: model('claude-opus-4.7-high', {
                rawEfforts: ['high'],
                supportedEfforts: ['high'],
            }),
        })).toEqual({
            modelId: 'claude-opus-4.7',
            reasoningEffort: 'high',
        });
    });

    it('does not strip suffix for multi-effort models', () => {
        expect(resolveReasoningSelection({
            modelId: 'claude-opus-4.7-flex',
            model: model('claude-opus-4.7-flex', {
                family: 'claude-opus-4.7-flex',
                rawEfforts: ['low', 'medium', 'high'],
                defaultEffort: 'medium',
            }),
        })).toEqual({
            modelId: 'claude-opus-4.7-flex',
            reasoningEffort: 'medium',
        });
    });

    it('does not strip suffix when modelId does not end with the resolved effort', () => {
        expect(resolveReasoningSelection({
            modelId: 'claude-opus-4.7-internal',
            model: model('claude-opus-4.7-internal', {
                family: 'claude-opus-4.7-internal',
                rawEfforts: ['xhigh'],
            }),
        })).toEqual({
            modelId: 'claude-opus-4.7-internal',
            reasoningEffort: 'xhigh',
        });
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

    it('passes a requested effort through when support is unknown and allowUnknownEffort is set', () => {
        // Self-downgrading providers (e.g. Claude) keep the requested level even
        // when no catalog metadata is available instead of throwing.
        expect(resolveReasoningEffort({
            modelId: 'claude-opus-4-7',
            requestedEffort: 'xhigh',
            allowUnknownEffort: true,
        })).toBe('xhigh');
    });

    it('passes a requested effort through with allowUnknownEffort even when no model id is known', () => {
        // Mirrors the provider-default Claude path that produced the reported
        // 'model "unknown" / Supported efforts: unknown' error: no model id, no
        // metadata, but the SDK still accepts (and downgrades) the effort.
        expect(resolveReasoningEffort({
            requestedEffort: 'xhigh',
            allowUnknownEffort: true,
        })).toBe('xhigh');
    });

    it('still throws for a KNOWN-incompatible effort even when allowUnknownEffort is set', () => {
        // allowUnknownEffort only relaxes the unknown-support case; a catalog
        // that lists a supported set excluding the request is authoritative.
        expect(() => resolveReasoningEffort({
            modelId: 'high-only',
            requestedEffort: 'xhigh',
            model: model('high-only', { supportedEfforts: ['high'] }),
            allowUnknownEffort: true,
        })).toThrow('Unsupported reasoning effort "xhigh" requested for model "high-only". Supported efforts: high');
    });

    it('still throws for an unrecognized effort even when allowUnknownEffort is set', () => {
        expect(() => resolveReasoningEffort({
            modelId: 'claude-opus-4-7',
            requestedEffort: 'turbo' as never,
            allowUnknownEffort: true,
        })).toThrow('Unsupported reasoning effort "turbo" requested for model "claude-opus-4-7". Known efforts: low, medium, high, xhigh');
    });

    it('returns undefined for non-reasoning models', () => {
        expect(resolveReasoningEffort({
            modelId: 'plain-model',
            model: model('plain-model', { supportsReasoning: false }),
        })).toBeUndefined();
    });

    // =========================================================================
    // Suffix-based fallback (no raw CAPI capabilities)
    // =========================================================================

    it('infers xhigh effort from model ID suffix when raw capabilities are absent and contract data is stale', () => {
        // Reproduces: CAPIError 400 reasoning_effort "medium" is not supported
        // by model claude-opus-4.7-xhigh; supported values: [xhigh]
        expect(resolveReasoningSelection({
            modelId: 'claude-opus-4.7-xhigh',
            model: model('claude-opus-4.7-xhigh', {
                // No rawEfforts — CAPI capability field missing from metadata
                supportedEfforts: ['medium'],
                defaultEffort: 'medium',
            }),
        })).toEqual({
            modelId: 'claude-opus-4.7',
            reasoningEffort: 'xhigh',
        });
    });

    it('infers high effort from model ID suffix when no model metadata is available', () => {
        expect(resolveReasoningSelection({
            modelId: 'claude-opus-4.7-high',
            // No model metadata at all (store not initialized)
        })).toEqual({
            modelId: 'claude-opus-4.7',
            reasoningEffort: 'high',
        });
    });

    it('infers effort from suffix when metadata has no reasoning support info', () => {
        expect(resolveReasoningSelection({
            modelId: 'some-model-medium',
            model: model('some-model-medium', { supportsReasoning: false }),
        })).toEqual({
            modelId: 'some-model',
            reasoningEffort: 'medium',
        });
    });

    it('does not apply suffix inference when raw CAPI capabilities are present', () => {
        // Raw capabilities are authoritative — suffix inference should not interfere
        expect(resolveReasoningSelection({
            modelId: 'claude-opus-4.7-xhigh',
            model: model('claude-opus-4.7-xhigh', {
                family: 'claude-opus-4.7',
                rawEfforts: ['xhigh'],
                supportedEfforts: ['medium'],
                defaultEffort: 'medium',
            }),
        })).toEqual({
            modelId: 'claude-opus-4.7',
            reasoningEffort: 'xhigh',
        });
    });

    it('does not apply suffix inference for model IDs not ending with a known effort', () => {
        expect(resolveReasoningSelection({
            modelId: 'claude-opus-4.7-internal',
            model: model('claude-opus-4.7-internal', {
                supportedEfforts: ['medium', 'high'],
                defaultEffort: 'medium',
            }),
        })).toEqual({
            modelId: 'claude-opus-4.7-internal',
            reasoningEffort: 'medium',
        });
    });

    it('keeps the requested effort and model id when allowUnknownEffort is set and metadata is missing', () => {
        // Provider-default-style Claude path: a concrete model id with no catalog
        // metadata. The effort passes through and the id is left untouched
        // (no effort suffix to strip).
        expect(resolveReasoningSelection({
            modelId: 'claude-opus-4-7',
            requestedEffort: 'xhigh',
            allowUnknownEffort: true,
        })).toEqual({
            modelId: 'claude-opus-4-7',
            reasoningEffort: 'xhigh',
        });
    });
});
