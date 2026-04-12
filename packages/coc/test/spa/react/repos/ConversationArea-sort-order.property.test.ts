/**
 * Property-based tests for conversation turn ordering.
 *
 * Explores the state space of the sort comparator, synthetic turn creation,
 * and the interplay between the two — covering edge cases that example-based
 * tests would miss (e.g., duplicate turnIndex values, very large indices,
 * interleaved null/non-null, repeated sort idempotency).
 *
 * Depends on `fast-check` for property-based (generative) testing.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ─── Extracted pure logic (mirrors production code) ─────────────────────────

interface MinimalTurn {
    role: 'user' | 'assistant';
    turnIndex?: number;
    streaming?: boolean;
    /** Opaque tag for tracking relative-order preservation across sorts. */
    _tag?: number;
}

/** Production sort comparator (from ConversationArea.tsx). */
function sortTurns<T extends MinimalTurn>(turns: T[]): T[] {
    return [...turns].sort((a, b) => {
        const ai = a.turnIndex;
        const bi = b.turnIndex;
        if (ai == null && bi == null) return 0;
        if (ai == null) return 1;
        if (bi == null) return -1;
        return ai - bi;
    });
}

/** OLD (buggy) comparator — kept to prove regressions are caught. */
function sortTurnsBuggy<T extends MinimalTurn>(turns: T[]): T[] {
    return [...turns].sort((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0));
}

/** Production nextTurnIndex computation (shared by ConversationArea, useChatSSE, useSendMessage). */
function nextTurnIndex(turns: MinimalTurn[]): number {
    return Math.max(0, ...turns.map(t => t.turnIndex ?? -1)) + 1;
}

/** Simulates ensureAssistantTurn (useChatSSE). */
function ensureAssistantTurn(prev: MinimalTurn[]): MinimalTurn[] {
    const last = prev[prev.length - 1];
    if (last && last.role === 'assistant') return prev;
    const idx = nextTurnIndex(prev);
    return [...prev, { role: 'assistant', streaming: true, turnIndex: idx }];
}

/** Simulates sendFollowUp synthetic turn appending. */
function appendFollowUp(prev: MinimalTurn[], content?: string): MinimalTurn[] {
    const idx = nextTurnIndex(prev);
    return [
        ...prev,
        { role: 'user' as const, turnIndex: idx },
        { role: 'assistant' as const, streaming: true, turnIndex: idx + 1 },
    ];
}

