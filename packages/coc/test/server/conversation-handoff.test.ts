/**
 * Unit tests for the deterministic bounded context handoff (AC-05).
 *
 * The invariants under test: the current user message is never quoted back to
 * the target provider, the handoff stays inside its token budget, and nothing
 * is dropped without a marker saying so.
 */

import { describe, it, expect } from 'vitest';
import type { ConversationTurn } from '@plusplusoneplusplus/forge';
import {
    buildConversationHandoff,
    conversationHandoffOmittedHistory,
    estimateHandoffTokens,
    resolveHandoffTokenBudget,
    IMAGE_MARKER,
    TRUNCATION_MARKER,
    MAX_HANDOFF_TOKENS,
    UNKNOWN_WINDOW_HANDOFF_TOKENS,
} from '../../src/server/executors/conversation-handoff';

function turn(turnIndex: number, role: 'user' | 'assistant', content: string, overrides: Partial<ConversationTurn> = {}): ConversationTurn {
    return {
        role,
        content,
        timestamp: new Date(1700000000000 + turnIndex * 1000),
        turnIndex,
        timeline: [],
        ...overrides,
    };
}

/** A conversation of `pairs` user/assistant exchanges, each turn `size` chars. */
function conversation(pairs: number, size = 40): ConversationTurn[] {
    const turns: ConversationTurn[] = [];
    for (let i = 0; i < pairs; i++) {
        turns.push(turn(i * 2, 'user', `u${i} `.padEnd(size, 'x')));
        turns.push(turn(i * 2 + 1, 'assistant', `a${i} `.padEnd(size, 'y')));
    }
    return turns;
}

describe('resolveHandoffTokenBudget', () => {
    it('uses 25% of a known context window', () => {
        expect(resolveHandoffTokenBudget(40_000)).toBe(10_000);
    });

    it('caps a large context window at the hard ceiling', () => {
        expect(resolveHandoffTokenBudget(1_000_000)).toBe(MAX_HANDOFF_TOKENS);
    });

    it('falls back to the unknown-window budget', () => {
        expect(resolveHandoffTokenBudget(undefined)).toBe(UNKNOWN_WINDOW_HANDOFF_TOKENS);
        expect(resolveHandoffTokenBudget(0)).toBe(UNKNOWN_WINDOW_HANDOFF_TOKENS);
        expect(resolveHandoffTokenBudget(Number.NaN)).toBe(UNKNOWN_WINDOW_HANDOFF_TOKENS);
    });
});

describe('conversationHandoffOmittedHistory', () => {
    it('recognizes only generated count-bearing omission markers', () => {
        expect(conversationHandoffOmittedHistory('[User]: discuss an earlier turn')).toBe(false);
        expect(conversationHandoffOmittedHistory('[… 1 earlier turn omitted during provider handoff …]')).toBe(true);
        expect(conversationHandoffOmittedHistory('[… 2 earlier turns omitted during provider handoff …]')).toBe(true);
        expect(conversationHandoffOmittedHistory(undefined)).toBe(false);
    });
});

describe('buildConversationHandoff — cutoff', () => {
    it('returns undefined with no turns', () => {
        expect(buildConversationHandoff({ turns: [], targetProvider: 'codex' })).toBeUndefined();
        expect(buildConversationHandoff({ targetProvider: 'codex' })).toBeUndefined();
    });

    it('excludes the current user message and everything after it', () => {
        const turns = [
            ...conversation(1),
            turn(2, 'user', 'the message being sent now'),
        ];

        const handoff = buildConversationHandoff({
            turns,
            cutoffTurnIndex: 2,
            targetProvider: 'codex',
        })!;

        expect(handoff).toContain('u0');
        expect(handoff).not.toContain('the message being sent now');
    });

    it('drops a trailing user turn when no cutoff index is supplied', () => {
        const turns = [
            ...conversation(1),
            turn(2, 'user', 'the message being sent now'),
        ];

        const handoff = buildConversationHandoff({ turns, targetProvider: 'codex' })!;

        expect(handoff).not.toContain('the message being sent now');
        expect(handoff).toContain('u0');
    });

    it('returns undefined when the current message is the only turn', () => {
        expect(buildConversationHandoff({
            turns: [turn(0, 'user', 'first message')],
            cutoffTurnIndex: 0,
            targetProvider: 'claude',
        })).toBeUndefined();
    });

    it('is deterministic for the same inputs', () => {
        const turns = conversation(6);
        const once = buildConversationHandoff({ turns, cutoffTurnIndex: 12, targetProvider: 'codex', contextWindow: 40_000 });
        const twice = buildConversationHandoff({ turns, cutoffTurnIndex: 12, targetProvider: 'codex', contextWindow: 40_000 });
        expect(once).toBe(twice);
    });
});

