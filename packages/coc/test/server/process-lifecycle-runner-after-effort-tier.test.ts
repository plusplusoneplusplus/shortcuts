import { describe, expect, it } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner } from '../../src/server/executors/process-lifecycle-runner';
import { createMockProcessStore } from './helpers/mock-process-store';

/**
 * AC-01 coverage: the lifecycle runner seeds `metadata.afterEffortTier` onto the
 * created process from the launched effort tier carried on `task.config`.
 *
 * `resolveEffortTierConfig` consumes the submitted `config.effortTier` (resolving
 * it into model + reasoningEffort) but preserves the original tier choice as
 * `config.afterEffortTier`, which the runner records here so the follow-up
 * after-tier selector can read it back per conversation.
 */
describe('ProcessLifecycleRunner persisted metadata.afterEffortTier', () => {
    function runTask(task: QueuedTask, store = createMockProcessStore()) {
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, 'claude');
        return runner.run(task, {
            cancelledTasks: new Set(),
            executeFollowUpFn: async () => undefined,
            executeByTypeFn: async () => ({ response: 'done.' }),
            getWorkingDirectoryFn: () => undefined,
        }).then((result) => ({ result, store }));
    }

    function makeChatTask(id: string, config: Record<string, unknown>): QueuedTask {
        return {
            id,
            repoId: 'ws-effort',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.parse('2026-06-29T00:00:00.000Z'),
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Do the thing.',
                workspaceId: 'ws-effort',
            },
            config: config as QueuedTask['config'],
            displayName: 'Chat',
        };
    }

    it('seeds metadata.afterEffortTier from the launched tier on task config', async () => {
        const task = makeChatTask('chat-high', { afterEffortTier: 'high' });

        const { result, store } = await runTask(task);

        expect(result.success).toBe(true);
        const process = await store.getProcess('queue_chat-high');
        expect(process?.metadata?.afterEffortTier).toBe('high');
    });

    it('preserves a very-low after tier', async () => {
        const task = makeChatTask('chat-very-low', { afterEffortTier: 'very-low' });

        const { result, store } = await runTask(task);

        expect(result.success).toBe(true);
        const process = await store.getProcess('queue_chat-very-low');
        expect(process?.metadata?.afterEffortTier).toBe('very-low');
    });

    it('leaves afterEffortTier undefined when no tier was launched', async () => {
        const task = makeChatTask('chat-none', {});

        const { result, store } = await runTask(task);

        expect(result.success).toBe(true);
        const process = await store.getProcess('queue_chat-none');
        expect(process?.metadata?.afterEffortTier).toBeUndefined();
    });

    it('ignores a non-string afterEffortTier on the config', async () => {
        const task = makeChatTask('chat-bad', { afterEffortTier: 42 });

        const { result, store } = await runTask(task);

        expect(result.success).toBe(true);
        const process = await store.getProcess('queue_chat-bad');
        expect(process?.metadata?.afterEffortTier).toBeUndefined();
    });
});
