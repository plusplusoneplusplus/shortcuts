import { describe, expect, it } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner } from '../../src/server/executors/process-lifecycle-runner';
import { createMockProcessStore } from './helpers/mock-process-store';

/**
 * A chat restarted via `POST /api/queue/:id/retry` carries the failed chat's
 * process id on `payload.restartedFrom`; the runner records it on the new
 * process so the SPA can link back to the previous chat.
 */
describe('ProcessLifecycleRunner persisted metadata.restartedFrom', () => {
    function makeChatTask(id: string, restartedFrom?: string): QueuedTask {
        return {
            id,
            repoId: 'ws-restart',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.parse('2026-09-26T00:00:00.000Z'),
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Do the thing.',
                workspaceId: 'ws-restart',
                ...(restartedFrom ? { restartedFrom } : {}),
            },
            config: {},
            displayName: 'Chat',
        };
    }

    async function run(task: QueuedTask) {
        const store = createMockProcessStore();
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, 'claude');
        await runner.run(task, {
            cancelledTasks: new Set(),
            executeFollowUpFn: async () => undefined,
            executeByTypeFn: async () => ({ response: 'done.' }),
            getWorkingDirectoryFn: () => undefined,
        });
        return store.getProcess(`queue_${task.id}`);
    }

    it('records restartedFrom from the payload', async () => {
        const process = await run(makeChatTask('restart-1', 'queue_failed-1'));
        expect(process?.metadata?.restartedFrom).toBe('queue_failed-1');
    });

    it('leaves restartedFrom undefined for a normal chat', async () => {
        const process = await run(makeChatTask('plain-1'));
        expect(process?.metadata?.restartedFrom).toBeUndefined();
    });
});
