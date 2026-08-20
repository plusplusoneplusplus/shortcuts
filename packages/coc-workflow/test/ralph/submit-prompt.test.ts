import { describe, expect, it } from 'vitest';
import { buildRalphSubmitPrompt, type BuildRalphSubmitPromptInput } from '../../src/ralph';

const BASE_INPUT: BuildRalphSubmitPromptInput = {
    originalGoal: 'Add a submit-pr button to the Ralph pane.',
    progressPath: '/data/ralph-sessions/sess-01/progress.md',
    sessionId: 'sess-01',
    submitIndex: 1,
    sessionStartedAt: '2026-08-01T10:00:00.000Z',
};

describe('buildRalphSubmitPrompt', () => {
    it('instructs the agent to invoke the submit-commits-as-pr skill with an explicit SHA list', () => {
        const prompt = buildRalphSubmitPrompt(BASE_INPUT);

        expect(prompt).toContain('`submit-commits-as-pr` skill');
        expect(prompt).toContain('comma-separated list of commit SHAs');
    });

    it('uses the baselineSha..HEAD strategy when a baseline SHA is recorded', () => {
        const prompt = buildRalphSubmitPrompt({ ...BASE_INPUT, baselineSha: 'abc1234' });

        expect(prompt).toContain('abc1234..HEAD');
        // Must not fall back to the legacy time-window strategy.
        expect(prompt).not.toContain('no recorded baseline SHA');
    });

    it('falls back to the time-window + progress.md strategy for legacy sessions', () => {
        const prompt = buildRalphSubmitPrompt({
            ...BASE_INPUT,
            sessionCompletedAt: '2026-08-02T12:00:00.000Z',
        });

        expect(prompt).toContain('no recorded baseline SHA');
        expect(prompt).toContain('2026-08-01T10:00:00.000Z');
        expect(prompt).toContain('2026-08-02T12:00:00.000Z');
        expect(prompt).toContain('cross-check');
        expect(prompt).toContain('note any mismatches');
        expect(prompt).not.toContain('..HEAD');
    });

    it('uses "now" as the window end when the legacy session has no completedAt', () => {
        const prompt = buildRalphSubmitPrompt(BASE_INPUT);

        expect(prompt).toContain(`between ${BASE_INPUT.sessionStartedAt} and now`);
    });

    it('scopes the submit to all loops of the session including gap-fix loops', () => {
        const prompt = buildRalphSubmitPrompt(BASE_INPUT);

        expect(prompt).toContain('ALL loops');
        expect(prompt).toContain('gap-fix loops');
        expect(prompt).toContain('not just the latest loop');
    });

    it('directs PR title/body from the goal plus progress summary, auto-merge on, not draft', () => {
        const prompt = buildRalphSubmitPrompt(BASE_INPUT);

        expect(prompt).toContain('PR title and body from the Ralph goal');
        expect(prompt).toContain('progress journal');
        expect(prompt).toContain('auto-merge ON');
        expect(prompt).toContain('Do not open the PR as a draft');
    });

    it('forbids resolving conflicts and covers the dirty-worktree refusal', () => {
        const prompt = buildRalphSubmitPrompt(BASE_INPUT);

        expect(prompt).toContain('Do NOT attempt to resolve conflicts');
        expect(prompt).toContain('aborts the entire submit');
        expect(prompt).toContain('worktree is dirty');
    });

    it('includes the RALPH_SUBMIT_RESULT contract with both statuses', () => {
        const prompt = buildRalphSubmitPrompt(BASE_INPUT);

        expect(prompt).toContain('RALPH_SUBMIT_RESULT');
        expect(prompt).toContain('"status": "submitted" | "failed"');
        expect(prompt).toContain('"prUrl"');
        expect(prompt).toContain('"commitShas"');
        expect(prompt).toContain('"error"');
    });

    it('embeds the goal, session id, submit index, and progress path', () => {
        const prompt = buildRalphSubmitPrompt({ ...BASE_INPUT, submitIndex: 3 });

        expect(prompt).toContain(BASE_INPUT.originalGoal);
        expect(prompt).toContain('sess-01');
        expect(prompt).toContain('PR submit 3');
        expect(prompt).toContain(BASE_INPUT.progressPath);
    });

    it('references a goal path instead of inlining when the goal is a file path', () => {
        const prompt = buildRalphSubmitPrompt({ ...BASE_INPUT, originalGoal: '/specs/goal.md' });

        expect(prompt).toContain('Read the original goal from: /specs/goal.md');
    });
});
