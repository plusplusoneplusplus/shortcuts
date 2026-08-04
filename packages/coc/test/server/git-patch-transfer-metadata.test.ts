/**
 * Patch-transfer metadata sanitization tests.
 *
 * Source metadata may arrive from another CoC server, so the focus here is
 * privacy: local absolute paths (POSIX, Windows drive, UNC) must never survive
 * into a persisted, rendered git-op record.
 *
 * Pure functions — no I/O. Cross-platform compatible.
 */

import { describe, it, expect } from 'vitest';
import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';
import {
    buildPatchTransferMetadata,
    looksLikeLocalAbsolutePath,
    sanitizeCommitMetadata,
    sanitizeCommitMetadataArray,
    sanitizeHash,
    sanitizeMetadataString,
    sanitizeNormalizedRemoteUrl,
    sanitizeServerMetadata,
    sanitizeWorkspaceMetadata,
    toGitOpCommitMetadata,
} from '../../src/server/git/git-patch-transfer-metadata';

const targetWorkspace = { id: 'ws-target', name: 'Target Repo', rootPath: '/repos/target' } as WorkspaceInfo;

describe('looksLikeLocalAbsolutePath', () => {
    it.each([
        ['/home/alice/repos/secret', true],
        ['C:\\Users\\alice\\repos', true],
        ['c:/Users/alice/repos', true],
        ['\\\\fileserver\\share\\repo', true],
        ['github.com/org/repo', false],
        ['https://github.com/org/repo.git', false],
        ['relative/path', false],
        ['', false],
    ])('%s → %s', (value, expected) => {
        expect(looksLikeLocalAbsolutePath(value)).toBe(expected);
    });
});

describe('sanitizeMetadataString', () => {
    it('trims and collapses newlines and tabs into single spaces', () => {
        expect(sanitizeMetadataString('  fix:\n\tthe thing  ')).toBe('fix: the thing');
    });

    it('rejects non-strings, blanks, and local paths', () => {
        expect(sanitizeMetadataString(42)).toBeUndefined();
        expect(sanitizeMetadataString('   ')).toBeUndefined();
        expect(sanitizeMetadataString('/home/alice/project')).toBeUndefined();
        expect(sanitizeMetadataString('D:\\work\\project')).toBeUndefined();
        expect(sanitizeMetadataString('\\\\nas\\team\\project')).toBeUndefined();
    });

    it('caps length at the default and at an explicit maximum', () => {
        expect(sanitizeMetadataString('x'.repeat(400))).toHaveLength(200);
        expect(sanitizeMetadataString('x'.repeat(400), 50)).toHaveLength(50);
    });
});

describe('sanitizeHash', () => {
    it('lowercases valid abbreviated and full hashes', () => {
        expect(sanitizeHash('ABCD')).toBe('abcd');
        expect(sanitizeHash('a'.repeat(40))).toBe('a'.repeat(40));
    });

    it('rejects short and non-hex values', () => {
        expect(sanitizeHash('abc')).toBeUndefined();
        expect(sanitizeHash('zzzz')).toBeUndefined();
        expect(sanitizeHash(undefined)).toBeUndefined();
        expect(sanitizeHash({ hash: 'abcd' })).toBeUndefined();
    });

    it('truncates an over-long hex string to a full 40-character hash', () => {
        expect(sanitizeHash('a'.repeat(45))).toBe('a'.repeat(40));
    });
});

describe('sanitizeNormalizedRemoteUrl', () => {
    it('normalizes SSH and HTTPS remotes to the same value', () => {
        const ssh = sanitizeNormalizedRemoteUrl('git@github.com:org/repo.git');
        const https = sanitizeNormalizedRemoteUrl('https://github.com/org/repo.git');
        expect(ssh).toBeTruthy();
        expect(ssh).toBe(https);
    });

    it('rejects local clone paths on both platforms', () => {
        expect(sanitizeNormalizedRemoteUrl('/srv/git/repo.git')).toBeUndefined();
        expect(sanitizeNormalizedRemoteUrl('C:\\git\\repo.git')).toBeUndefined();
        expect(sanitizeNormalizedRemoteUrl('\\\\nas\\git\\repo.git')).toBeUndefined();
    });

    it('rejects blanks and non-strings', () => {
        expect(sanitizeNormalizedRemoteUrl('  ')).toBeUndefined();
        expect(sanitizeNormalizedRemoteUrl(null)).toBeUndefined();
    });
});

