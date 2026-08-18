/**
 * Tests for the pure CommitList selection transitions.
 *
 * These freeze the ordering and anchor semantics that every gesture (desktop
 * click, Shift range, Arrow keys, mobile tap, swipe-right) funnels through, so
 * a change to one interaction mode cannot silently change another.
 */

import { describe, it, expect } from 'vitest';
import {
    resolveSelectedSet,
    resolveFocusedHash,
    toggleHash,
    commitsInSet,
    computeKeyboardTargetIndex,
    computeRangeSelection,
    computeToggleSelection,
    computeAdditiveSelection,
} from '../../../../src/server/spa/client/react/features/git/commits/commitListSelection';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/commitListTypes';

const mk = (hash: string): GitCommitItem => ({
    hash,
    shortHash: hash.slice(0, 7),
    subject: `subject ${hash}`,
    author: 'Alice',
    date: '2024-01-01T00:00:00Z',
    parentHashes: [],
});

const A = mk('aaaaaaa1');
const B = mk('bbbbbbb2');
const C = mk('ccccccc3');
const COMMITS = [A, B, C];

describe('resolveSelectedSet', () => {
    it('prefers selectedHashes over selectedHash', () => {
        const set = resolveSelectedSet(new Set([B.hash]), A.hash);
        expect([...set]).toEqual([B.hash]);
    });

    it('falls back to a single-entry set from selectedHash', () => {
        expect([...resolveSelectedSet(undefined, A.hash)]).toEqual([A.hash]);
    });

    it('returns an empty set when neither is provided', () => {
        expect(resolveSelectedSet(undefined, null).size).toBe(0);
    });

    it('treats an explicitly empty selectedHashes as empty, not as a fallback', () => {
        expect(resolveSelectedSet(new Set<string>(), A.hash).size).toBe(0);
    });
});

describe('resolveFocusedHash', () => {
    it('uses selectedHash when present', () => {
        expect(resolveFocusedHash(A.hash, new Set([B.hash]))).toBe(A.hash);
    });

    it('uses the last entry of selectedHashes otherwise', () => {
        expect(resolveFocusedHash(null, new Set([A.hash, C.hash]))).toBe(C.hash);
    });

    it('returns null when nothing is selected', () => {
        expect(resolveFocusedHash(null, new Set<string>())).toBeNull();
        expect(resolveFocusedHash(undefined, undefined)).toBeNull();
    });
});

describe('toggleHash / commitsInSet', () => {
    it('adds an absent hash and removes a present one', () => {
        expect([...toggleHash(new Set([A.hash]), B.hash)].sort()).toEqual([A.hash, B.hash].sort());
        expect([...toggleHash(new Set([A.hash, B.hash]), A.hash)]).toEqual([B.hash]);
    });

    it('does not mutate the input set', () => {
        const original = new Set([A.hash]);
        toggleHash(original, B.hash);
        expect([...original]).toEqual([A.hash]);
    });

    it('returns commits in display order regardless of set insertion order', () => {
        const selected = commitsInSet(COMMITS, new Set([C.hash, A.hash]));
        expect(selected.map(c => c.hash)).toEqual([A.hash, C.hash]);
    });
});

describe('computeKeyboardTargetIndex', () => {
    it('moves down and clamps at the last row', () => {
        expect(computeKeyboardTargetIndex(3, 0, 'down')).toBe(1);
        expect(computeKeyboardTargetIndex(3, 2, 'down')).toBe(2);
    });

    it('moves up and clamps at the first row', () => {
        expect(computeKeyboardTargetIndex(3, 2, 'up')).toBe(1);
        expect(computeKeyboardTargetIndex(3, 0, 'up')).toBe(0);
    });

    it('starts at the top when nothing is focused', () => {
        expect(computeKeyboardTargetIndex(3, -1, 'down')).toBe(0);
        expect(computeKeyboardTargetIndex(3, -1, 'up')).toBe(0);
    });

    it('returns null for an empty list', () => {
        expect(computeKeyboardTargetIndex(0, -1, 'down')).toBeNull();
    });
});

describe('computeRangeSelection', () => {
    it('selects the inclusive range from anchor down to target', () => {
        expect(computeRangeSelection(COMMITS, A.hash, C).map(c => c.hash)).toEqual([A.hash, B.hash, C.hash]);
    });

    it('handles a reversed range (anchor below target) in display order', () => {
        expect(computeRangeSelection(COMMITS, C.hash, A).map(c => c.hash)).toEqual([A.hash, B.hash, C.hash]);
    });

    it('selects just the target when the anchor is no longer in the list', () => {
        expect(computeRangeSelection(COMMITS, 'gone', B).map(c => c.hash)).toEqual([B.hash]);
    });

    it('selects just the target when there is no anchor', () => {
        expect(computeRangeSelection(COMMITS, null, B).map(c => c.hash)).toEqual([B.hash]);
    });
});

describe('computeToggleSelection', () => {
    it('adds the commit and anchors on it', () => {
        const r = computeToggleSelection(COMMITS, new Set([A.hash]), C);
        expect(r.selected.map(c => c.hash)).toEqual([A.hash, C.hash]);
        expect(r.anchorHash).toBe(C.hash);
        expect(r.isEmpty).toBe(false);
    });

    it('removes the commit and keeps the remaining selection in display order', () => {
        const r = computeToggleSelection(COMMITS, new Set([A.hash, B.hash, C.hash]), B);
        expect(r.selected.map(c => c.hash)).toEqual([A.hash, C.hash]);
        expect(r.isEmpty).toBe(false);
    });

    it('reports an empty result and clears the anchor when the last commit is deselected', () => {
        const r = computeToggleSelection(COMMITS, new Set([A.hash]), A);
        expect(r.selected).toEqual([]);
        expect(r.anchorHash).toBeNull();
        expect(r.isEmpty).toBe(true);
    });
});

describe('computeAdditiveSelection', () => {
    it('grows the selection without removing anything', () => {
        const selected = computeAdditiveSelection(COMMITS, new Set([A.hash]), B);
        expect(selected.map(c => c.hash)).toEqual([A.hash, B.hash]);
    });

    it('is a no-op when the commit is already selected', () => {
        const selected = computeAdditiveSelection(COMMITS, new Set([A.hash, B.hash]), B);
        expect(selected.map(c => c.hash)).toEqual([A.hash, B.hash]);
    });
});
