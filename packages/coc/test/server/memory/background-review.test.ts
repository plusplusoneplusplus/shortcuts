import { describe, it, expect } from 'vitest';
import type { ConversationTurn } from '@plusplusoneplusplus/forge';
import {
    countUserTurns,
    buildReviewSnapshot,
    shouldEnqueueReview,
    isBackgroundReviewPayload,
    DEFAULT_REVIEW_CONFIG,
    MEMORY_REVIEW_PROMPT,
} from '../../../src/server/memory/background-review';

function makeTurn(overrides: Partial<ConversationTurn> & { role: 'user' | 'assistant'; content: string }): ConversationTurn {
    return {
        timestamp: new Date(),
        turnIndex: 0,
        timeline: [],
        ...overrides,
    };
}

describe('background-review', () => {
    // ── countUserTurns ──────────────────────────────────────────────

    describe('countUserTurns', () => {
        it('counts only user turns', () => {
            const turns = [
                { role: 'user' }, { role: 'assistant' }, { role: 'user' },
            ];
            expect(countUserTurns(turns)).toBe(2);
        });

        it('excludes streaming turns', () => {
            const turns = [
                { role: 'user' }, { role: 'user', streaming: true },
            ];
            expect(countUserTurns(turns)).toBe(1);
        });

        it('excludes historical turns', () => {
            const turns = [
                { role: 'user', historical: true }, { role: 'user' },
            ];
            expect(countUserTurns(turns)).toBe(1);
        });

        it('returns 0 for empty array', () => {
            expect(countUserTurns([])).toBe(0);
        });

        it('returns 0 when no user turns', () => {
            expect(countUserTurns([{ role: 'assistant' }])).toBe(0);
        });
    });

    // ── buildReviewSnapshot ─────────────────────────────────────────

    describe('buildReviewSnapshot', () => {
        it('strips streaming and historical turns', () => {
            const turns: ConversationTurn[] = [
                makeTurn({ role: 'user', content: 'hello', streaming: true }),
                makeTurn({ role: 'user', content: 'real user message' }),
                makeTurn({ role: 'assistant', content: 'response', historical: true }),
                makeTurn({ role: 'assistant', content: 'real response' }),
            ];
            const snapshot = buildReviewSnapshot(turns, 10);
            expect(snapshot).toEqual([
                { role: 'user', content: 'real user message' },
                { role: 'assistant', content: 'real response' },
            ]);
        });

        it('truncates long assistant messages at 4000 chars', () => {
            const longContent = 'x'.repeat(5000);
            const turns: ConversationTurn[] = [
                makeTurn({ role: 'user', content: 'hi' }),
                makeTurn({ role: 'assistant', content: longContent }),
            ];
            const snapshot = buildReviewSnapshot(turns, 10);
            expect(snapshot[1].content).toHaveLength(4000 + '… (truncated)'.length);
            expect(snapshot[1].content).toContain('… (truncated)');
        });

        it('does not truncate user messages', () => {
            const longContent = 'x'.repeat(5000);
            const turns: ConversationTurn[] = [
                makeTurn({ role: 'user', content: longContent }),
                makeTurn({ role: 'assistant', content: 'ok' }),
            ];
            const snapshot = buildReviewSnapshot(turns, 10);
            expect(snapshot[0].content).toBe(longContent);
        });

        it('respects maxTurns limit and keeps most recent', () => {
            const turns: ConversationTurn[] = Array.from({ length: 20 }, (_, i) =>
                makeTurn({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg ${i}`, turnIndex: i }),
            );
            const snapshot = buildReviewSnapshot(turns, 4);
            expect(snapshot).toHaveLength(4);
            expect(snapshot[0].content).toBe('msg 16');
            expect(snapshot[3].content).toBe('msg 19');
        });

        it('returns empty array for empty turns', () => {
            expect(buildReviewSnapshot([], 10)).toEqual([]);
        });

        it('handles single-turn conversation', () => {
            const turns: ConversationTurn[] = [
                makeTurn({ role: 'user', content: 'hello' }),
            ];
            const snapshot = buildReviewSnapshot(turns, 10);
            expect(snapshot).toEqual([{ role: 'user', content: 'hello' }]);
        });
    });

    // ── shouldEnqueueReview ─────────────────────────────────────────

    describe('shouldEnqueueReview', () => {
        it('returns null when under threshold', () => {
            const turns: ConversationTurn[] = [
                makeTurn({ role: 'user', content: 'hi' }),
                makeTurn({ role: 'assistant', content: 'hello' }),
            ];
            const result = shouldEnqueueReview('p1', 'ws1', turns, DEFAULT_REVIEW_CONFIG);
            expect(result).toBeNull();
        });

        it('returns payload when conditions met', () => {
            const turns: ConversationTurn[] = [];
            for (let i = 0; i < 8; i++) {
                turns.push(makeTurn({ role: 'user', content: `q${i}`, turnIndex: i * 2 }));
                turns.push(makeTurn({ role: 'assistant', content: `a${i}`, turnIndex: i * 2 + 1 }));
            }
            const result = shouldEnqueueReview('proc-123', 'ws-abc', turns, DEFAULT_REVIEW_CONFIG);
            expect(result).not.toBeNull();
            expect(result!.kind).toBe('background-review');
            expect(result!.sourceProcessId).toBe('proc-123');
            expect(result!.workspaceId).toBe('ws-abc');
            expect(result!.conversationSnapshot.length).toBeGreaterThanOrEqual(2);
        });

        it('respects custom minTurns', () => {
            const turns: ConversationTurn[] = [
                makeTurn({ role: 'user', content: 'q1' }),
                makeTurn({ role: 'assistant', content: 'a1' }),
                makeTurn({ role: 'user', content: 'q2' }),
                makeTurn({ role: 'assistant', content: 'a2' }),
            ];
            const config = { ...DEFAULT_REVIEW_CONFIG, minTurns: 2 };
            const result = shouldEnqueueReview('p1', 'ws1', turns, config);
            expect(result).not.toBeNull();
        });

        it('returns null when snapshot has fewer than 2 entries', () => {
            // 6+ user turns but all streaming — snapshot will be empty
            const turns: ConversationTurn[] = Array.from({ length: 7 }, () =>
                makeTurn({ role: 'user', content: 'x', streaming: true }),
            );
            // Add a non-streaming user turn to pass the turn count
            for (let i = 0; i < 7; i++) {
                turns.push(makeTurn({ role: 'user', content: `real${i}` }));
            }
            // But we need a snapshot < 2 entries — this won't happen with 7 real turns
            // So instead test with minTurns = 0 and only 1 non-streaming turn
            const smallTurns: ConversationTurn[] = [
                makeTurn({ role: 'user', content: 'hi' }),
            ];
            const config = { ...DEFAULT_REVIEW_CONFIG, minTurns: 0 };
            const result = shouldEnqueueReview('p1', 'ws1', smallTurns, config);
            expect(result).toBeNull();
        });

        it('includes timeoutMs from config', () => {
            const turns: ConversationTurn[] = [];
            for (let i = 0; i < 8; i++) {
                turns.push(makeTurn({ role: 'user', content: `q${i}`, turnIndex: i * 2 }));
                turns.push(makeTurn({ role: 'assistant', content: `a${i}`, turnIndex: i * 2 + 1 }));
            }
            const config = { ...DEFAULT_REVIEW_CONFIG, timeoutMs: 120_000 };
            const result = shouldEnqueueReview('p1', 'ws1', turns, config);
            expect(result!.timeoutMs).toBe(120_000);
        });
    });

    // ── isBackgroundReviewPayload ───────────────────────────────────

    describe('isBackgroundReviewPayload', () => {
        it('returns true for valid payload', () => {
            expect(isBackgroundReviewPayload({ kind: 'background-review' })).toBe(true);
        });

        it('returns false for other kinds', () => {
            expect(isBackgroundReviewPayload({ kind: 'chat' })).toBe(false);
            expect(isBackgroundReviewPayload({ kind: 'memory-aggregate' })).toBe(false);
            expect(isBackgroundReviewPayload({})).toBe(false);
        });
    });

    // ── Constants ───────────────────────────────────────────────────

    describe('MEMORY_REVIEW_PROMPT', () => {
        it('is a non-empty string', () => {
            expect(MEMORY_REVIEW_PROMPT.length).toBeGreaterThan(0);
        });
    });

    describe('DEFAULT_REVIEW_CONFIG', () => {
        it('has reasonable defaults', () => {
            expect(DEFAULT_REVIEW_CONFIG.minTurns).toBe(6);
            expect(DEFAULT_REVIEW_CONFIG.maxSnapshotTurns).toBe(80);
            expect(DEFAULT_REVIEW_CONFIG.timeoutMs).toBe(60_000);
            expect(DEFAULT_REVIEW_CONFIG.model).toBeUndefined();
        });
    });
});