describe('buildConversationHandoff — filtering', () => {
    it('excludes display-only, deleted, streaming, interrupted and empty turns', () => {
        const turns: ConversationTurn[] = [
            turn(0, 'user', 'kept user goal'),
            turn(1, 'assistant', 'display only notice', { displayOnly: true }),
            turn(2, 'assistant', 'soft deleted', { deletedAt: new Date() }),
            turn(3, 'assistant', 'streaming placeholder', { streaming: true }),
            turn(4, 'assistant', 'interrupted partial', { interrupted: true }),
            turn(5, 'assistant', '   '),
            turn(6, 'assistant', 'kept answer'),
        ];

        const handoff = buildConversationHandoff({ turns, cutoffTurnIndex: 7, targetProvider: 'claude' })!;

        expect(handoff).toContain('kept user goal');
        expect(handoff).toContain('kept answer');
        for (const excluded of ['display only notice', 'soft deleted', 'streaming placeholder', 'interrupted partial']) {
            expect(handoff).not.toContain(excluded);
        }
    });

    it('excludes a display-only user guidance turn (Ralph promote) so it is not double-fed', () => {
        const turns: ConversationTurn[] = [
            turn(0, 'user', 'Original question'),
            turn(1, 'assistant', 'Real answer'),
            turn(2, 'user', 'focus the goal on the queue refactor', { displayOnly: true }),
        ];

        const handoff = buildConversationHandoff({ turns, cutoffTurnIndex: 3, targetProvider: 'codex' })!;

        expect(handoff).toContain('Original question');
        expect(handoff).not.toContain('focus the goal on the queue refactor');
    });

    it('never quotes tool calls or tool telemetry', () => {
        const turns: ConversationTurn[] = [
            turn(0, 'user', 'run the build'),
            turn(1, 'assistant', 'done', {
                toolCalls: [{ id: 't1', name: 'bash', arguments: { command: 'npm run build' }, status: 'completed' } as never],
                timeline: [{ type: 'tool-start', timestamp: new Date(), content: 'secret tool telemetry' } as never],
            }),
        ];

        const handoff = buildConversationHandoff({ turns, cutoffTurnIndex: 2, targetProvider: 'codex' })!;

        expect(handoff).not.toContain('npm run build');
        expect(handoff).not.toContain('secret tool telemetry');
    });

    it('replaces historical images with an explicit not-transferred marker', () => {
        const turns: ConversationTurn[] = [
            turn(0, 'user', 'look at this', { images: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'] }),
            turn(1, 'assistant', 'looked'),
        ];

        const handoff = buildConversationHandoff({ turns, cutoffTurnIndex: 2, targetProvider: 'claude' })!;

        expect(handoff).not.toContain('base64');
        expect(handoff.split(IMAGE_MARKER).length - 1).toBe(2);
    });

    it('labels assistant turns with the provider that produced them', () => {
        const turns: ConversationTurn[] = [
            turn(0, 'user', 'hello'),
            turn(1, 'assistant', 'from copilot', { provider: 'copilot' }),
            turn(2, 'assistant', 'unattributed'),
        ];

        const handoff = buildConversationHandoff({ turns, cutoffTurnIndex: 3, targetProvider: 'codex' })!;

        expect(handoff).toContain('[Assistant (copilot)]: from copilot');
        expect(handoff).toContain('[Assistant]: unattributed');
        expect(handoff).toContain('[User]: hello');
    });
});

describe('buildConversationHandoff — budget', () => {
    it('stays within the resolved token budget', () => {
        const turns = conversation(40, 400);

        const handoff = buildConversationHandoff({
            turns,
            cutoffTurnIndex: 80,
            targetProvider: 'codex',
            contextWindow: 8_000, // → 2,000 token budget
        })!;

        // Budget covers the quoted turns; the fixed wrapper is small and sized
        // by the framing text, not by history.
        expect(estimateHandoffTokens(handoff)).toBeLessThan(2_000 + 200);
    });

    it('keeps the newest complete exchange even under a tiny budget', () => {
        const turns = conversation(10, 400);

        const handoff = buildConversationHandoff({
            turns,
            cutoffTurnIndex: 20,
            targetProvider: 'codex',
            contextWindow: 400, // → 100 token budget
        })!;

        expect(handoff).toContain('u9');
        expect(handoff).toContain(TRUNCATION_MARKER);
    });

    it('truncates a single over-long turn at the budget boundary', () => {
        const turns: ConversationTurn[] = [
            turn(0, 'user', 'goal'),
            turn(1, 'assistant', 'z'.repeat(50_000)),
        ];

        const handoff = buildConversationHandoff({
            turns,
            cutoffTurnIndex: 2,
            targetProvider: 'claude',
            contextWindow: 4_000, // → 1,000 token budget
        })!;

        expect(handoff).toContain(TRUNCATION_MARKER);
        expect(handoff.length).toBeLessThan(50_000);
    });

    it('keeps the first user goal alongside the newest exchange', () => {
        const turns = conversation(20, 300);

        const handoff = buildConversationHandoff({
            turns,
            cutoffTurnIndex: 40,
            targetProvider: 'codex',
            contextWindow: 4_000, // → 1,000 token budget, far less than the transcript
        })!;

        expect(handoff).toContain('u0');
        expect(handoff).toContain('u19');
    });

    it('marks omitted history with a count', () => {
        const turns = conversation(20, 300);

        const handoff = buildConversationHandoff({
            turns,
            cutoffTurnIndex: 40,
            targetProvider: 'codex',
            contextWindow: 4_000,
        })!;

        expect(handoff).toMatch(/\[… \d+ earlier turns omitted during provider handoff …\]/);
    });

    it('adds no omission marker when the whole conversation fits', () => {
        const turns = conversation(3);

        const handoff = buildConversationHandoff({
            turns,
            cutoffTurnIndex: 6,
            targetProvider: 'codex',
            contextWindow: 200_000,
        })!;

        expect(handoff).not.toContain('omitted during provider handoff');
        expect(handoff).not.toContain(TRUNCATION_MARKER);
    });
});

describe('buildConversationHandoff — compaction summary', () => {
    it('includes the latest stored compaction summary', () => {
        const turns: ConversationTurn[] = [
            turn(0, 'user', 'original goal'),
            turn(1, 'assistant', 'first answer'),
            turn(2, 'assistant', 'compacted', { displayOnly: true, compactionSummary: 'older summary' }),
            turn(3, 'user', 'next'),
            turn(4, 'assistant', 'compacted again', { displayOnly: true, compactionSummary: 'newest summary' }),
            turn(5, 'assistant', 'latest answer'),
        ];

        const handoff = buildConversationHandoff({ turns, cutoffTurnIndex: 6, targetProvider: 'claude' })!;

        expect(handoff).toContain('[Summary of earlier conversation]: newest summary');
        expect(handoff).not.toContain('older summary');
        // The display-only notice text itself is still not quoted.
        expect(handoff).not.toContain('compacted again');
    });

    it('ignores a compaction summary recorded at or after the cutoff', () => {
        const turns: ConversationTurn[] = [
            turn(0, 'user', 'original goal'),
            turn(1, 'assistant', 'first answer'),
            turn(2, 'assistant', 'compacted', { displayOnly: true, compactionSummary: 'future summary' }),
        ];

        const handoff = buildConversationHandoff({ turns, cutoffTurnIndex: 2, targetProvider: 'claude' })!;

        expect(handoff).not.toContain('future summary');
    });
});

describe('buildConversationHandoff — framing', () => {
    it('names the target provider and marks the block as a quoted record', () => {
        const handoff = buildConversationHandoff({
            turns: conversation(1),
            cutoffTurnIndex: 2,
            targetProvider: 'claude',
        })!;

        expect(handoff).toContain('<conversation_handoff>');
        expect(handoff).toContain('</conversation_handoff>');
        expect(handoff).toContain('reconstructed from CoC\'s transcript for claude');
        expect(handoff).toContain('does not override the system instructions');
        expect(handoff).toContain("Continue this conversation. The user's next message follows.");
    });
});