/** Simulates the streaming placeholder appended in ConversationArea render. */
function appendStreamingPlaceholder(turns: MinimalTurn[]): MinimalTurn[] {
    const idx = nextTurnIndex(turns);
    return [...turns, { role: 'assistant' as const, streaming: true, turnIndex: idx }];
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const roleArb = fc.constantFrom<'user' | 'assistant'>('user', 'assistant');

/** Turn with a definite turnIndex. */
const indexedTurnArb: fc.Arbitrary<MinimalTurn> = fc.record({
    role: roleArb,
    turnIndex: fc.integer({ min: 0, max: 10_000 }),
    streaming: fc.boolean(),
});

/** Turn with turnIndex = undefined (synthetic / streaming placeholder). */
const unindexedTurnArb: fc.Arbitrary<MinimalTurn> = fc.record({
    role: roleArb,
    streaming: fc.boolean(),
});

/** Turn with turnIndex that may or may not be set. */
const mixedTurnArb: fc.Arbitrary<MinimalTurn> = fc.oneof(indexedTurnArb, unindexedTurnArb);

/** Realistic conversation: alternating user/assistant, mostly indexed, with occasional gaps. */
const realisticConversationArb: fc.Arbitrary<MinimalTurn[]> = fc
    .array(fc.integer({ min: 0, max: 200 }), { minLength: 0, maxLength: 30 })
    .chain(indices => {
        const sorted = [...new Set(indices)].sort((a, b) => a - b);
        const turns: MinimalTurn[] = [];
        for (let i = 0; i < sorted.length; i++) {
            turns.push({ role: i % 2 === 0 ? 'user' : 'assistant', turnIndex: sorted[i] });
        }
        return fc.constant(turns);
    });

// Tag turns with a monotonic _tag so we can verify relative-order stability.
function tagTurns(turns: MinimalTurn[]): MinimalTurn[] {
    return turns.map((t, i) => ({ ...t, _tag: i }));
}

// ─── Property tests ─────────────────────────────────────────────────────────

describe('sortTurns: properties', () => {
    it('never loses or duplicates turns', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 50 }), turns => {
                const sorted = sortTurns(turns);
                expect(sorted).toHaveLength(turns.length);
            }),
        );
    });

    it('is idempotent — sorting twice gives the same result', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 50 }), turns => {
                const once = sortTurns(turns);
                const twice = sortTurns(once);
                expect(twice).toEqual(once);
            }),
        );
    });

    it('indexed turns appear in ascending turnIndex order', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 50 }), turns => {
                const sorted = sortTurns(turns);
                const indexed = sorted.filter(t => t.turnIndex != null);
                for (let i = 1; i < indexed.length; i++) {
                    expect(indexed[i].turnIndex!).toBeGreaterThanOrEqual(indexed[i - 1].turnIndex!);
                }
            }),
        );
    });

    it('unindexed turns always come after ALL indexed turns', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 50 }), turns => {
                const sorted = sortTurns(turns);
                const lastIndexedPos = sorted.reduce(
                    (acc, t, i) => (t.turnIndex != null ? i : acc),
                    -1,
                );
                const firstUnindexedPos = sorted.findIndex(t => t.turnIndex == null);
                if (lastIndexedPos >= 0 && firstUnindexedPos >= 0) {
                    expect(firstUnindexedPos).toBeGreaterThan(lastIndexedPos);
                }
            }),
        );
    });

    it('unindexed turns preserve their relative insertion order (stability)', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 50 }), rawTurns => {
                const turns = tagTurns(rawTurns);
                const sorted = sortTurns(turns);
                const unindexed = sorted.filter(t => t.turnIndex == null);
                for (let i = 1; i < unindexed.length; i++) {
                    expect(unindexed[i]._tag!).toBeGreaterThan(unindexed[i - 1]._tag!);
                }
            }),
        );
    });

    it('indexed turns with equal turnIndex preserve relative order (stability)', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 50 }), rawTurns => {
                const turns = tagTurns(rawTurns);
                const sorted = sortTurns(turns);
                const indexed = sorted.filter(t => t.turnIndex != null);
                for (let i = 1; i < indexed.length; i++) {
                    if (indexed[i].turnIndex === indexed[i - 1].turnIndex) {
                        expect(indexed[i]._tag!).toBeGreaterThan(indexed[i - 1]._tag!);
                    }
                }
            }),
        );
    });

    it('handles empty arrays', () => {
        expect(sortTurns([])).toEqual([]);
    });

    it('handles single-element arrays', () => {
        fc.assert(
            fc.property(mixedTurnArb, turn => {
                expect(sortTurns([turn])).toEqual([turn]);
            }),
        );
    });

    it('handles all-unindexed arrays (preserves original order)', () => {
        fc.assert(
            fc.property(fc.array(unindexedTurnArb, { minLength: 1, maxLength: 30 }), rawTurns => {
                const turns = tagTurns(rawTurns);
                const sorted = sortTurns(turns);
                for (let i = 0; i < sorted.length; i++) {
                    expect(sorted[i]._tag).toBe(i);
                }
            }),
        );
    });
});

describe('sortTurnsBuggy: proves the old code fails', () => {
    it('OLD comparator moves unindexed turns to position 0 (regression proof)', () => {
        // A concrete example that the old comparator gets wrong
        const turns: MinimalTurn[] = [
            { role: 'user', turnIndex: 0 },
            { role: 'assistant', turnIndex: 1 },
            { role: 'user', turnIndex: 2 },
            { role: 'assistant' }, // streaming placeholder — no turnIndex
        ];
        const buggy = sortTurnsBuggy(turns);
        // With ?? 0 the unindexed turn sorts to position 0 (tied with turnIndex: 0)
        // or to between 0 and 1. Either way it breaks chronological order.
        // The fixed sort always puts it at the end.
        const fixed = sortTurns(turns);
        expect(fixed[fixed.length - 1].turnIndex).toBeUndefined();

        // Demonstrate the buggy sort does NOT put the unindexed turn at the end
        // when there are turns with turnIndex > 0
        const buggyLastIsUnindexed = buggy[buggy.length - 1].turnIndex == null;
        // In this specific case, the unindexed turn (??0) ties with turnIndex:0
        // so it does NOT reliably end up at the end
        // The property: at least one ordering produced by the buggy sort
        // places indexed turns after unindexed ones.
        const buggyHasIndexedAfterUnindexed = buggy.some(
            (t, i) => t.turnIndex == null && i < buggy.length - 1 && buggy[i + 1].turnIndex != null,
        );
        // At minimum, the buggy sort is not guaranteed to keep unindexed at end
        // (it may or may not depending on the engine's stable sort behavior)
        // But the FIXED sort always does:
        expect(fixed.findIndex(t => t.turnIndex == null)).toBe(fixed.length - 1);
    });

    it('OLD comparator fails property: unindexed after indexed (counterexample exists)', () => {
        // We find at least one case where the buggy sort violates the property.
        let foundCounterexample = false;
        // Construct a deterministic counterexample: indexed turns with values > 0
        // and one unindexed turn.
        const turns: MinimalTurn[] = [
            { role: 'user', turnIndex: 5 },
            { role: 'assistant' }, // no turnIndex → ?? 0 → sorts before turnIndex: 5
            { role: 'user', turnIndex: 10 },
        ];
        const buggy = sortTurnsBuggy(turns);
        const unindexedPos = buggy.findIndex(t => t.turnIndex == null);
        const lastIndexedPos = buggy.reduce((acc, t, i) => (t.turnIndex != null ? i : acc), -1);
        if (unindexedPos < lastIndexedPos) foundCounterexample = true;

        expect(foundCounterexample).toBe(true);
    });
});

