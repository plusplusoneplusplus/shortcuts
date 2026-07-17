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

function makeContext(overrides: Partial<QueueRouteContext> = {}): Pick<QueueRouteContext, 'getDefaultProvider' | 'resolveDefaultProvider' | 'isAutoProviderRoutingActive' | 'getEffortTiersForProvider'> {
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
        // The launched tier is preserved as `afterEffortTier` so process
        // creation can seed it onto the conversation record (AC-01).
        expect((input.config as Record<string, unknown>).afterEffortTier).toBe('high');
    });

    it('falls back to provider defaults when no stored tiers exist', () => {
        const input = makeInput({
            config: { effortTier: 'low' } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext());

        expect(input.config.model).toBe('gpt-5.6-terra');
        expect(input.config.reasoningEffort).toBe('xhigh');
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });

    it('resolves Claude tiers to CLI catalog aliases (regression: high tier xhigh)', () => {
        // The Claude high-tier default must reference a model id the Claude
        // CLI catalog advertises ('opus'), so executor-side effort validation
        // can resolve its supported efforts and accept xhigh.
        const input = makeInput({
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', provider: 'claude' },
            config: { effortTier: 'high' } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext());

        expect(input.config.model).toBe('opus');
        expect(input.config.reasoningEffort).toBe('xhigh');
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });

    it('resolves the Claude very-low tier to haiku with no pinned effort', () => {
        // Haiku advertises no reasoning-effort levels, so the tier must not
        // pin one (a pinned effort would fail validation).
        const input = makeInput({
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', provider: 'claude' },
            config: { effortTier: 'very-low' } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext());

        expect(input.config.model).toBe('haiku');
        expect(input.config.reasoningEffort).toBeUndefined();
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });

    it('resolves the very-low tier from provider defaults', () => {
        const input = makeInput({
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', provider: 'codex' },
            config: { effortTier: 'very-low' } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext());

        expect(input.config.model).toBe('gpt-5.6-luna');
        expect(input.config.reasoningEffort).toBe('xhigh');
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

describe('resolveEffortTierConfig — afterEffortTier carrier (AC-01)', () => {
    it('preserves the launched very-low tier as afterEffortTier', () => {
        const input = makeInput({
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', provider: 'claude' },
            config: { effortTier: 'very-low' } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext());

        expect((input.config as Record<string, unknown>).afterEffortTier).toBe('very-low');
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });

    it('records the tier even when no tier entry resolves to a model', () => {
        // The user picked the tier, so the choice must be recorded for read-back
        // even if the provider has no matching tier mapping (model/effort stay
        // unresolved, but afterEffortTier still reflects intent).
        const input = makeInput({
            config: { effortTier: 'medium' } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext({
            getDefaultProvider: () => 'copilot',
            getEffortTiersForProvider: () => ({}),
        }));

        expect((input.config as Record<string, unknown>).afterEffortTier).toBe('medium');
    });

    it('does not set afterEffortTier when no tier was submitted', () => {
        const input = makeInput({ config: {} });

        resolveEffortTierConfig(input, makeContext());

        expect((input.config as Record<string, unknown>).afterEffortTier).toBeUndefined();
    });

    it('does not set afterEffortTier for an invalid tier value', () => {
        const input = makeInput({
            config: { effortTier: 'bogus' } as CreateTaskInput['config'] & { effortTier: string },
        });

        resolveEffortTierConfig(input, makeContext());

        expect((input.config as Record<string, unknown>).afterEffortTier).toBeUndefined();
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
    });
});

describe('prepareTaskForEnqueue', () => {
    it('marks requested Auto routing without resolving a concrete provider at enqueue', async () => {
        const stored: StoredEffortTiersMap = {
            high: { model: 'copilot-configured-high', reasoningEffort: 'high' },
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
            isAutoProviderRoutingActive: () => true,
            getEffortTiersForProvider: (provider) => provider === 'copilot' ? stored : undefined,
        }));

        expect(resolveDefaultProvider).not.toHaveBeenCalled();
        expect((input.payload as any).provider).toBeUndefined();
        expect((input.payload as any).context.autoProviderRouting).toEqual({ requested: true });
        // Auto defers the tier→model choice to execution, where the provider is
        // actually known. Seeding here would resolve against the default provider
        // and get coerced away for whatever provider Auto really picks.
        expect(input.config.model).toBeUndefined();
        expect(input.config.reasoningEffort).toBeUndefined();
        expect((input.config as Record<string, unknown>).effortTier).toBeUndefined();
        expect((input.config as Record<string, unknown>).afterEffortTier).toBe('high');
    });

    it('keeps a caller-supplied model under Auto rather than clearing it', async () => {
        const input = makeInput({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'test',
                context: { autoProviderRouting: { requested: true } },
            },
            config: { effortTier: 'high', model: 'caller-pinned-model' } as CreateTaskInput['config'] & { effortTier: string },
        });

        await prepareTaskForEnqueue(input, makeContext({
            isAutoProviderRoutingActive: () => true,
        }));

        expect(input.config.model).toBe('caller-pinned-model');
        expect((input.config as Record<string, unknown>).afterEffortTier).toBe('high');
    });

    it('still seeds the tier at enqueue for an explicit provider', async () => {
        const input = makeInput({
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', provider: 'claude' },
            config: { effortTier: 'medium' } as CreateTaskInput['config'] & { effortTier: string },
        });

        await prepareTaskForEnqueue(input, makeContext({
            isAutoProviderRoutingActive: () => true,
        }));

        expect(input.config.model).toBe('opus');
        expect(input.config.reasoningEffort).toBe('medium');
        expect((input.config as Record<string, unknown>).afterEffortTier).toBe('medium');
    });

    it('marks Auto for non-chat task types that carry a chat payload', async () => {
        const input = makeInput({
            type: 'run-workflow',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'execute work item' },
        });
        const resolveDefaultProvider = vi.fn(async () => ({
            provider: 'claude' as const,
            selectedByAuto: true,
            fallbackUsed: false,
            warnings: [],
            decisions: [],
        }));

        await prepareTaskForEnqueue(input, makeContext({
            resolveDefaultProvider,
            isAutoProviderRoutingActive: () => true,
        }));

        expect(resolveDefaultProvider).not.toHaveBeenCalled();
        expect((input.payload as any).provider).toBeUndefined();
        expect((input.payload as any).context.autoProviderRouting).toEqual({ requested: true });
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
        expect(input.config.model).toBe('haiku');
    });

    it('resolves omitted dream-run providers to the concrete default at enqueue time', async () => {
        const input = makeInput({
            type: 'dream-run',
            payload: {
                kind: 'dream-run',
                workspaceId: 'ws-dream',
                trigger: 'manual',
                model: 'claude-sonnet-4.6',
                timeoutMs: 3_600_000,
            },
            config: { timeoutMs: 3_600_000 },
        });

        await prepareTaskForEnqueue(input, makeContext({
            getDefaultProvider: () => 'claude',
        }));

        expect((input.payload as any).provider).toBe('claude');
        expect((input.payload as any).model).toBe('claude-sonnet-4.6');
        expect(input.config.model).toBe('claude-sonnet-4.6');
        expect(input.config.timeoutMs).toBe(3_600_000);
    });

    it('resolves Auto-routed dream-run providers and records routing metadata', async () => {
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
            type: 'dream-run',
            payload: {
                kind: 'dream-run',
                workspaceId: 'ws-dream',
                trigger: 'idle',
                context: { autoProviderRouting: { requested: true } },
            },
            config: { timeoutMs: 3_600_000 },
        });

        await prepareTaskForEnqueue(input, makeContext({
            resolveDefaultProvider,
            isAutoProviderRoutingActive: () => true,
        }));

        expect(resolveDefaultProvider).toHaveBeenCalledWith({ forceAuto: true });
        expect((input.payload as any).provider).toBe('codex');
        expect((input.payload as any).context.autoProviderRouting).toMatchObject({
            requested: true,
            selectedByAuto: true,
            provider: 'codex',
            fallbackUsed: false,
        });
    });

    it('does not mark follow-up tasks for Auto routing', async () => {
        const input = makeInput({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'follow up',
                processId: 'queue_existing',
            },
        });

        await prepareTaskForEnqueue(input, makeContext({
            isAutoProviderRoutingActive: () => true,
        }));

        expect((input.payload as any).provider).toBeUndefined();
        expect((input.payload as any).context).toBeUndefined();
    });

    it('rejects requested Auto routing when the auto default gate is inactive', async () => {
        const input = makeInput({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'test',
                context: { autoProviderRouting: { requested: true } },
            },
            config: { effortTier: 'high' } as CreateTaskInput['config'] & { effortTier: string },
        });
        const resolveDefaultProvider = vi.fn(async () => ({
            selectedByAuto: true,
            fallbackUsed: false,
            decisions: [],
            warnings: [],
            error: 'Auto provider routing failed. fallback copilot: unavailable',
        }));

        await expect(prepareTaskForEnqueue(input, makeContext({
            resolveDefaultProvider,
            isAutoProviderRoutingActive: () => false,
        }))).rejects.toThrow('Auto provider routing requires features.autoAgentProviderRouting: true');
        expect(resolveDefaultProvider).not.toHaveBeenCalled();
    });
});