describe('sanitizeWorkspaceMetadata / sanitizeServerMetadata', () => {
    it('keeps the optional label/name only when it survives sanitization', () => {
        expect(sanitizeWorkspaceMetadata({ id: 'ws-1', name: 'Repo' })).toEqual({ id: 'ws-1', name: 'Repo' });
        expect(sanitizeWorkspaceMetadata({ id: 'ws-1', name: '/home/alice/repo' })).toEqual({ id: 'ws-1' });
        expect(sanitizeServerMetadata({ id: 'srv-1', label: 'Laptop' })).toEqual({ id: 'srv-1', label: 'Laptop' });
        expect(sanitizeServerMetadata({ id: 'srv-1' })).toEqual({ id: 'srv-1' });
    });

    it('drops entries without a usable id, and rejects non-records', () => {
        expect(sanitizeWorkspaceMetadata({ name: 'Repo' })).toBeUndefined();
        expect(sanitizeServerMetadata({ id: '  ' })).toBeUndefined();
        expect(sanitizeWorkspaceMetadata(['ws-1'])).toBeUndefined();
        expect(sanitizeServerMetadata('srv-1')).toBeUndefined();
    });
});

describe('sanitizeCommitMetadata', () => {
    it('keeps hash, subject, and author fields', () => {
        expect(sanitizeCommitMetadata({
            hash: 'ABC123',
            subject: 'feat: thing',
            author: { name: 'Alice', email: 'alice@example.com', date: '2026-01-01T00:00:00Z' },
        })).toEqual({
            hash: 'abc123',
            subject: 'feat: thing',
            author: { name: 'Alice', email: 'alice@example.com', date: '2026-01-01T00:00:00Z' },
        });
    });

    it('drops the commit entirely when the hash is unusable', () => {
        expect(sanitizeCommitMetadata({ hash: 'nope', subject: 'x' })).toBeUndefined();
    });

    it('omits the author when no author field survives', () => {
        expect(sanitizeCommitMetadata({ hash: 'abc123', author: { name: '/home/alice' } }))
            .toEqual({ hash: 'abc123' });
    });

    it('allows a longer subject than other metadata strings', () => {
        const commit = sanitizeCommitMetadata({ hash: 'abc123', subject: 'x'.repeat(600) });
        expect(commit?.subject).toHaveLength(500);
    });
});

describe('sanitizeCommitMetadataArray', () => {
    it('keeps ordering and filters unusable entries', () => {
        expect(sanitizeCommitMetadataArray([
            { hash: 'aaaa', subject: 'first' },
            { hash: 'bad' },
            { hash: 'bbbb', subject: 'second' },
        ])).toEqual([
            { hash: 'aaaa', subject: 'first' },
            { hash: 'bbbb', subject: 'second' },
        ]);
    });

    it('returns undefined for non-arrays and all-invalid arrays', () => {
        expect(sanitizeCommitMetadataArray('aaaa')).toBeUndefined();
        expect(sanitizeCommitMetadataArray([{ hash: 'bad' }])).toBeUndefined();
    });
});

describe('toGitOpCommitMetadata', () => {
    it('reshapes a BranchService export payload', () => {
        expect(toGitOpCommitMetadata({
            commitHash: 'abc1234',
            subject: 'feat: thing',
            authorName: 'Alice',
            authorEmail: 'alice@example.com',
            authorDate: '2026-01-01T00:00:00Z',
        })).toEqual({
            hash: 'abc1234',
            subject: 'feat: thing',
            author: { name: 'Alice', email: 'alice@example.com', date: '2026-01-01T00:00:00Z' },
        });
    });
});

