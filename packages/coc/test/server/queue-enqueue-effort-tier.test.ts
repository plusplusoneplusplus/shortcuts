import { describe, it, expect, vi } from 'vitest';
import type { CreateTaskInput, StoredEffortTiersMap } from '@plusplusoneplusplus/forge';
import { prepareTaskForEnqueue, resolveEffortTierConfig } from '../../src/server/routes/queue-enqueue';
import type { QueueRouteContext } from '../../src/server/routes/queue-shared';

function makeInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
    return {
        type: 'chat',
        priority: 'normal',
        payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
        config: {},
        displayName: 'Test task',
        ...overrides,
    };
}

function makeContext(overrides: Partial<QueueRouteContext> = {}): Pick<QueueRouteContext, 'getDefaultProvider' | 'resolveDefaultProvider' | 'getEffortTiersForProvider'> {
    return {
        getDefaultProvider: () => 'copilot',
        ...overrides,
    };
}

describe('resolveEffortTierConfig', () => {
    it('uses stored tiers for the payload provider', () => {
        const stored: StoredEffortTiersMap = {
            high: { model: 'claude-configured-high', reasoningEffort: 'xhigh' },
        };
        const input = makeInput({
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', provider: 'claude' },
            config: { effortTier: 'high' } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext({
            getDefaultProvider: () => 'copilot',
            getEffortTiersForProvider: (provider) => provider === 'claude' ? stored : undefined,
        }));

        expect(input.config.model).toBe('claude-configured-high');
        expect(input.config.reasoningEffort).toBe('xhigh');
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });

    it('falls back to provider defaults when no stored tiers exist', () => {
        const input = makeInput({
            config: { effortTier: 'low' } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext());

        expect(input.config.model).toBe('claude-sonnet-4.6');
        expect(input.config.reasoningEffort).toBe('high');
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });

    it('resolves the very-low tier from provider defaults', () => {
        const input = makeInput({
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', provider: 'codex' },
            config: { effortTier: 'very-low' } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext());

        expect(input.config.model).toBe('gpt-5.4-mini');
        expect(input.config.reasoningEffort).toBe('low');
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });

    it('does not overwrite explicit model or reasoningEffort', () => {
        const input = makeInput({
            config: {
                effortTier: 'high',
                model: 'explicit-model',
                reasoningEffort: 'low',
            } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext());

        expect(input.config.model).toBe('explicit-model');
        expect(input.config.reasoningEffort).toBe('low');
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });

    it('omits reasoningEffort when the resolved tier uses auto effort', () => {
        const stored: StoredEffortTiersMap = {
            medium: { model: 'auto-effort-model', reasoningEffort: null },
        };
        const input = makeInput({
            config: { effortTier: 'medium' } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext({
            getEffortTiersForProvider: () => stored,
        }));

        expect(input.config.model).toBe('auto-effort-model');
        expect(input.config.reasoningEffort).toBeUndefined();
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });
});

describe('prepareTaskForEnqueue', () => {
    it('resolves Auto to a concrete provider before effort-tier expansion', async () => {
        const stored: StoredEffortTiersMap = {
            high: { model: 'codex-configured-high', reasoningEffort: 'high' },
        };
        const resolveDefaultProvider = vi.fn(async () => ({
            provider: 'codex' as const,
            selectedByAuto: true,
            fallbackUsed: false,
            warnings: ['Quota cache was refreshed.'],
            decisions: [{
                provider: 'codex',
                selected: true,
                reason: 'Provider passed checks.',
            } as any],
        }));
        const input = makeInput({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'test',
                context: { autoProviderRouting: { requested: true } },
            },
            config: { effortTier: 'high' } as CreateTaskInput['config'] & { effortTier: string },
        });

        await prepareTaskForEnqueue(input, makeContext({
            resolveDefaultProvider,
            getEffortTiersForProvider: (provider) => provider === 'codex' ? stored : undefined,
        }));

        expect(resolveDefaultProvider).toHaveBeenCalledWith({ forceAuto: true });
        expect((input.payload as any).provider).toBe('codex');
        expect((input.payload as any).context.autoProviderRouting).toMatchObject({
            selectedByAuto: true,
            provider: 'codex',
            fallbackUsed: false,
        });
        expect(input.config.model).toBe('codex-configured-high');
        expect(input.config.reasoningEffort).toBe('high');
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });

    it('resolves Auto for non-chat task types that carry a chat payload', async () => {
        const input = makeInput({
            type: 'run-workflow',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'execute work item' },
        });

        await prepareTaskForEnqueue(input, makeContext({
            resolveDefaultProvider: async () => ({
                provider: 'claude',
                selectedByAuto: true,
                fallbackUsed: false,
                warnings: [],
                decisions: [{
                    provider: 'claude',
                    selected: true,
                    reason: 'Provider passed checks.',
                } as any],
            }),
        }));

        expect((input.payload as any).provider).toBe('claude');
        expect((input.payload as any).context.autoProviderRouting).toMatchObject({
            selectedByAuto: true,
            provider: 'claude',
        });
    });

    it('preserves explicit providers and does not invoke Auto routing', async () => {
        const resolveDefaultProvider = vi.fn(async () => ({
            provider: 'codex' as const,
            selectedByAuto: true,
            fallbackUsed: false,
            decisions: [],
            warnings: [],
        }));
        const input = makeInput({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'test',
                provider: 'claude',
                context: { autoProviderRouting: { requested: true } },
            },
            config: { effortTier: 'very-low' } as CreateTaskInput['config'] & { effortTier: string },
        });

        await prepareTaskForEnqueue(input, makeContext({ resolveDefaultProvider }));

        expect(resolveDefaultProvider).not.toHaveBeenCalled();
        expect((input.payload as any).provider).toBe('claude');
        expect(input.config.model).toBe('claude-haiku-4.5');
    });

    it('surfaces Auto routing failures before enqueue', async () => {
        const input = makeInput({
            config: { effortTier: 'high' } as CreateTaskInput['config'] & { effortTier: string },
        });

        await expect(prepareTaskForEnqueue(input, makeContext({
            resolveDefaultProvider: async () => ({
                selectedByAuto: true,
                fallbackUsed: false,
                decisions: [],
                warnings: [],
                error: 'Auto provider routing failed. fallback copilot: unavailable',
            }),
        }))).rejects.toThrow('Auto provider routing failed. fallback copilot: unavailable');
    });
});
