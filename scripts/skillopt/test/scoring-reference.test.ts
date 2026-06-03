/**
 * Tests: scoreRollout branching on task.judgeTarget (scoring.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../extract', () => ({
    extractStructuredOutput: vi.fn(),
}));
vi.mock('../reference-judge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../reference-judge')>();
    return { ...actual, referenceSimilarity: vi.fn() };
});
vi.mock('../cli-driver', () => ({
    runCopilotCli: vi.fn(),
}));

import { scoreRollout } from '../scoring';
import { extractStructuredOutput } from '../extract';
import { referenceSimilarity } from '../reference-judge';
import { runCopilotCli } from '../cli-driver';
import { Task } from '../corpus';
import { RolloutResult } from '../rollout';

const rollout: RolloutResult = {
    taskId: 't',
    stdout: 'Split into 2 commits: engine then integration.',
    diff: '',
    hiddenTestPassRate: 1.0,
    worktreeCleanedUp: true,
};

describe('scoreRollout — reference (stdout) path', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('uses the reference pipeline when judgeTarget="stdout"', async () => {
        vi.mocked(extractStructuredOutput).mockResolvedValue({ points: [{ id: 1, text: 'x' }] });
        vi.mocked(referenceSimilarity).mockResolvedValue({
            score: 0.8, pointF1: 0.9, holisticScore: 0.6,
            precision: 1, recall: 0.9, matched: 1, candidateCount: 1, idealCount: 1,
        });

        const task: Task = { id: 't', prompt: 'p', split: 'train', judgeTarget: 'stdout', idealOutput: 'ideal' };
        const res = await scoreRollout(task, rollout, 'm', '/tmp', { hiddenTestWeight: 0, llmJudgeWeight: 1 });

        expect(res.referenceScore).toBeCloseTo(0.8);
        expect(res.pointF1).toBeCloseTo(0.9);
        expect(res.holisticScore).toBeCloseTo(0.6);
        // With w1=0, w2=1 the blended score equals the reference score.
        expect(res.score).toBeCloseTo(0.8);
        // diff-path LLM judge must NOT be invoked.
        expect(runCopilotCli).not.toHaveBeenCalled();
        // ideal extracted once, candidate extracted once (1 sample).
        expect(extractStructuredOutput).toHaveBeenCalledTimes(2);
    });

    it('averages over judgeSamples for self-consistency', async () => {
        vi.mocked(extractStructuredOutput).mockResolvedValue({ points: [{ id: 1, text: 'x' }] });
        vi.mocked(referenceSimilarity)
            .mockResolvedValueOnce({ score: 0.4, pointF1: 0.4, holisticScore: 0.4, precision: 0, recall: 0, matched: 0, candidateCount: 1, idealCount: 1 })
            .mockResolvedValueOnce({ score: 0.8, pointF1: 0.8, holisticScore: 0.8, precision: 0, recall: 0, matched: 0, candidateCount: 1, idealCount: 1 });

        const task: Task = { id: 't', prompt: 'p', split: 'train', judgeTarget: 'stdout', idealOutput: 'ideal' };
        const res = await scoreRollout(task, rollout, 'm', '/tmp', { hiddenTestWeight: 0, llmJudgeWeight: 1 }, { judgeSamples: 2 });

        expect(referenceSimilarity).toHaveBeenCalledTimes(2);
        expect(res.referenceScore).toBeCloseTo(0.6); // (0.4 + 0.8) / 2
    });
});

describe('scoreRollout — diff path unchanged', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('uses the diff LLM judge when judgeTarget is absent', async () => {
        vi.mocked(runCopilotCli).mockResolvedValue({ stdout: '0.5', exitCode: 0, diff: '' });

        const task: Task = { id: 't', prompt: 'p', split: 'train', judgeRubric: 'good?' };
        const res = await scoreRollout(task, rollout, 'm', '/tmp');

        expect(res.referenceScore).toBeUndefined();
        expect(extractStructuredOutput).not.toHaveBeenCalled();
        expect(referenceSimilarity).not.toHaveBeenCalled();
        expect(runCopilotCli).toHaveBeenCalledTimes(1);
        expect(res.llmJudgeScore).toBeCloseTo(0.5);
    });
});
