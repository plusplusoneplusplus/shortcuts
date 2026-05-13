/**
 * Tests for hydrateAskUserBatch — pure logic that mirrors persisted
 * `processDetails.pendingAskUser` onto the in-memory `AskUserBatch` shape
 * consumed by `AskUserInline`.
 */

import { describe, it, expect } from 'vitest';
import { hydrateAskUserBatch } from '../../../../../src/server/spa/client/react/features/chat/hooks/hydrateAskUserBatch';
import type { AskUserBatch, AskUserQuestion } from '../../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE';

const q = (overrides: Partial<AskUserQuestion> = {}): AskUserQuestion => ({
    batchId: 'batch-1',
    questionId: 'q-1',
    question: 'Pick one',
    type: 'select',
    options: [{ value: 'a', label: 'A' }],
    turnIndex: 1,
    index: 0,
    batchSize: 1,
    ...overrides,
});

describe('hydrateAskUserBatch', () => {
    it('returns null when the persisted list is undefined', () => {
        expect(hydrateAskUserBatch(undefined, null)).toBeNull();
    });

    it('returns null when the persisted list is empty', () => {
        expect(hydrateAskUserBatch([], null)).toBeNull();
    });

    it('returns null when persisted is empty even if a current batch exists (executor cleared)', () => {
        const current: AskUserBatch = { batchId: 'batch-1', questions: [q()] };
        expect(hydrateAskUserBatch(undefined, current)).toBeNull();
        expect(hydrateAskUserBatch([], current)).toBeNull();
    });

    it('builds a batch from persisted questions when none is cached', () => {
        const persisted = [q({ index: 0, questionId: 'a' }), q({ index: 1, questionId: 'b', batchSize: 2 })];
        const result = hydrateAskUserBatch(persisted, null);
        expect(result).not.toBeNull();
        expect(result!.batchId).toBe('batch-1');
        expect(result!.questions.map(x => x.questionId)).toEqual(['a', 'b']);
    });

    it('sorts questions by index when constructing a fresh batch', () => {
        const persisted = [
            q({ index: 2, questionId: 'c', batchSize: 3 }),
            q({ index: 0, questionId: 'a', batchSize: 3 }),
            q({ index: 1, questionId: 'b', batchSize: 3 }),
        ];
        const result = hydrateAskUserBatch(persisted, null);
        expect(result!.questions.map(x => x.index)).toEqual([0, 1, 2]);
        expect(result!.questions.map(x => x.questionId)).toEqual(['a', 'b', 'c']);
    });

    it('preserves the current batch reference when batchId is unchanged (no clobber of live SSE batch)', () => {
        const current: AskUserBatch = { batchId: 'batch-live', questions: [q({ batchId: 'batch-live' })] };
        const persisted = [q({ batchId: 'batch-live' })];
        const result = hydrateAskUserBatch(persisted, current);
        expect(result).toBe(current);
    });

    it('replaces the current batch when the persisted batchId is different', () => {
        const current: AskUserBatch = { batchId: 'old', questions: [q({ batchId: 'old' })] };
        const persisted = [q({ batchId: 'new', questionId: 'fresh' })];
        const result = hydrateAskUserBatch(persisted, current);
        expect(result).not.toBe(current);
        expect(result!.batchId).toBe('new');
        expect(result!.questions[0].questionId).toBe('fresh');
    });
});
