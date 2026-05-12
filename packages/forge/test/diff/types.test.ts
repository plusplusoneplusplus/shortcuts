/**
 * Tests for unified diff provider types.
 *
 * Verifies type-level contracts and discriminated union narrowing.
 */

import { describe, it, expect } from 'vitest';
import type {
    DiffSourceKind,
    DiffSource,
    CommitDiffSource,
    RangeDiffSource,
    WorkingTreeDiffSource,
    PullRequestDiffSource,
    PullRequestIterationDiffSource,
    DiffFileEntry,
    DiffContent,
    DiffSummary,
    IDiffProvider,
    GetFileDiffOptions,
} from '../../src/diff/types';

describe('diff/types', () => {
    describe('DiffSourceKind', () => {
        it('accepts all five source kinds', () => {
            const kinds: DiffSourceKind[] = ['commit', 'range', 'working-tree', 'pr', 'pr-iteration'];
            expect(kinds).toHaveLength(5);
        });
    });

    describe('DiffSource discriminated union', () => {
        it('narrows CommitDiffSource by kind', () => {
            const source: DiffSource = {
                kind: 'commit',
                repositoryRoot: '/repo',
                commitHash: 'abc123',
            };
            if (source.kind === 'commit') {
                expect(source.commitHash).toBe('abc123');
            }
        });

        it('narrows RangeDiffSource by kind', () => {
            const source: DiffSource = {
                kind: 'range',
                repositoryRoot: '/repo',
                baseRef: 'origin/main',
                headRef: 'HEAD',
            };
            if (source.kind === 'range') {
                expect(source.baseRef).toBe('origin/main');
                expect(source.headRef).toBe('HEAD');
            }
        });

        it('narrows WorkingTreeDiffSource by kind', () => {
            const source: DiffSource = {
                kind: 'working-tree',
                repositoryRoot: '/repo',
                scope: 'staged',
            };
            if (source.kind === 'working-tree') {
                expect(source.scope).toBe('staged');
            }
        });

        it('narrows PullRequestDiffSource by kind', () => {
            const source: DiffSource = {
                kind: 'pr',
                repositoryRoot: '/repo',
                provider: 'github',
                remoteRepositoryId: 'owner/repo',
                pullRequestId: 42,
            };
            if (source.kind === 'pr') {
                expect(source.provider).toBe('github');
                expect(source.pullRequestId).toBe(42);
            }
        });

        it('narrows PullRequestIterationDiffSource by kind', () => {
            const source: DiffSource = {
                kind: 'pr-iteration',
                repositoryRoot: '/repo',
                provider: 'ado',
                remoteRepositoryId: 'my-repo',
                pullRequestId: 7,
                iterationId: 3,
                baseIterationId: 1,
            };
            if (source.kind === 'pr-iteration') {
                expect(source.iterationId).toBe(3);
                expect(source.baseIterationId).toBe(1);
            }
        });
    });

    describe('DiffFileEntry', () => {
        it('supports minimal required fields', () => {
            const entry: DiffFileEntry = {
                path: 'src/foo.ts',
                status: 'modified',
            };
            expect(entry.path).toBe('src/foo.ts');
            expect(entry.originalPath).toBeUndefined();
            expect(entry.additions).toBeUndefined();
        });

        it('supports full set of optional fields', () => {
            const entry: DiffFileEntry = {
                path: 'src/new.ts',
                originalPath: 'src/old.ts',
                status: 'renamed',
                additions: 10,
                deletions: 5,
                isBinary: false,
            };
            expect(entry.originalPath).toBe('src/old.ts');
            expect(entry.isBinary).toBe(false);
        });
    });

    describe('DiffContent', () => {
        it('has expected shape', () => {
            const content: DiffContent = {
                raw: 'diff --git a/f b/f\n',
                truncated: false,
                totalLines: 1,
            };
            expect(content.raw).toContain('diff --git');
            expect(content.truncated).toBe(false);
        });
    });

    describe('DiffSummary', () => {
        it('has expected shape', () => {
            const summary: DiffSummary = {
                filesChanged: 3,
                additions: 100,
                deletions: 50,
            };
            expect(summary.filesChanged).toBe(3);
        });
    });

    describe('GetFileDiffOptions', () => {
        it('allows empty options', () => {
            const opts: GetFileDiffOptions = {};
            expect(opts.full).toBeUndefined();
        });

        it('accepts full flag', () => {
            const opts: GetFileDiffOptions = { full: true };
            expect(opts.full).toBe(true);
        });
    });

    describe('IDiffProvider interface shape', () => {
        it('can be implemented as a mock', async () => {
            const mockProvider: IDiffProvider = {
                source: { kind: 'commit', repositoryRoot: '/repo', commitHash: 'abc' },
                listFiles: async () => [{ path: 'a.ts', status: 'modified' }],
                getFileDiff: async () => ({ raw: '', truncated: false, totalLines: 0 }),
                getFullDiff: async () => ({ raw: '', truncated: false, totalLines: 0 }),
                prefetchAll: async () => new Map(),
                getSummary: async () => ({ filesChanged: 1, additions: 0, deletions: 0 }),
            };
            const files = await mockProvider.listFiles();
            expect(files).toHaveLength(1);
            expect(mockProvider.source.kind).toBe('commit');
        });
    });
});
