/**
 * Tests for the pure CommitList row view model and date grouping.
 *
 * Keeps badge/flag derivation independent of rendering so a presentation change
 * cannot quietly alter which commits count as unpushed, merge, or fixup.
 */

import { describe, it, expect } from 'vitest';
import {
    computeCommitGroups,
    buildCommitRowViewModel,
    getAuthorInitials,
    getAuthorPalette,
} from '../../../../src/server/spa/client/react/features/git/commits/commitRowViewModel';
import { buildFixupGroups, FIXUP_GROUP_COLORS_LIGHT } from '../../../../src/server/spa/client/react/features/git/fixup-utils';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/commitListTypes';

const EMPTY_FIXUPS = buildFixupGroups([]);

const mk = (over: Partial<GitCommitItem> & { hash: string }): GitCommitItem => ({
    shortHash: over.hash.slice(0, 7),
    subject: 'subject',
    author: 'Alice Smith',
    date: new Date().toISOString(),
    parentHashes: [],
    ...over,
});

const buildVm = (over: Partial<Parameters<typeof buildCommitRowViewModel>[0]> & { commit: GitCommitItem }) =>
    buildCommitRowViewModel({
        index: 0,
        commitCount: 1,
        unpushedCount: 0,
        group: undefined,
        hasGroupAtNextIndex: false,
        fixupGroups: EMPTY_FIXUPS,
        groupColors: FIXUP_GROUP_COLORS_LIGHT,
        commentCount: 0,
        ...over,
    });

describe('computeCommitGroups', () => {
    it('emits an Unpushed group covering the leading unpushed commits', () => {
        const commits = [mk({ hash: 'a' }), mk({ hash: 'b' }), mk({ hash: 'c' })];
        const groups = computeCommitGroups(commits, 2);
        expect(groups[0]).toMatchObject({ label: 'Unpushed', isUnpushed: true, startIdx: 0, count: 2 });
    });

    it('caps the unpushed count at the number of commits actually loaded', () => {
        const groups = computeCommitGroups([mk({ hash: 'a' })], 5);
        expect(groups[0].count).toBe(1);
    });

    it('buckets commits by recency and starts date groups after the unpushed run', () => {
        const day = 86_400_000;
        const commits = [
            mk({ hash: 'a', date: new Date().toISOString() }),
            mk({ hash: 'b', date: new Date(Date.now() - 3 * day).toISOString() }),
            mk({ hash: 'c', date: new Date(Date.now() - 60 * day).toISOString() }),
        ];
        const labels = computeCommitGroups(commits, 0).map(g => g.label);
        expect(labels).toEqual(['Today', 'This week', 'Older']);
    });

    it('files unparseable dates under Older', () => {
        const groups = computeCommitGroups([mk({ hash: 'a', date: 'not-a-date' })], 0);
        expect(groups.map(g => g.label)).toEqual(['Older']);
    });

    it('returns no groups for an empty list', () => {
        expect(computeCommitGroups([], 0)).toEqual([]);
    });
});

describe('buildCommitRowViewModel', () => {
    it('derives selection from selectedHashes when present, ignoring selectedHash', () => {
        const commit = mk({ hash: 'a' });
        expect(buildVm({ commit, selectedHash: 'a', selectedHashes: new Set(['b']) }).isSelected).toBe(false);
        expect(buildVm({ commit, selectedHashes: new Set(['a']) }).isSelected).toBe(true);
    });

    it('falls back to selectedHash when selectedHashes is absent', () => {
        expect(buildVm({ commit: mk({ hash: 'a' }), selectedHash: 'a' }).isSelected).toBe(true);
    });

    it('marks only commits inside the unpushed range', () => {
        const commit = mk({ hash: 'a' });
        expect(buildVm({ commit, index: 0, unpushedCount: 2 }).isUnpushed).toBe(true);
        expect(buildVm({ commit, index: 2, unpushedCount: 2 }).isUnpushed).toBe(false);
        expect(buildVm({ commit, index: 0, unpushedCount: 0 }).isUnpushed).toBe(false);
    });

    it('flags a commit with multiple parents as a merge', () => {
        expect(buildVm({ commit: mk({ hash: 'a', parentHashes: ['p1', 'p2'] }) }).isMerge).toBe(true);
        expect(buildVm({ commit: mk({ hash: 'a', parentHashes: ['p1'] }) }).isMerge).toBe(false);
    });

    it('treats the final row of a group as the last in group', () => {
        const commit = mk({ hash: 'a' });
        const group = { label: 'Today', isUnpushed: false, startIdx: 0, count: 2 };
        expect(buildVm({ commit, index: 1, commitCount: 5, group }).isLastInGroup).toBe(true);
        expect(buildVm({ commit, index: 0, commitCount: 5, group }).isLastInGroup).toBe(false);
    });

    it('treats an ungrouped row followed by a group start as the last in group', () => {
        const commit = mk({ hash: 'a' });
        expect(buildVm({ commit, index: 1, commitCount: 5, hasGroupAtNextIndex: true }).isLastInGroup).toBe(true);
        expect(buildVm({ commit, index: 1, commitCount: 5, hasGroupAtNextIndex: false }).isLastInGroup).toBe(false);
    });

    it('colors a fixup commit and its target from the same group slot', () => {
        const target = mk({ hash: 'target1', subject: 'Original work' });
        const fixup = mk({ hash: 'fixup01', subject: 'fixup! Original work' });
        const fixupGroups = buildFixupGroups([fixup, target]);
        const fixupVm = buildVm({ commit: fixup, fixupGroups });
        const targetVm = buildVm({ commit: target, fixupGroups });
        expect(fixupVm.isFixup).toBe(true);
        expect(fixupVm.hasFixups).toBe(false);
        expect(targetVm.hasFixups).toBe(true);
        expect(fixupVm.groupColor).toBe(targetVm.groupColor);
        expect(fixupVm.groupColor).toBeTruthy();
    });

    it('leaves groupColor undefined for a plain commit', () => {
        expect(buildVm({ commit: mk({ hash: 'a' }) }).groupColor).toBeUndefined();
    });

    it('reports classification only for hashes in classifiedHashes', () => {
        const commit = mk({ hash: 'a' });
        expect(buildVm({ commit, classifiedHashes: new Set(['a']) }).isClassified).toBe(true);
        expect(buildVm({ commit, classifiedHashes: new Set(['b']) }).isClassified).toBe(false);
        expect(buildVm({ commit }).isClassified).toBe(false);
    });
});

describe('author avatar helpers', () => {
    it('uses the first letter of the first two name parts', () => {
        expect(getAuthorInitials('Alice Smith')).toBe('AS');
        expect(getAuthorInitials('alice.smith')).toBe('AS');
    });

    it('falls back to the first two characters of a single-part name', () => {
        expect(getAuthorInitials('alice')).toBe('AL');
    });

    it('returns ? for a blank name', () => {
        expect(getAuthorInitials('   ')).toBe('?');
        expect(getAuthorInitials('')).toBe('?');
    });

    it('is deterministic per author', () => {
        expect(getAuthorPalette('Alice')).toEqual(getAuthorPalette('Alice'));
    });
});