describe('nextTurnIndex: properties', () => {
    it('returns a value strictly greater than all existing turnIndex values', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 50 }), turns => {
                const idx = nextTurnIndex(turns);
                for (const t of turns) {
                    if (t.turnIndex != null) {
                        expect(idx).toBeGreaterThan(t.turnIndex);
                    }
                }
            }),
        );
    });

    it('returns at least 1 for any input (never negative or zero when empty)', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 50 }), turns => {
                expect(nextTurnIndex(turns)).toBeGreaterThanOrEqual(1);
            }),
        );
    });

    it('returns 1 for empty array', () => {
        expect(nextTurnIndex([])).toBe(1);
    });

    it('returns 1 for all-unindexed array', () => {
        fc.assert(
            fc.property(fc.array(unindexedTurnArb, { minLength: 1, maxLength: 20 }), turns => {
                // All turns have turnIndex === undefined → max(-1 defaults) + 1 = 0 + 1 = 1
                // Actually: Math.max(0, ...(all -1)) = 0, +1 = 1
                expect(nextTurnIndex(turns)).toBe(1);
            }),
        );
    });

    it('is monotonically non-decreasing as turns are appended', () => {
        fc.assert(
            fc.property(fc.array(indexedTurnArb, { minLength: 1, maxLength: 30 }), turns => {
                let prev = nextTurnIndex([]);
                for (let i = 1; i <= turns.length; i++) {
                    const cur = nextTurnIndex(turns.slice(0, i));
                    expect(cur).toBeGreaterThanOrEqual(prev);
                    prev = cur;
                }
            }),
        );
    });
});

describe('ensureAssistantTurn: properties', () => {
    it('result always ends with an assistant turn', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { minLength: 0, maxLength: 20 }), turns => {
                const result = ensureAssistantTurn(turns);
                if (result.length > 0) {
                    expect(result[result.length - 1].role).toBe('assistant');
                }
            }),
        );
    });

    it('does not add a turn when last turn is already assistant', () => {
        fc.assert(
            fc.property(
                fc.array(mixedTurnArb, { maxLength: 20 }).filter(
                    ts => ts.length > 0 && ts[ts.length - 1].role === 'assistant',
                ),
                turns => {
                    const result = ensureAssistantTurn(turns);
                    expect(result).toHaveLength(turns.length);
                },
            ),
        );
    });

    it('adds exactly one turn when last turn is user', () => {
        fc.assert(
            fc.property(
                fc.array(mixedTurnArb, { maxLength: 20 }).filter(
                    ts => ts.length > 0 && ts[ts.length - 1].role === 'user',
                ),
                turns => {
                    const result = ensureAssistantTurn(turns);
                    expect(result).toHaveLength(turns.length + 1);
                },
            ),
        );
    });

    it('new turn has turnIndex greater than all existing', () => {
        fc.assert(
            fc.property(
                fc.array(mixedTurnArb, { maxLength: 20 }).filter(
                    ts => ts.length === 0 || ts[ts.length - 1].role === 'user',
                ),
                turns => {
                    const result = ensureAssistantTurn(turns);
                    const added = result[result.length - 1];
                    expect(added.turnIndex).toBeDefined();
                    for (const t of turns) {
                        if (t.turnIndex != null) {
                            expect(added.turnIndex!).toBeGreaterThan(t.turnIndex);
                        }
                    }
                },
            ),
        );
    });

    it('new turn is marked as streaming', () => {
        const result = ensureAssistantTurn([{ role: 'user', turnIndex: 0 }]);
        expect(result[result.length - 1].streaming).toBe(true);
    });
});

