import { describe, expect, it } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner } from '../../src/server/executors/process-lifecycle-runner';
import { createMockProcessStore } from './helpers/mock-process-store';

describe('ProcessLifecycleRunner dream-run metadata', () => {
    it('persists analyzer and critic process links from the completed dream result', async () => {
        const store = createMockProcessStore();
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, 'claude');
        const task: QueuedTask = {
            id: 'dream-task-1',
            repoId: 'ws-dream',
            type: 'dream-run',
            priority: 'normal',
            status: 'running',
            createdAt: Date.parse('2026-06-10T00:00:00.000Z'),
            payload: {
                kind: 'dream-run',
                workspaceId: 'ws-dream',
                trigger: 'manual',
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                timeoutMs: 3_600_000,
            },
            config: {
                model: 'claude-sonnet-4.6',
                timeoutMs: 3_600_000,
            },
            displayName: 'Dream Run: Manual',
        };

        const result = await runner.run(task, {
            cancelledTasks: new Set(),
            executeFollowUpFn: async () => undefined,
            executeByTypeFn: async () => ({
                response: 'Dream run completed.',
                run: { id: 'dream-run-1' },
                processes: {
                    analyzerProcessId: 'queue_dream-analyzer-1',
                    criticProcessId: 'queue_dream-critic-1',
                },
            }),
            getWorkingDirectoryFn: () => undefined,
        });

        expect(result.success).toBe(true);
        const process = await store.getProcess('queue_dream-task-1');
        expect(process).toMatchObject({
            type: 'dream-run',
            status: 'completed',
            metadata: {
                workspaceId: 'ws-dream',
                provider: 'claude',
                dream: {
                    workspaceId: 'ws-dream',
                    trigger: 'manual',
                    timeoutMs: 3_600_000,
                    analyzerProcessId: 'queue_dream-analyzer-1',
                    criticProcessId: 'queue_dream-critic-1',
                },
            },
        });
        expect(process?.conversationTurns?.[1]).toMatchObject({
            role: 'assistant',
            content: 'Dream run completed.',
        });
    });
});
