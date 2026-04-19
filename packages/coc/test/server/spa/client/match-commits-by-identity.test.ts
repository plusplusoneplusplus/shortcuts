/**
 * Tests for matchCommitsByIdentity utility.
 */

import { describe, it, expect } from 'vitest';
import { matchCommitsByIdentity } from '../../../../src/server/spa/client/react/repos/commit-utils';

interface GitCommitItem {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    authorEmail?: string;
    date: string;
    parentHashes: string[];
    body?: string;
}

function makeCommit(overrides: Partial<GitCommitItem> & { hash: string }): GitCommitItem {
    return {
        shortHash: overrides.hash.slice(0, 7),
        subject: 'default subject',
        author: 'Alice',
        authorEmail: 'alice@example.com',
        date: '2025-01-15T10:00:00Z',
        parentHashes: [],
        ...overrides,
    };
}

describe('matchCommitsByIdentity', () => {
    it('returns a pair when one commit hash changed but identity is the same', () => {
        const old = [makeCommit({ hash: 'aaa111' })];
        const nw = [makeCommit({ hash: 'bbb222' })];
        expect(matchCommitsByIdentity(old, nw)).toEqual([
            { oldHash: 'aaa111', newHash: 'bbb222' },
        ]);
    });

    it('returns empty when hashes are the same', () => {
        const old = [makeCommit({ hash: 'aaa111' })];
        const nw = [makeCommit({ hash: 'aaa111' })];
        expect(matchCommitsByIdentity(old, nw)).toEqual([]);
    });

    it('returns empty when two old commits share the same identity key (ambiguous)', () => {
        const old = [
            makeCommit({ hash: 'aaa111' }),
            makeCommit({ hash: 'aaa222' }), // same identity
        ];
        const nw = [makeCommit({ hash: 'bbb333' })];
        expect(matchCommitsByIdentity(old, nw)).toEqual([]);
    });

    it('returns empty when one old commit identity matches two new commits (ambiguous new)', () => {
        const old = [makeCommit({ hash: 'aaa111' })];
        const nw = [
            makeCommit({ hash: 'bbb222' }),
            makeCommit({ hash: 'bbb333' }), // same identity
        ];
        expect(matchCommitsByIdentity(old, nw)).toEqual([]);
    });

    it('returns only clean pairs in mixed scenario', () => {
        const old = [
            makeCommit({ hash: 'aaa111', subject: 'feat: A' }),
            makeCommit({ hash: 'aaa222', subject: 'fix: B' }),
            makeCommit({ hash: 'aaa333', subject: 'chore: C' }), // no match in new
        ];
        const nw = [
            makeCommit({ hash: 'bbb111', subject: 'feat: A' }),  // matches aaa111
            makeCommit({ hash: 'bbb222', subject: 'fix: B' }),   // matches aaa222
            makeCommit({ hash: 'bbb444', subject: 'docs: D' }),  // new commit, no old match
        ];
        const result = matchCommitsByIdentity(old, nw);
        expect(result).toHaveLength(2);
        expect(result).toContainEqual({ oldHash: 'aaa111', newHash: 'bbb111' });
        expect(result).toContainEqual({ oldHash: 'aaa222', newHash: 'bbb222' });
    });

    it('returns empty for empty lists', () => {
        expect(matchCommitsByIdentity([], [])).toEqual([]);
    });

    it('returns empty for disjoint lists (no identity overlap)', () => {
        const old = [makeCommit({ hash: 'aaa111', subject: 'feat: A', author: 'Alice' })];
        const nw = [makeCommit({ hash: 'bbb222', subject: 'feat: B', author: 'Bob' })];
        expect(matchCommitsByIdentity(old, nw)).toEqual([]);
    });

    it('handles missing authorEmail gracefully', () => {
        const old = [makeCommit({ hash: 'aaa111', authorEmail: undefined })];
        const nw = [makeCommit({ hash: 'bbb222', authorEmail: undefined })];
        expect(matchCommitsByIdentity(old, nw)).toEqual([
            { oldHash: 'aaa111', newHash: 'bbb222' },
        ]);
    });

    it('does not match when authorEmail differs', () => {
        const old = [makeCommit({ hash: 'aaa111', authorEmail: 'alice@a.com' })];
        const nw = [makeCommit({ hash: 'bbb222', authorEmail: 'alice@b.com' })];
        expect(matchCommitsByIdentity(old, nw)).toEqual([]);
    });
});
