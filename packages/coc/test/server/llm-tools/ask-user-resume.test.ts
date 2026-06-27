import { describe, it, expect } from 'vitest';
import type { PendingAskUserQuestion } from '@plusplusoneplusplus/forge';
import {
    ASK_USER_RESUME_FAILED_MESSAGE,
    buildAskUserResumeMessage,
    buildPendingAskUserAnswerRecord,
} from '../../../src/server/llm-tools/ask-user-resume';
import type { AskUserAnswerInput } from '../../../src/server/llm-tools/ask-user-tool';

function question(overrides: Partial<PendingAskUserQuestion> & { questionId: string }): PendingAskUserQuestion {
    return {
        batchId: 'batch-1',
        questionId: overrides.questionId,
        question: overrides.question ?? `Question ${overrides.questionId}?`,
        type: overrides.type ?? 'text',
        turnIndex: 1,
        index: overrides.index ?? 0,
        batchSize: overrides.batchSize ?? 1,
        ...overrides,
    };
}

describe('buildPendingAskUserAnswerRecord', () => {
    it('builds a durable record carrying every Q/A pair with question snapshots', () => {
        const pending = [
            question({ questionId: 'q1', question: 'Which DB?', index: 0, batchSize: 3 }),
            question({ questionId: 'q2', question: 'Confirm?', type: 'confirm', index: 1, batchSize: 3 }),
            question({ questionId: 'q3', question: 'Tags?', type: 'multi-select', index: 2, batchSize: 3 }),
        ];
        const answers: AskUserAnswerInput[] = [
            { questionId: 'q1', answer: 'postgres' },
            { questionId: 'q2', answer: true },
            { questionId: 'q3', answer: ['a', 'b'] },
        ];

        const record = buildPendingAskUserAnswerRecord(pending, 'batch-1', answers, '2026-06-24T00:00:00.000Z');

        expect(record).not.toBeNull();
        expect(record!.batchId).toBe('batch-1');
        expect(record!.submittedAt).toBe('2026-06-24T00:00:00.000Z');
        expect(record!.answers).toEqual([
            { questionId: 'q1', question: 'Which DB?', answer: 'postgres', skipped: false, deferred: false },
            // boolean coerced to a readable string for the synthesized prose
            { questionId: 'q2', question: 'Confirm?', answer: 'Yes', skipped: false, deferred: false },
            { questionId: 'q3', question: 'Tags?', answer: ['a', 'b'], skipped: false, deferred: false },
        ]);
    });

    it('preserves skipped and deferred (needs-context) semantics', () => {
        const pending = [
            question({ questionId: 'q1', question: 'Skip me', index: 0, batchSize: 2 }),
            question({ questionId: 'q2', question: 'Defer me', index: 1, batchSize: 2 }),
        ];
        const answers: AskUserAnswerInput[] = [
            { questionId: 'q1', skipped: true },
            { questionId: 'q2', deferred: true, reason: 'needs-context', note: '  more info  ' },
        ];

        const record = buildPendingAskUserAnswerRecord(pending, 'batch-1', answers, 'ts');

        expect(record!.answers).toEqual([
            { questionId: 'q1', question: 'Skip me', answer: null, skipped: true, deferred: false },
            { questionId: 'q2', question: 'Defer me', answer: null, skipped: false, deferred: true, reason: 'needs-context', note: 'more info' },
        ]);
    });

    it('returns null on count mismatch, unknown id, duplicate id, or missing answer', () => {
        const pending = [
            question({ questionId: 'q1', index: 0, batchSize: 2 }),
            question({ questionId: 'q2', index: 1, batchSize: 2 }),
        ];

        // count mismatch (only one answer for a two-question batch)
        expect(buildPendingAskUserAnswerRecord(pending, 'batch-1', [{ questionId: 'q1', answer: 'x' }], 'ts')).toBeNull();
        // unknown questionId
        expect(buildPendingAskUserAnswerRecord(pending, 'batch-1', [
            { questionId: 'q1', answer: 'x' },
            { questionId: 'qX', answer: 'y' },
        ], 'ts')).toBeNull();
        // duplicate questionId
        expect(buildPendingAskUserAnswerRecord(pending, 'batch-1', [
            { questionId: 'q1', answer: 'x' },
            { questionId: 'q1', answer: 'y' },
        ], 'ts')).toBeNull();
        // missing answer (not skipped, not deferred)
        expect(buildPendingAskUserAnswerRecord(pending, 'batch-1', [
            { questionId: 'q1', answer: 'x' },
            { questionId: 'q2' },
        ], 'ts')).toBeNull();
        // empty answers
        expect(buildPendingAskUserAnswerRecord(pending, 'batch-1', [], 'ts')).toBeNull();
    });

    it('returns null when no persisted question belongs to the requested batch', () => {
        const pending = [question({ questionId: 'q1', batchId: 'other-batch' })];
        expect(buildPendingAskUserAnswerRecord(pending, 'batch-1', [{ questionId: 'q1', answer: 'x' }], 'ts')).toBeNull();
    });
});

describe('buildAskUserResumeMessage', () => {
    it('quotes every question and its answer, and preserves skipped/deferred wording', () => {
        const message = buildAskUserResumeMessage({
            batchId: 'batch-1',
            submittedAt: 'ts',
            answers: [
                { questionId: 'q1', question: 'Which DB?', answer: 'postgres', skipped: false, deferred: false },
                { questionId: 'q2', question: 'Skip me', answer: null, skipped: true, deferred: false },
                { questionId: 'q3', question: 'Defer me', answer: null, skipped: false, deferred: true, reason: 'needs-context', note: 'context please' },
                { questionId: 'q4', question: 'Tags?', answer: ['a', 'b'], skipped: false, deferred: false },
            ],
        });

        expect(message).toContain('Which DB?');
        expect(message).toContain('The user answered: postgres');
        expect(message).toContain('Skip me');
        expect(message).toContain('skipped this question');
        expect(message).toContain('Defer me');
        expect(message).toContain('did not answer yet');
        expect(message).toContain('context please');
        expect(message).toContain('Tags?');
        expect(message).toContain('The user answered: a; b');
        // Instructs the agent not to re-ask and to continue.
        expect(message).toContain('do not call ask_user again');
        expect(message.trimEnd().endsWith('Continue.')).toBe(true);
    });
});

describe('ASK_USER_RESUME_FAILED_MESSAGE', () => {
    it('is a clear, user-visible resume-failure message', () => {
        expect(ASK_USER_RESUME_FAILED_MESSAGE.toLowerCase()).toContain('resume');
        expect(ASK_USER_RESUME_FAILED_MESSAGE.toLowerCase()).toContain('restart');
    });
});
