/**
 * Tests for monacoDiffHunks — hunk list and navigation cursor (AC-03).
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createHunkNavigator,
    hunksFromLineChanges,
} from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffHunks';
import type { DiffLineChange } from '../../../../../../src/server/spa/client/react/features/git/diff/diffCoords';

const change = (o1: number, o2: number, m1: number, m2: number): DiffLineChange => ({
    originalStartLineNumber: o1, originalEndLineNumber: o2, modifiedStartLineNumber: m1, modifiedEndLineNumber: m2,
});

const THREE = [change(2, 2, 2, 2), change(10, 0, 11, 12), change(20, 21, 22, 0)];

describe('hunksFromLineChanges', () => {
    it('null (not computed) → no hunks', () => {
        expect(hunksFromLineChanges(null)).toEqual([]);
    });

    it('reveals modifications and insertions at their modified start', () => {
        const [mod, ins] = hunksFromLineChanges(THREE);
        expect(mod.revealLine).toBe(2);
        expect(ins.revealLine).toBe(11);
    });

    it('reveals a deletion at the line above it, or line 1 at the top of the file', () => {
        expect(hunksFromLineChanges(THREE)[2].revealLine).toBe(22);
        expect(hunksFromLineChanges([change(1, 3, 0, 0)])[0].revealLine).toBe(1);
    });
});

function setup() {
    const reveal = vi.fn();
    const nav = createHunkNavigator(reveal);
    const revealed = () => reveal.mock.calls.map(([hunk, index]) => [index, hunk.revealLine]);
    return { nav, reveal, revealed };
}

describe('createHunkNavigator — readiness', () => {
    it('starts not ready with no hunks and no cursor', () => {
        const { nav } = setup();
        expect(nav.isReady()).toBe(false);
        expect(nav.count()).toBe(0);
        expect(nav.currentIndex()).toBe(-1);
    });

    it('holds a request made before the diff is computed and applies it on readiness', () => {
        const { nav, revealed } = setup();
        nav.request({ kind: 'last' });
        expect(revealed()).toEqual([]);
        nav.setLineChanges(null); // still computing
        expect(revealed()).toEqual([]);
        nav.setLineChanges(THREE);
        expect(revealed()).toEqual([[2, 22]]);
        expect(nav.currentIndex()).toBe(2);
    });

    it('keeps only the latest held request', () => {
        const { nav, revealed } = setup();
        nav.request({ kind: 'last' });
        nav.request({ kind: 'first' });
        nav.setLineChanges(THREE);
        expect(revealed()).toEqual([[0, 2]]);
    });

    it('a held request on a file with no hunks is dropped', () => {
        const { nav, revealed } = setup();
        nav.request({ kind: 'next' });
        nav.setLineChanges([]);
        expect(nav.isReady()).toBe(true);
        expect(revealed()).toEqual([]);
        nav.setLineChanges(THREE); // recompute later does not replay it
        expect(revealed()).toEqual([]);
    });

    it('reset returns to not-ready and forgets cursor and held request', () => {
        const { nav, revealed } = setup();
        nav.setLineChanges(THREE);
        nav.request({ kind: 'next' });
        nav.reset();
        nav.request({ kind: 'last' });
        nav.reset();
        expect(nav.isReady()).toBe(false);
        expect(nav.currentIndex()).toBe(-1);
        nav.setLineChanges(THREE);
        expect(revealed()).toEqual([[0, 2]]);
    });

    it('a recompute keeps the cursor, clamped to the new hunk count', () => {
        const { nav } = setup();
        nav.setLineChanges(THREE);
        nav.request({ kind: 'last' });
        nav.setLineChanges(THREE);
        expect(nav.currentIndex()).toBe(2);
        nav.setLineChanges(THREE.slice(0, 1));
        expect(nav.currentIndex()).toBe(0);
    });
});

describe('createHunkNavigator — movement', () => {
    it('next walks forward and wraps to the first hunk', () => {
        const { nav } = setup();
        nav.setLineChanges(THREE);
        const seen = [0, 1, 2, 3].map(() => { nav.request({ kind: 'next' }); return nav.currentIndex(); });
        expect(seen).toEqual([0, 1, 2, 0]);
    });

    it('prev from no cursor lands on the last hunk, then wraps from the first', () => {
        const { nav } = setup();
        nav.setLineChanges(THREE);
        const seen = [0, 1, 2, 3].map(() => { nav.request({ kind: 'prev' }); return nav.currentIndex(); });
        expect(seen).toEqual([2, 1, 0, 2]);
    });

    it('single-hunk file: next and prev stay on hunk 0', () => {
        const { nav } = setup();
        nav.setLineChanges(THREE.slice(0, 1));
        nav.request({ kind: 'next' });
        nav.request({ kind: 'next' });
        nav.request({ kind: 'prev' });
        expect(nav.currentIndex()).toBe(0);
    });

    it('index moves to in-range hunks and ignores out-of-range ones', () => {
        const { nav, revealed } = setup();
        nav.setLineChanges(THREE);
        nav.request({ kind: 'index', index: 1 });
        nav.request({ kind: 'index', index: 3 });
        nav.request({ kind: 'index', index: -1 });
        expect(nav.currentIndex()).toBe(1);
        expect(revealed()).toEqual([[1, 11]]);
    });

    it('no hunks: movement is a no-op', () => {
        const { nav, reveal } = setup();
        nav.setLineChanges([]);
        nav.request({ kind: 'next' });
        nav.request({ kind: 'prev' });
        expect(reveal).not.toHaveBeenCalled();
        expect(nav.currentIndex()).toBe(-1);
    });
});