describe('buildPatchTransferMetadata', () => {
    it('records the target side and mirrors the head hash into newCommitHash', () => {
        const metadata = buildPatchTransferMetadata({}, targetWorkspace, 'main', 'DEADBEEF', false);
        expect(metadata).toEqual({
            kind: 'patch-transfer',
            targetWorkspace: { id: 'ws-target', name: 'Target Repo' },
            targetBranch: 'main',
            stashed: false,
            targetHead: 'deadbeef',
            newCommitHash: 'deadbeef',
        });
    });

    it('omits the head fields when the hash is unusable', () => {
        const metadata = buildPatchTransferMetadata({}, targetWorkspace, 'main', undefined, true);
        expect(metadata.targetHead).toBeUndefined();
        expect(metadata.newCommitHash).toBeUndefined();
        expect(metadata.stashed).toBe(true);
    });

    it('nulls a target branch name that looks like a local path', () => {
        expect(buildPatchTransferMetadata({}, targetWorkspace, '/home/alice/main', 'abcd', false).targetBranch)
            .toBeNull();
    });

    it('carries sanitized source provenance across servers and workspaces', () => {
        const metadata = buildPatchTransferMetadata({
            sourceServer: { id: 'srv-remote', label: 'Desktop' },
            sourceWorkspace: { id: 'ws-source', name: 'Source Repo' },
            sourceCommit: { hash: 'AAAA', subject: 'feat: one' },
            sourceCommits: [{ hash: 'AAAA', subject: 'feat: one' }, { hash: 'bbbb', subject: 'feat: two' }],
            normalizedSourceRemoteUrl: 'git@github.com:org/repo.git',
        }, targetWorkspace, 'main', 'cccc', false);

        expect(metadata.sourceServer).toEqual({ id: 'srv-remote', label: 'Desktop' });
        expect(metadata.sourceWorkspace).toEqual({ id: 'ws-source', name: 'Source Repo' });
        expect(metadata.sourceCommit).toEqual({ hash: 'aaaa', subject: 'feat: one' });
        expect(metadata.sourceCommits).toHaveLength(2);
        expect(metadata.normalizedSourceRemoteUrl).toBeTruthy();
        expect(metadata.normalizedSourceRemoteUrl).not.toContain('git@');
    });

    it('preserves an explicit null remote — "no remote" differs from "not reported"', () => {
        expect(buildPatchTransferMetadata(
            { normalizedSourceRemoteUrl: null }, targetWorkspace, 'main', 'abcd', false,
        ).normalizedSourceRemoteUrl).toBeNull();

        expect('normalizedSourceRemoteUrl' in buildPatchTransferMetadata({}, targetWorkspace, 'main', 'abcd', false))
            .toBe(false);
    });

    it('drops a source remote that is a local clone path', () => {
        const metadata = buildPatchTransferMetadata(
            { normalizedSourceRemoteUrl: '/srv/git/repo.git' }, targetWorkspace, 'main', 'abcd', false,
        );
        expect('normalizedSourceRemoteUrl' in metadata).toBe(false);
    });

    it('drops source fields that are hostile or malformed', () => {
        const metadata = buildPatchTransferMetadata({
            sourceServer: 'not-a-record',
            sourceWorkspace: { name: 'no id here' },
            sourceCommit: { hash: 'zzzz' },
            sourceCommits: [],
        }, targetWorkspace, 'main', 'abcd', false);

        expect(metadata.sourceServer).toBeUndefined();
        expect(metadata.sourceWorkspace).toBeUndefined();
        expect(metadata.sourceCommit).toBeUndefined();
        expect(metadata.sourceCommits).toBeUndefined();
    });

    it('omits a target workspace name that looks like a path', () => {
        const ws = { id: 'ws-1', name: 'C:\\repos\\thing', rootPath: 'C:\\repos\\thing' } as WorkspaceInfo;
        expect(buildPatchTransferMetadata({}, ws, 'main', 'abcd', false).targetWorkspace).toEqual({ id: 'ws-1' });
    });
});
