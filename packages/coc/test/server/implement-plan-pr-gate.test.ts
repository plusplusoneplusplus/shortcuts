import { describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, type QueuedTask, type TaskExecutionResult } from '@plusplusoneplusplus/forge';
import { executeImplementPlanWithPrGate } from '../../src/server/queue/implement-plan-pr-gate';
import {
    buildImplementPlanPrSubmitPrompt,
    parseImplementPlanPrSubmitResult,
} from '../../src/server/queue/implement-plan-pr-submit';
import { createMockProcessStore } from '../helpers/mock-process-store';

const BASELINE_SHA = 'a'.repeat(40);
const FIRST_COMMIT_SHA = 'b'.repeat(40);
const END_SHA = 'c'.repeat(40);

function startGatedTask(): { manager: TaskQueueManager; task: QueuedTask } {
    const manager = new TaskQueueManager({ getTaskRepoId: task => task.repoId });
    const taskId = manager.enqueue({
        type: 'chat',
        priority: 'normal',
        payload: {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Implement /repo/demo.plan.md',
            context: { files: ['/repo/demo.plan.md'] },
            provider: 'claude',
            model: 'claude-sonnet',
            reasoningEffort: 'high',
            workingDirectory: '/repo/demo',
            workspaceId: 'repo-A',
        },
        config: {
            reasoningEffort: 'high',
            prGate: { autoMerge: true, chainId: 'chain-1' },
        },
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
            implementProcessId: `queue_${task.id}`,
            outcome: 'commits-recorded',
            submissionStatus: 'pending',
        });
        expect(task.config.prGate).toMatchObject({
            baselineSha: BASELINE_SHA,
            endSha: END_SHA,
            commitShas: [FIRST_COMMIT_SHA, END_SHA],
            implementProcessId: `queue_${task.id}`,
        });
        expect(manager.getQueued()).toEqual([
            expect.objectContaining({
                repoId: 'repo-A',
                displayName: 'Submit implementation PR',
                payload: expect.objectContaining({
                    mode: 'autopilot',
                    provider: 'claude',
                    model: 'claude-sonnet',
                    reasoningEffort: 'high',
                    workingDirectory: '/repo/demo',
                    workspaceId: 'repo-A',
                    prompt: expect.stringContaining('Read the implementation plan at: /repo/demo.plan.md'),
                }),
                config: expect.objectContaining({
                    reasoningEffort: 'high',
                    prGate: expect.objectContaining({
                        chainId: 'chain-1',
                        taskKind: 'pr-submit',
                        commitShas: [FIRST_COMMIT_SHA, END_SHA],
                    }),
                }),
            }),
        ]);
        expect(manager.getRepoGate('repo-A')).toMatchObject({ submissionStatus: 'pending' });
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

    it('keeps and pauses the gate with the reported reason when PR submission fails', async () => {
        const { manager, task } = startGatedTask();
        manager.recordRepoGateBaseline('repo-A', 'chain-1', task.id, BASELINE_SHA);
        manager.recordRepoGateCompletion('repo-A', 'chain-1', task.id, {
            endSha: END_SHA,
            commitShas: [END_SHA],
            outcome: 'commits-recorded',
        });

        const followUpId = manager.enqueue({
            type: 'chat',
            priority: 'normal',
            repoId: 'repo-A',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'submit', workingDirectory: '/repo/demo' },
            config: { prGate: { autoMerge: true, chainId: 'chain-1', taskKind: 'pr-submit' } },
        });
        const followUp = manager.markStarted(followUpId)!;

        await executeImplementPlanWithPrGate({
            task: followUp,
            queueManager: manager,
            execute: async () => ({
                success: true,
                result: {
                    response: 'PR_SUBMIT_RESULT\n```json\n{"status":"failed","error":"checks unavailable"}\n```',
                },
                durationMs: 1,
            }),
        });

        expect(manager.getRepoGate('repo-A')).toMatchObject({
            chainId: 'chain-1',
            submissionStatus: 'failed',
            reason: 'checks unavailable',
        });
        expect(manager.isRepoPaused('repo-A')).toBe(true);
        expect(manager.getPauseReason('repo-A')?.displayName).toContain('checks unavailable');
    });

    it('records a submitted PR on the target implementation process', async () => {
        const { manager, task } = startGatedTask();
        const processId = `queue_${task.id}`;
        const processStore = createMockProcessStore({
            initialProcesses: [{
                id: processId,
                type: 'chat',
                status: 'completed',
                startTime: new Date(),
                metadata: { type: 'chat' },
            } as any],
        });
        manager.recordRepoGateBaseline('repo-A', 'chain-1', task.id, BASELINE_SHA);
        manager.recordRepoGateCompletion('repo-A', 'chain-1', task.id, {
            endSha: END_SHA,
            commitShas: [END_SHA],
            implementProcessId: processId,
            outcome: 'commits-recorded',
        });
        const followUpId = manager.enqueue({
            type: 'chat',
            priority: 'normal',
            repoId: 'repo-A',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'submit' },
            config: { prGate: { autoMerge: true, chainId: 'chain-1', taskKind: 'pr-submit' } },
        });

        await executeImplementPlanWithPrGate({
            task: manager.markStarted(followUpId)!,
            queueManager: manager,
            processStore,
            execute: async () => ({
                success: true,
                result: {
                    response: 'PR_SUBMIT_RESULT\n```json\n{"status":"submitted","prUrl":"https://github.com/acme/repo/pull/7","prNumber":7,"commitShas":[]}\n```',
                },
                durationMs: 1,
            }),
        });

        expect(processStore.processes.get(processId)?.metadata?.implementationPr).toEqual({
            chainId: 'chain-1',
            prUrl: 'https://github.com/acme/repo/pull/7',
            prNumber: 7,
            prState: 'open',
        });
    });

    describe('implement-plan PR submit contract', () => {
        it('names the exact commits and mandates safe worktree auto-merge without the submit skill', () => {
            const shas = ['1'.repeat(40), '2'.repeat(40), '3'.repeat(40)];
            const prompt = buildImplementPlanPrSubmitPrompt({
                baselineSha: BASELINE_SHA,
                endSha: END_SHA,
                commitShas: shas,
                planReference: 'Read the plan at /repo/feature.plan.md',
            });

            for (const sha of shas) expect(prompt).toContain(`- ${sha}`);
            expect(prompt).toContain('temporary linked git worktree');
            expect(prompt).toContain('Never change the branch or HEAD of the active worktree');
            expect(prompt).toContain('gh pr merge --auto --squash');
            expect(prompt).toContain('Do not invoke or use the `submit-commits-as-pr` skill');
            expect(prompt).not.toContain('buildRalphSubmitPrompt');
            expect(prompt).not.toContain('..HEAD');
        });

        it('parses a valid result and treats submitted without prUrl as failed', () => {
            expect(parseImplementPlanPrSubmitResult(
                'PR_SUBMIT_RESULT\n```json\n{"status":"submitted","prUrl":"https://github.com/acme/repo/pull/7","prNumber":7,"commitShas":["abc"]}\n```',
            )).toEqual({
                status: 'submitted',
                prUrl: 'https://github.com/acme/repo/pull/7',
                prNumber: 7,
                commitShas: ['abc'],
            });
            expect(parseImplementPlanPrSubmitResult(
                'PR_SUBMIT_RESULT\n```json\n{"status":"submitted","prNumber":7}\n```',
            )).toEqual({
                status: 'failed',
                error: 'Submitted result is missing prUrl',
            });
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
