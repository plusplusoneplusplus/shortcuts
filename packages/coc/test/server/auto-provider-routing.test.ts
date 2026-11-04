import { describe, expect, it, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { isAutoProviderRoutingRequested, parseAutoProviderRoutingContext } from '../../src/server/tasks/auto-provider-routing';
import { validateAndParseTask } from '../../src/server/routes/queue-shared';
import { prepareTaskForEnqueue } from '../../src/server/routes/queue-enqueue';
import { ProcessLifecycleRunner } from '../../src/server/executors/process-lifecycle-runner';
import { createMockProcessStore } from './helpers/mock-process-store';

describe('Auto-routing ingress and typed policy', () => {
    it.each([
        undefined, null, [], 'auto', {},
        { autoProviderRouting: null },
        { autoProviderRouting: [] },
        { autoProviderRouting: { requested: 'true' } },
        { autoProviderRouting: { requested: 1 } },
        { autoProviderRouting: { selectedByAuto: true } },
        { autoProviderRouting: { requested: false } },
    ])('does not request Auto for malformed or omitted context %j', value => {
        expect(isAutoProviderRoutingRequested(parseAutoProviderRoutingContext(value))).toBe(false);
    });

    it('preserves provenance, opaque context and explicit false without mutating ingress', () => {
        const context = {
            scheduleId: 'schedule-a',
            ralph: { sessionId: 'session-a' },
            autoProviderRouting: {
                requested: true, selectedByAuto: true, provider: 'claude',
                warnings: ['quota'], decisions: [{ eligible: true }],
                fallbackUsed: true, fallback: { reason: 'quota' },
            },
        };
        expect(parseAutoProviderRoutingContext(context)).toEqual(context);
        expect(parseAutoProviderRoutingContext(context)).not.toBe(context);
        expect(parseAutoProviderRoutingContext({ autoProviderRouting: { requested: false } }))
            .toEqual({ autoProviderRouting: { requested: false } });
        expect(parseAutoProviderRoutingContext({ scheduleId: 'schedule-a' }))
            .toEqual({ scheduleId: 'schedule-a' });
    });

    it('keeps a valid request while dropping malformed typed metadata', () => {
        expect(parseAutoProviderRoutingContext({
            autoProviderRouting: {
                requested: true, selectedByAuto: 'true', provider: 'unknown',
                warnings: [1], decisions: {}, fallbackUsed: 1,
            },
        })).toEqual({ autoProviderRouting: { requested: true } });
    });

    it('parses wire context before model selection and routes only when the task executes', async () => {
        const parsed = validateAndParseTask({
            type: 'chat',
            payload: {
                kind: 'chat', mode: 'ralph', prompt: 'Continue the goal.',
                workspaceId: 'workspace-a',
                context: { autoProviderRouting: { requested: true }, scheduleId: 'schedule-a' },
            },
            config: { model: 'opus', reasoningEffort: 'high' },
        });
        expect(parsed.valid).toBe(true);
        const input = parsed.input!;
        expect(input.config.model).toBe('opus');
        const resolveDefaultProvider = vi.fn().mockResolvedValue({
            provider: 'claude', selectedByAuto: true, fallbackUsed: false,
            warnings: [], decisions: [],
        });
        await prepareTaskForEnqueue(input, {
            isAutoProviderRoutingActive: () => true,
            resolveDefaultProvider,
        });
        expect(resolveDefaultProvider).not.toHaveBeenCalled();
        const task: QueuedTask = {
            ...input, id: 'auto-ingress', status: 'running', createdAt: 0,
            config: input.config ?? {}, priority: 'normal',
        };
        const store = createMockProcessStore();
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, 'copilot');
        const result = await runner.run(task, {
            cancelledTasks: new Set(),
            executeFollowUpFn: async () => undefined,
            executeByTypeFn: async () => ({ response: 'done' }),
            getWorkingDirectoryFn: () => undefined,
            resolveDefaultProvider,
        });
        expect(result.success).toBe(true);
        expect(resolveDefaultProvider).toHaveBeenCalledExactlyOnceWith({ forceAuto: true });
        expect(task.payload.provider).toBe('claude');
        expect((await store.getProcess('queue_auto-ingress'))?.metadata?.autoProviderRouting)
            .toMatchObject({ requested: true, provider: 'claude' });
    });

    it('keeps an explicit provider authoritative over the Auto marker', async () => {
        const parsed = validateAndParseTask({
            type: 'chat',
            payload: {
                kind: 'chat', mode: 'ask', prompt: 'Inspect.',
                provider: 'codex', context: { autoProviderRouting: { requested: true } },
            },
        });
        const resolveDefaultProvider = vi.fn();
        await prepareTaskForEnqueue(parsed.input!, {
            isAutoProviderRoutingActive: () => false,
            resolveDefaultProvider,
        });
        expect(resolveDefaultProvider).not.toHaveBeenCalled();
        expect(parsed.input?.payload.provider).toBe('codex');
    });
});