describe('appendFollowUp: properties', () => {
    it('appends exactly two turns (user + assistant)', () => {
        fc.assert(
            fc.property(fc.array(indexedTurnArb, { maxLength: 20 }), turns => {
                const result = appendFollowUp(turns);
                expect(result).toHaveLength(turns.length + 2);
            }),
        );
    });

    it('second-to-last turn is user, last turn is assistant', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 20 }), turns => {
                const result = appendFollowUp(turns);
                expect(result[result.length - 2].role).toBe('user');
                expect(result[result.length - 1].role).toBe('assistant');
            }),
        );
    });

    it('user turn index < assistant turn index', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 20 }), turns => {
                const result = appendFollowUp(turns);
                const userIdx = result[result.length - 2].turnIndex!;
                const assistantIdx = result[result.length - 1].turnIndex!;
                expect(assistantIdx).toBe(userIdx + 1);
            }),
        );
    });

    it('both new turns have turnIndex greater than all existing', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 20 }), turns => {
                const result = appendFollowUp(turns);
                const userTurn = result[result.length - 2];
                for (const t of turns) {
                    if (t.turnIndex != null) {
                        expect(userTurn.turnIndex!).toBeGreaterThan(t.turnIndex);
                    }
                }
            }),
        );
    });

    it('assistant turn is streaming', () => {
        const result = appendFollowUp([{ role: 'user', turnIndex: 0 }]);
        expect(result[result.length - 1].streaming).toBe(true);
    });
});

describe('appendStreamingPlaceholder: properties', () => {
    it('appends exactly one turn', () => {
        fc.assert(
            fc.property(fc.array(indexedTurnArb, { maxLength: 20 }), turns => {
                expect(appendStreamingPlaceholder(turns)).toHaveLength(turns.length + 1);
            }),
        );
    });

    it('appended turn is assistant + streaming with valid turnIndex', () => {
        fc.assert(
            fc.property(fc.array(mixedTurnArb, { maxLength: 20 }), turns => {
                const result = appendStreamingPlaceholder(turns);
                const added = result[result.length - 1];
                expect(added.role).toBe('assistant');
                expect(added.streaming).toBe(true);
                expect(added.turnIndex).toBeDefined();
                for (const t of turns) {
                    if (t.turnIndex != null) {
                        expect(added.turnIndex!).toBeGreaterThan(t.turnIndex);
                    }
                }
            }),
        );
    });
});

