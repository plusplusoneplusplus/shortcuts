import { describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, type QueuedTask, type TaskExecutionResult } from '@plusplusoneplusplus/forge';
import { executeImplementPlanWithPrGate } from '../../src/server/queue/implement-plan-pr-gate';

const BASELINE_SHA = 'a'.repeat(40);
const FIRST_COMMIT_SHA = 'b'.repeat(40);
const END_SHA = 'c'.repeat(40);

function startGatedTask(): { manager: TaskQueueManager; task: QueuedTask } {
    const manager = new TaskQueueManager({ getTaskRepoId: task => task.repoId });
    const taskId = manager.enqueue({
        type: 'chat',
        priority: 'normal',
        payload: { kind: 'chat', mode: 'autopilot', workingDirectory: '/repo/demo' },
        config: { prGate: { autoMerge: true, chainId: 'chain-1' } },
        repoId: 'repo-A',
    });
    return { manager, task: manager.markStarted(taskId)! };
}

const completedResult = (): TaskExecutionResult => ({
    success: true,
    result: { response: 'implemented' },
    durationMs: 10,
});

describe('executeImplementPlanWithPrGate', () => {
    it('records the exact baseline, end, and oldest-first commits around the implement run', async () => {
        const { manager, task } = startGatedTask();
        const captureHeadSha = vi.fn()
            .mockResolvedValueOnce(BASELINE_SHA)
            .mockResolvedValueOnce(END_SHA);
        const execute = vi.fn().mockResolvedValue(completedResult());
        const listCommitShas = vi.fn().mockResolvedValue([FIRST_COMMIT_SHA, END_SHA]);

        await expect(executeImplementPlanWithPrGate({
            task,
            queueManager: manager,
            workingDirectory: '/repo/demo',
            execute,
            captureHeadSha,
            listCommitShas,
        })).resolves.toEqual(completedResult());

        expect(captureHeadSha).toHaveBeenCalledTimes(2);
        expect(listCommitShas).toHaveBeenCalledWith('/repo/demo', BASELINE_SHA, END_SHA);
        expect(manager.getRepoGate('repo-A')).toEqual({
            chainId: 'chain-1',
            implementTaskId: task.id,
            baselineSha: BASELINE_SHA,
            endSha: END_SHA,
            commitShas: [FIRST_COMMIT_SHA, END_SHA],
            outcome: 'commits-recorded',
        });
        expect(task.config.prGate).toMatchObject({
            baselineSha: BASELINE_SHA,
            endSha: END_SHA,
            commitShas: [FIRST_COMMIT_SHA, END_SHA],
        });
    });

    it('records no commits, skips commit listing, and releases the gate', async () => {
        const { manager, task } = startGatedTask();
        const captureHeadSha = vi.fn().mockResolvedValue(BASELINE_SHA);
        const listCommitShas = vi.fn();

        await executeImplementPlanWithPrGate({
            task,
            queueManager: manager,
            workingDirectory: '/repo/demo',
            execute: async () => completedResult(),
            captureHeadSha,
            listCommitShas,
        });

        expect(listCommitShas).not.toHaveBeenCalled();
        expect(manager.getRepoGate('repo-A')).toBeUndefined();
        expect(task.config.prGate).toMatchObject({
            baselineSha: BASELINE_SHA,
            endSha: BASELINE_SHA,
            commitShas: [],
            outcome: 'no-commits',
            reason: 'no commits produced',
        });
    });

    it('does not recapture the range for a same-chain follow-up task', async () => {
        const { manager } = startGatedTask();
        const followUpId = manager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat', mode: 'autopilot', workingDirectory: '/repo/demo' },
            config: { prGate: { autoMerge: true, chainId: 'chain-1' } },
            repoId: 'repo-A',
        });
        const followUp = manager.markStarted(followUpId)!;
        const captureHeadSha = vi.fn();
        const execute = vi.fn().mockResolvedValue(completedResult());

        await executeImplementPlanWithPrGate({
            task: followUp,
            queueManager: manager,
            workingDirectory: '/repo/demo',
            execute,
            captureHeadSha,
        });

        expect(execute).toHaveBeenCalledOnce();
        expect(captureHeadSha).not.toHaveBeenCalled();
    });
});
