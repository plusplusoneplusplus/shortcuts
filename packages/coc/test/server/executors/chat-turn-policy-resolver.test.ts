/**
 * Covers the model / reasoning-effort / context-tier policy shared by the
 * first-turn path (`ChatBaseExecutor.execute`) and the continuation path
 * (`FollowUpExecutor.executeFollowUp`):
 * - explicit model wins; a model the provider rejects is dropped and reported
 * - per-repo default model fills in only when no explicit model survived
 * - persisted effort precedence: provider-scoped > legacy Copilot-only global
 * - Copilot-only long-context tier
 * - the follow-up-style recovery hook for an unsupported per-turn effort
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockLoadConfigFile = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockResolveDefaultModel = vi.hoisted(() => vi.fn().mockReturnValue(undefined));

vi.mock('../../../src/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/config')>();
    return { ...actual, loadConfigFile: mockLoadConfigFile };
});

vi.mock('../../../src/server/preferences-handler', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/server/preferences-handler')>();
    return { ...actual, resolveDefaultModel: mockResolveDefaultModel };
});

import type { ModelInfo } from '@plusplusoneplusplus/forge';
import {
    resolveChatTurnModel,
    resolvePersistedReasoningEffort,
    resolveChatTurnPolicy,
    type CoercedModelReport,
} from '../../../src/server/executors/chat-turn-policy-resolver';

// ============================================================================
// Fixtures
// ============================================================================

/** A Copilot model that supports two efforts and advertises a long-context tier. */
function copilotModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
    return {
        id: 'gpt-5',
        name: 'GPT-5',
        capabilities: { supports: { reasoning_effort: ['low', 'high'] } },
        ...overrides,
    } as unknown as ModelInfo;
}

/**
 * A Copilot model that advertises a long-context tier. The tier is derived
 * only from tiered billing metadata, never from a name list or context window.
 */
function longContextModel(): ModelInfo {
    return copilotModel({
        billing: { tokenPrices: { longContext: { contextMax: 512_000 } } },
    } as unknown as Partial<ModelInfo>);
}

const noMetadata = async () => undefined;

beforeEach(() => {
    mockLoadConfigFile.mockReset().mockReturnValue(null);
    mockResolveDefaultModel.mockReset().mockReturnValue(undefined);
});

// ============================================================================
// Model resolution
// ============================================================================

describe('resolveChatTurnModel', () => {
    it('keeps an explicit model the provider supports and never consults the default', () => {
        const model = resolveChatTurnModel({
            provider: 'copilot',
            requestedModel: 'gpt-5',
            dataDir: '/data',
            workspaceId: 'ws-1',
            defaultModelMode: 'ask',
        });

        expect(model).toBe('gpt-5');
        expect(mockResolveDefaultModel).not.toHaveBeenCalled();
    });

    it('drops a model the provider rejects, reports it, and falls back to the per-repo default', () => {
        mockResolveDefaultModel.mockReturnValue('gpt-5');
        const reports: CoercedModelReport[] = [];

        const model = resolveChatTurnModel({
            provider: 'copilot',
            requestedModel: 'claude-provider-default-x',
            dataDir: '/data',
            workspaceId: 'ws-1',
            defaultModelMode: 'task',
            onCoerced: (r) => reports.push(r),
        });

        expect(model).toBe('gpt-5');
        expect(reports).toEqual([{ requestedModel: 'claude-provider-default-x', source: 'requested' }]);
        expect(mockResolveDefaultModel).toHaveBeenCalledWith('/data', 'ws-1', 'task');
    });

    it('reports a per-repo default the provider rejects as source "default" and falls back to the provider default', () => {
        mockResolveDefaultModel.mockReturnValue('gpt-4o');
        const reports: CoercedModelReport[] = [];

        const model = resolveChatTurnModel({
            provider: 'claude',
            requestedModel: undefined,
            dataDir: '/data',
            workspaceId: 'ws-1',
            defaultModelMode: 'followUp',
            onCoerced: (r) => reports.push(r),
        });

        expect(model).toBeUndefined();
        expect(reports).toEqual([{ requestedModel: 'gpt-4o', source: 'default' }]);
    });

    it('skips the per-repo default lookup when there is no dataDir or workspace', () => {
        const model = resolveChatTurnModel({
            provider: 'copilot',
            requestedModel: undefined,
            defaultModelMode: 'ask',
        });

        expect(model).toBeUndefined();
        expect(mockResolveDefaultModel).not.toHaveBeenCalled();
    });

    it('is idempotent on an already-resolved model, so the follow-up path cannot double-report a coercion', () => {
        const reports: CoercedModelReport[] = [];
        const once = resolveChatTurnModel({
            provider: 'copilot',
            requestedModel: 'gpt-5',
            defaultModelMode: 'ask',
            onCoerced: (r) => reports.push(r),
        });
        const twice = resolveChatTurnModel({
            provider: 'copilot',
            requestedModel: once,
            defaultModelMode: 'followUp',
            onCoerced: (r) => reports.push(r),
        });

        expect(twice).toBe('gpt-5');
        expect(reports).toEqual([]);
    });
});

// ============================================================================
// Persisted reasoning effort
// ============================================================================

