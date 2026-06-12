import { describe, expect, it } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner } from '../../src/server/executors/process-lifecycle-runner';
import { createMockProcessStore } from './helpers/mock-process-store';

/**
 * Regression coverage for the persisted `metadata.mode` of non-chat tasks.
 *
 * pr-classification tasks run read-only ask mode (ClassificationExecutor), but
 * the lifecycle runner historically only recorded `mode` for chat payloads, so
 * the field was absent and UI surfaces fell back to labelling the process
 * 'autopilot'. The runner now records `mode: 'ask'` for classification tasks.
 */
describe('ProcessLifecycleRunner persisted metadata.mode', () => {
    function runTask(task: QueuedTask, store = createMockProcessStore()) {
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, 'claude');
        return runner.run(task, {
            cancelledTasks: new Set(),
            executeFollowUpFn: async () => undefined,
            executeByTypeFn: async () => ({ response: 'done.' }),
            getWorkingDirectoryFn: () => undefined,
        }).then((result) => ({ result, store }));
    }

    it("records mode 'ask' for pr-classification tasks", async () => {
        const task: QueuedTask = {
            id: 'classify-task-1',
            repoId: 'ws-classify',
            type: 'pr-classification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.parse('2026-06-12T00:00:00.000Z'),
            payload: {
                kind: 'pr-classification',
                workspaceId: 'ws-classify',
                repoId: 'ws-classify',
                prId: 'abc1234',
                headSha: 'abc1234',
                prompt: 'Classify every hunk in commit abc1234 of this repository.',
                skills: ['classify-diff'],
            },
            config: {},
            displayName: 'Classifying commit diff hunks',
        };

        const { result, store } = await runTask(task);

        expect(result.success).toBe(true);
        const process = await store.getProcess('queue_classify-task-1');
        expect(process?.metadata?.mode).toBe('ask');
        // The seeded user turn carries the same mode so the conversation is
        // consistent with the recorded process metadata.
        expect(process?.conversationTurns?.[0]?.mode).toBe('ask');
    });

    it('keeps the explicit chat mode for chat tasks', async () => {
        const task: QueuedTask = {
            id: 'chat-task-1',
            repoId: 'ws-chat',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.parse('2026-06-12T00:00:00.000Z'),
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Do the thing.',
                workspaceId: 'ws-chat',
            },
            config: {},
            displayName: 'Chat',
        };

        const { result, store } = await runTask(task);

        expect(result.success).toBe(true);
        const process = await store.getProcess('queue_chat-task-1');
        expect(process?.metadata?.mode).toBe('autopilot');
    });

    it('leaves mode undefined for unrelated non-chat tasks', async () => {
        const task: QueuedTask = {
            id: 'workflow-task-1',
            repoId: 'ws-wf',
            type: 'run-workflow',
            priority: 'normal',
            status: 'running',
            createdAt: Date.parse('2026-06-12T00:00:00.000Z'),
            payload: {
                kind: 'run-workflow',
                workflowPath: '/tmp/example.workflow.js',
                workspaceId: 'ws-wf',
            },
            config: {},
            displayName: 'Run Workflow',
        };

        const { result, store } = await runTask(task);

        expect(result.success).toBe(true);
        const process = await store.getProcess('queue_workflow-task-1');
        expect(process?.metadata?.mode).toBeUndefined();
    });
});