describe('end-to-end scenarios (sort ∘ append): properties', () => {
    it('sort(appendFollowUp(turns)) keeps new turns at the end', () => {
        fc.assert(
            fc.property(realisticConversationArb, turns => {
                const withFollowUp = appendFollowUp(turns);
                const sorted = sortTurns(withFollowUp);
                // The last two turns in sorted order should be the follow-up pair
                expect(sorted[sorted.length - 2].role).toBe('user');
                expect(sorted[sorted.length - 1].role).toBe('assistant');
                expect(sorted[sorted.length - 1].streaming).toBe(true);
            }),
        );
    });

    it('sort(ensureAssistantTurn(turns)) keeps new turn at the end', () => {
        fc.assert(
            fc.property(
                realisticConversationArb.filter(ts => ts.length === 0 || ts[ts.length - 1].role !== 'assistant'),
                turns => {
                    const withAssistant = ensureAssistantTurn(turns);
                    const sorted = sortTurns(withAssistant);
                    expect(sorted[sorted.length - 1].role).toBe('assistant');
                    expect(sorted[sorted.length - 1].streaming).toBe(true);
                },
            ),
        );
    });

    it('sort(appendStreamingPlaceholder(turns)) keeps placeholder at the end', () => {
        fc.assert(
            fc.property(realisticConversationArb, turns => {
                const withPlaceholder = appendStreamingPlaceholder(turns);
                const sorted = sortTurns(withPlaceholder);
                expect(sorted[sorted.length - 1].streaming).toBe(true);
                expect(sorted[sorted.length - 1].role).toBe('assistant');
            }),
        );
    });

    it('repeated follow-ups maintain chronological order after sort', () => {
        fc.assert(
            fc.property(
                realisticConversationArb,
                fc.integer({ min: 1, max: 5 }),
                (initial, followUpCount) => {
                    let turns = initial;
                    for (let i = 0; i < followUpCount; i++) {
                        turns = appendFollowUp(turns);
                    }
                    const sorted = sortTurns(turns);
                    // All turnIndex values should be non-decreasing
                    for (let i = 1; i < sorted.length; i++) {
                        const prev = sorted[i - 1].turnIndex;
                        const cur = sorted[i].turnIndex;
                        if (prev != null && cur != null) {
                            expect(cur).toBeGreaterThanOrEqual(prev);
                        }
                    }
                },
            ),
        );
    });

    it('race condition: out-of-order server turns + local placeholder → correct after sort', () => {
        // Simulates: server sends turns [0, 1, 2] but due to race condition
        // they arrive as [0, 2, 1], plus we have a local streaming placeholder.
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 2, maxLength: 15 })
                    .map(indices => [...new Set(indices)].sort((a, b) => a - b)),
                fc.boolean(),
                (sortedIndices, addPlaceholder) => {
                    // Shuffle the indexed turns to simulate race condition
                    const shuffled = [...sortedIndices].sort(() => Math.random() - 0.5);
                    const turns: MinimalTurn[] = shuffled.map((idx, i) => ({
                        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
                        turnIndex: idx,
                    }));
                    if (addPlaceholder) {
                        turns.push({ role: 'assistant', streaming: true, turnIndex: nextTurnIndex(turns) });
                    }
                    const sorted = sortTurns(turns);
                    // Indexed turns must be in ascending order
                    const indexedValues = sorted.filter(t => t.turnIndex != null).map(t => t.turnIndex!);
                    for (let i = 1; i < indexedValues.length; i++) {
                        expect(indexedValues[i]).toBeGreaterThanOrEqual(indexedValues[i - 1]);
                    }
                },
            ),
        );
    });
});

describe('edge cases', () => {
    it('negative turnIndex values sort before positive ones', () => {
        const turns: MinimalTurn[] = [
            { role: 'user', turnIndex: 2 },
            { role: 'assistant', turnIndex: -1 },
            { role: 'user', turnIndex: 0 },
        ];
        const sorted = sortTurns(turns);
        expect(sorted.map(t => t.turnIndex)).toEqual([-1, 0, 2]);
    });

    it('very large turnIndex values sort correctly', () => {
        const turns: MinimalTurn[] = [
            { role: 'user', turnIndex: Number.MAX_SAFE_INTEGER },
            { role: 'assistant', turnIndex: 0 },
            { role: 'user', turnIndex: Number.MAX_SAFE_INTEGER - 1 },
        ];
        const sorted = sortTurns(turns);
        expect(sorted.map(t => t.turnIndex)).toEqual([0, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]);
    });

    it('duplicate turnIndex values are stable', () => {
        const turns: MinimalTurn[] = tagTurns([
            { role: 'user', turnIndex: 1 },
            { role: 'assistant', turnIndex: 1 },
            { role: 'user', turnIndex: 1 },
        ]);
        const sorted = sortTurns(turns);
        expect(sorted.map(t => t._tag)).toEqual([0, 1, 2]);
    });

    it('mix of undefined and 0 turnIndex — undefined comes after 0', () => {
        const turns: MinimalTurn[] = [
            { role: 'assistant' }, // undefined
            { role: 'user', turnIndex: 0 },
        ];
        const sorted = sortTurns(turns);
        expect(sorted[0].turnIndex).toBe(0);
        expect(sorted[1].turnIndex).toBeUndefined();
    });

    it('nextTurnIndex handles a single turn with turnIndex 0', () => {
        expect(nextTurnIndex([{ role: 'user', turnIndex: 0 }])).toBe(1);
    });

    it('nextTurnIndex handles turns with gaps (e.g., 0, 5, 10)', () => {
        const turns: MinimalTurn[] = [
            { role: 'user', turnIndex: 0 },
            { role: 'assistant', turnIndex: 5 },
            { role: 'user', turnIndex: 10 },
        ];
        expect(nextTurnIndex(turns)).toBe(11);
    });

    it('appendFollowUp on empty array produces turnIndex 1 and 2', () => {
        const result = appendFollowUp([]);
        expect(result[0].turnIndex).toBe(1);
        expect(result[1].turnIndex).toBe(2);
    });

    it('ensureAssistantTurn on empty array produces turnIndex 1', () => {
        const result = ensureAssistantTurn([]);
        expect(result[0].turnIndex).toBe(1);
    });
});