describe('resolvePersistedReasoningEffort', () => {
    it('prefers the provider-scoped map over the legacy global map', () => {
        mockLoadConfigFile.mockReturnValue({
            models: {
                reasoningEfforts: { 'gpt-5': 'low' },
                providers: { copilot: { reasoningEfforts: { 'gpt-5': 'high' } } },
            },
        });

        expect(resolvePersistedReasoningEffort('copilot', 'gpt-5')).toBe('high');
    });

    it('falls back to the legacy global map for Copilot when the provider has no settings block', () => {
        mockLoadConfigFile.mockReturnValue({ models: { reasoningEfforts: { 'gpt-5': 'medium' } } });

        expect(resolvePersistedReasoningEffort('copilot', 'gpt-5')).toBe('medium');
    });

    it('never reads the legacy global map for a non-Copilot provider', () => {
        mockLoadConfigFile.mockReturnValue({ models: { reasoningEfforts: { 'gpt-5-codex': 'high' } } });

        expect(resolvePersistedReasoningEffort('codex', 'gpt-5-codex')).toBeUndefined();
    });

    it('returns undefined without reading config when no model is resolved', () => {
        expect(resolvePersistedReasoningEffort('copilot', undefined)).toBeUndefined();
        expect(mockLoadConfigFile).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Combined policy
// ============================================================================

describe('resolveChatTurnPolicy', () => {
    it('lets an explicit per-turn effort win over the persisted preference', async () => {
        mockLoadConfigFile.mockReturnValue({
            models: { providers: { copilot: { reasoningEfforts: { 'gpt-5': 'low' } } } },
        });

        const policy = await resolveChatTurnPolicy({
            provider: 'copilot',
            requestedModel: 'gpt-5',
            defaultModelMode: 'followUp',
            requestedEffort: 'high',
            getModelMetadata: async () => copilotModel(),
        });

        expect(policy.reasoningEffort).toBe('high');
        expect(policy.modelId).toBe('gpt-5');
    });

    it('applies the persisted preference when the turn carries no explicit effort', async () => {
        mockLoadConfigFile.mockReturnValue({
            models: { providers: { copilot: { reasoningEfforts: { 'gpt-5': 'low' } } } },
        });

        const policy = await resolveChatTurnPolicy({
            provider: 'copilot',
            requestedModel: 'gpt-5',
            defaultModelMode: 'ask',
            requestedEffort: undefined,
            getModelMetadata: async () => copilotModel(),
        });

        expect(policy.reasoningEffort).toBe('low');
    });

    it('exposes the pre-selection model separately so sub-agents run the model the user picked', async () => {
        const policy = await resolveChatTurnPolicy({
            provider: 'copilot',
            requestedModel: 'gpt-5',
            defaultModelMode: 'ask',
            requestedEffort: undefined,
            getModelMetadata: async () => copilotModel(),
        });

        expect(policy.resolvedModel).toBe('gpt-5');
    });

    it('requests the Copilot long-context tier when the model advertises tiered billing metadata', async () => {
        const policy = await resolveChatTurnPolicy({
            provider: 'copilot',
            requestedModel: 'gpt-5',
            defaultModelMode: 'ask',
            requestedEffort: undefined,
            getModelMetadata: async () => longContextModel(),
        });

        expect(policy.contextTier).toBe('long_context');
    });

    it('omits the context tier for a Copilot model with no long-context metadata', async () => {
        const noTier = await resolveChatTurnPolicy({
            provider: 'copilot',
            requestedModel: 'gpt-5',
            defaultModelMode: 'ask',
            requestedEffort: undefined,
            getModelMetadata: async () => copilotModel(),
        });
        const noCatalogEntry = await resolveChatTurnPolicy({
            provider: 'copilot',
            requestedModel: 'gpt-5',
            defaultModelMode: 'ask',
            requestedEffort: undefined,
            getModelMetadata: noMetadata,
        });

        expect(noTier.contextTier).toBeUndefined();
        expect(noCatalogEntry.contextTier).toBeUndefined();
    });

    it('never requests a context tier for a non-Copilot provider, even when the model advertises one', async () => {
        for (const provider of ['codex', 'claude', 'opencode'] as const) {
            const policy = await resolveChatTurnPolicy({
                provider,
                requestedModel: undefined,
                defaultModelMode: 'ask',
                requestedEffort: undefined,
                getModelMetadata: async () => longContextModel(),
            });
            expect(policy.contextTier).toBeUndefined();
        }
    });

    it('rethrows an unsupported effort when no recovery hook is supplied (first-turn behavior)', async () => {
        await expect(resolveChatTurnPolicy({
            provider: 'copilot',
            requestedModel: 'gpt-5',
            defaultModelMode: 'ask',
            requestedEffort: 'xhigh',
            getModelMetadata: async () => copilotModel(),
        })).rejects.toThrow();
    });

    it('uses the recovery hook to drop an unsupported effort and keep the model (follow-up behavior)', async () => {
        const policy = await resolveChatTurnPolicy({
            provider: 'copilot',
            requestedModel: 'gpt-5',
            defaultModelMode: 'followUp',
            requestedEffort: 'xhigh',
            getModelMetadata: async () => copilotModel(),
            onReasoningSelectionError: (_err, ctx) => ({ modelId: ctx.modelId }),
        });

        expect(policy.modelId).toBe('gpt-5');
        expect(policy.reasoningEffort).toBeUndefined();
    });

    it('passes the resolved model — not the raw request — to the metadata lookup', async () => {
        mockResolveDefaultModel.mockReturnValue('gpt-5');
        const seen: (string | undefined)[] = [];

        await resolveChatTurnPolicy({
            provider: 'copilot',
            requestedModel: undefined,
            dataDir: '/data',
            workspaceId: 'ws-1',
            defaultModelMode: 'ask',
            requestedEffort: undefined,
            getModelMetadata: async (modelId) => { seen.push(modelId); return undefined; },
        });

        expect(seen).toEqual(['gpt-5']);
    });
});
