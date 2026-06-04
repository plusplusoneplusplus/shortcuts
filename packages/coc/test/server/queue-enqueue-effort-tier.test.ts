import { describe, it, expect } from 'vitest';
import type { CreateTaskInput, StoredEffortTiersMap } from '@plusplusoneplusplus/forge';
import { resolveEffortTierConfig } from '../../src/server/routes/queue-enqueue';
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

function makeContext(overrides: Partial<QueueRouteContext> = {}): Pick<QueueRouteContext, 'getDefaultProvider' | 'getEffortTiersForProvider'> {
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
