/**
 * Tests for the Git tab's pure right-panel selection model.
 *
 * `reconcileSelectionAfterRefresh` decides what the detail pane shows after a
 * refresh. Its branching used to live inline in `refreshAll`, so these cases
 * (retarget, fall back to HEAD, clear, or leave alone) could only be exercised
 * by mounting the whole tab.
 */

import { describe, it, expect } from 'vitest';
import {
    reconcileSelectionAfterRefresh,
    selectedCommitHashOf,
    selectedHashesOf,
} from '../../../../src/server/spa/client/react/features/git/repoGitTab/selectionModel';
import type { RightPanelView } from '../../../../src/server/spa/client/react/features/git/repoGitTab/types';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';

function commit(hash: string, subject = `subject ${hash}`): GitCommitItem {
    return {
        hash,
        shortHash: hash.slice(0, 7),
        subject,
        author: 'Ada',
        authorEmail: 'ada@example.com',
        date: '2026-01-01T00:00:00Z',
        parentHashes: [],
    };
}

const A = commit('aaaaaaaaaaaa');
const B = commit('bbbbbbbbbbbb');
const C = commit('cccccccccccc');

describe('selectedCommitHashOf', () => {
    it('reads the hash from a commit view', () => {
        expect(selectedCommitHashOf({ type: 'commit', commit: A })).toBe(A.hash);
    });

    it('reads the hash from a commit-file view', () => {
        expect(selectedCommitHashOf({ type: 'commit-file', hash: A.hash, filePath: 'a.ts' })).toBe(A.hash);
    });

    it('returns null for views that are not commit-scoped', () => {
        expect(selectedCommitHashOf({ type: 'branch-range' })).toBeNull();
        expect(selectedCommitHashOf({ type: 'working-tree-comments' })).toBeNull();
        expect(selectedCommitHashOf(null)).toBeNull();
    });
});

describe('selectedHashesOf', () => {
    it('returns every hash of a multi-commit selection', () => {
        const hashes = selectedHashesOf({ type: 'multi-commit', commits: [A, B] });
        expect([...hashes].sort()).toEqual([A.hash, B.hash].sort());
    });

    it('returns a single hash for commit and commit-file views', () => {
        expect([...selectedHashesOf({ type: 'commit', commit: A })]).toEqual([A.hash]);
        expect([...selectedHashesOf({ type: 'commit-file', hash: B.hash, filePath: 'x' })]).toEqual([B.hash]);
    });

    it('returns an empty set when nothing commit-scoped is selected', () => {
        expect(selectedHashesOf({ type: 'branch-range' }).size).toBe(0);
        expect(selectedHashesOf(null).size).toBe(0);
    });
});

describe('reconcileSelectionAfterRefresh', () => {
    describe('explicit targeting (amend / drop)', () => {
        it('selects the requested hash when it survived the refresh', () => {
            const result = reconcileSelectionAfterRefresh(null, [A, B], { selectHash: B.hash });
            expect(result.changed).toBe(true);
            expect(result.next).toEqual({ type: 'commit', commit: B });
        });

        it('falls back to HEAD when the requested hash is gone', () => {
            const result = reconcileSelectionAfterRefresh(null, [A, B], {
                selectHash: 'deadbeefdead',
                selectFallbackToHead: true,
            });
            expect(result.changed).toBe(true);
            expect(result.next).toEqual({ type: 'commit', commit: A });
        });

        it('clears the panel when fallback is requested but nothing loaded', () => {
            const result = reconcileSelectionAfterRefresh(null, [], { selectFallbackToHead: true });
            expect(result.changed).toBe(true);
            expect(result.next).toBeNull();
        });
    });

    describe('commit-scoped views', () => {
        it('retargets a commit view to the refreshed instance of the same hash', () => {
            const refreshedA = { ...A, subject: 'rewritten subject' };
            const result = reconcileSelectionAfterRefresh({ type: 'commit', commit: A }, [refreshedA, B]);
            expect(result.changed).toBe(true);
            expect(result.next).toEqual({ type: 'commit', commit: refreshedA });
        });

        it('leaves a commit-file view on its file when the commit survives', () => {
            const view: RightPanelView = { type: 'commit-file', hash: A.hash, filePath: 'src/a.ts' };
            const result = reconcileSelectionAfterRefresh(view, [A, B]);
            expect(result.changed).toBe(false);
            expect(result.next).toEqual(view);
        });

        it('falls back to HEAD when the selected commit disappeared (rebase/drop)', () => {
            const result = reconcileSelectionAfterRefresh({ type: 'commit', commit: C }, [A, B]);
            expect(result.changed).toBe(true);
            expect(result.next).toEqual({ type: 'commit', commit: A });
        });

        it('clears the panel when the selected commit disappeared and nothing is left', () => {
            const result = reconcileSelectionAfterRefresh({ type: 'commit', commit: C }, []);
            expect(result.changed).toBe(true);
            expect(result.next).toBeNull();
        });
    });

    describe('views that are not commit-scoped', () => {
        it.each<RightPanelView>([
            { type: 'branch-range' },
            { type: 'branch-file', filePath: 'src/a.ts' },
            { type: 'working-tree-file', filePath: 'src/a.ts', stage: 'unstaged' },
            { type: 'working-tree-comments' },
            { type: 'branch-range-comments' },
        ])('leaves a $type view untouched', (view) => {
            const result = reconcileSelectionAfterRefresh(view, [A, B]);
            expect(result.changed).toBe(false);
            expect(result.next).toEqual(view);
        });

        it('preserves the empty panel so mobile "back to list" survives a refresh', () => {
            const result = reconcileSelectionAfterRefresh(null, [A, B]);
            expect(result.changed).toBe(false);
            expect(result.next).toBeNull();
        });

        it('collapses a multi-commit selection to HEAD', () => {
            const result = reconcileSelectionAfterRefresh({ type: 'multi-commit', commits: [A, B] }, [A, B]);
            expect(result.changed).toBe(true);
            expect(result.next).toEqual({ type: 'commit', commit: A });
        });

        it('leaves a multi-commit selection alone when nothing loaded', () => {
            const view: RightPanelView = { type: 'multi-commit', commits: [A, B] };
            const result = reconcileSelectionAfterRefresh(view, []);
            expect(result.changed).toBe(false);
            expect(result.next).toEqual(view);
        });
    });
});
