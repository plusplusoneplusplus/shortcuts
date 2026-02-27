/**
 * Tests for the git module: types, constants, and exec helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    GitChangeStatus,
    GitChangeStage,
    GitChange,
    GitChangeCounts,
    GitCommit,
    CommitLoadOptions,
    CommitLoadResult,
    GitCommitFile,
    GitCommentCounts,
    GitCommitRange,
    GitCommitRangeFile,
    STATUS_SHORT,
    STAGE_PREFIX,
    STAGE_LABEL,
    ExecGitOptions,
    execGit,
} from '../../src/git';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

// ---------------------------------------------------------------------------
// Type smoke tests
// ---------------------------------------------------------------------------

describe('Git types', () => {
    it('should construct a valid GitChange with filePath instead of uri', () => {
        const change: GitChange = {
            filePath: '/repo/src/index.ts',
            status: 'modified',
            stage: 'staged',
            repositoryRoot: '/repo',
            repositoryName: 'repo',
        };
        expect(change.filePath).toBe('/repo/src/index.ts');
        expect(change.status).toBe('modified');
        expect(change.stage).toBe('staged');
    });

    it('should construct a GitChange with optional originalPath', () => {
        const change: GitChange = {
            filePath: '/repo/new-name.ts',
            originalPath: '/repo/old-name.ts',
            status: 'renamed',
            stage: 'staged',
            repositoryRoot: '/repo',
            repositoryName: 'repo',
        };
        expect(change.originalPath).toBe('/repo/old-name.ts');
    });

    it('should construct a valid GitCommit', () => {
        const commit: GitCommit = {
            hash: 'abc123def456',
            shortHash: 'abc123d',
            subject: 'fix: resolve issue',
            authorName: 'Alice',
            authorEmail: 'alice@example.com',
            date: '2025-01-15T10:00:00Z',
            relativeDate: '2 hours ago',
            parentHashes: 'parent1',
            refs: ['HEAD', 'main'],
            repositoryRoot: '/repo',
            repositoryName: 'repo',
            isAheadOfRemote: true,
        };
        expect(commit.hash).toBe('abc123def456');
        expect(commit.isAheadOfRemote).toBe(true);
    });

    it('should construct CommitLoadOptions and CommitLoadResult', () => {
        const opts: CommitLoadOptions = { maxCount: 50, skip: 10 };
        const result: CommitLoadResult = {
            commits: [],
            hasMore: false,
        };
        expect(opts.maxCount).toBe(50);
        expect(result.hasMore).toBe(false);
    });

    it('should construct a valid GitCommitFile', () => {
        const file: GitCommitFile = {
            path: 'src/index.ts',
            status: 'added',
            commitHash: 'abc123',
            parentHash: 'def456',
            repositoryRoot: '/repo',
        };
        expect(file.path).toBe('src/index.ts');
        expect(file.status).toBe('added');
    });

    it('should construct GitChangeCounts', () => {
        const counts: GitChangeCounts = {
            staged: 3,
            unstaged: 1,
            untracked: 2,
            total: 6,
        };
        expect(counts.total).toBe(6);
    });

    it('should construct GitCommentCounts', () => {
        const counts: GitCommentCounts = {
            open: 5,
            resolved: 3,
            total: 8,
        };
        expect(counts.total).toBe(8);
    });

    it('should construct a valid GitCommitRange', () => {
        const range: GitCommitRange = {
            baseRef: 'origin/main',
            headRef: 'HEAD',
            commitCount: 3,
            files: [],
            additions: 42,
            deletions: 10,
            mergeBase: 'abc123',
            branchName: 'feature/x',
            repositoryRoot: '/repo',
            repositoryName: 'repo',
        };
        expect(range.commitCount).toBe(3);
        expect(range.branchName).toBe('feature/x');
    });

    it('should construct a valid GitCommitRangeFile', () => {
        const file: GitCommitRangeFile = {
            path: 'src/index.ts',
            status: 'modified',
            additions: 10,
            deletions: 2,
            oldPath: 'src/old-index.ts',
            repositoryRoot: '/repo',
        };
        expect(file.additions).toBe(10);
        expect(file.oldPath).toBe('src/old-index.ts');
    });
});

// ---------------------------------------------------------------------------
// Constants correctness
// ---------------------------------------------------------------------------

describe('Git constants', () => {
    const ALL_STATUSES: GitChangeStatus[] = [
        'modified', 'added', 'deleted', 'renamed',
        'copied', 'untracked', 'ignored', 'conflict',
    ];

    const ALL_STAGES: GitChangeStage[] = ['staged', 'unstaged', 'untracked'];

    describe('STATUS_SHORT', () => {
        it('should have an entry for every GitChangeStatus value', () => {
            for (const status of ALL_STATUSES) {
                expect(STATUS_SHORT).toHaveProperty(status);
                expect(typeof STATUS_SHORT[status]).toBe('string');
                expect(STATUS_SHORT[status].length).toBeGreaterThan(0);
            }
        });

        it('should map expected values', () => {
            expect(STATUS_SHORT['modified']).toBe('M');
            expect(STATUS_SHORT['added']).toBe('A');
            expect(STATUS_SHORT['deleted']).toBe('D');
            expect(STATUS_SHORT['renamed']).toBe('R');
            expect(STATUS_SHORT['copied']).toBe('C');
            expect(STATUS_SHORT['untracked']).toBe('U');
            expect(STATUS_SHORT['ignored']).toBe('I');
            expect(STATUS_SHORT['conflict']).toBe('!');
        });
    });

    describe('STAGE_PREFIX', () => {
        it('should have an entry for every GitChangeStage value', () => {
            for (const stage of ALL_STAGES) {
                expect(STAGE_PREFIX).toHaveProperty(stage);
                expect(typeof STAGE_PREFIX[stage]).toBe('string');
            }
        });

        it('should map expected values', () => {
            expect(STAGE_PREFIX['staged']).toBe('\u2713');   // ✓
            expect(STAGE_PREFIX['unstaged']).toBe('\u25CF'); // ●
            expect(STAGE_PREFIX['untracked']).toBe('?');
        });
    });

    describe('STAGE_LABEL', () => {
        it('should have an entry for every GitChangeStage value', () => {
            for (const stage of ALL_STAGES) {
                expect(STAGE_LABEL).toHaveProperty(stage);
                expect(typeof STAGE_LABEL[stage]).toBe('string');
            }
        });

        it('should map expected values', () => {
            expect(STAGE_LABEL['staged']).toBe('Staged');
            expect(STAGE_LABEL['unstaged']).toBe('Modified');
            expect(STAGE_LABEL['untracked']).toBe('Untracked');
        });
    });
});

// ---------------------------------------------------------------------------
// execGit
// ---------------------------------------------------------------------------

describe('execGit', () => {
    beforeEach(() => {
        mockExecSync.mockReset();
    });

    it('should return trimmed output on success', () => {
        mockExecSync.mockReturnValue('hello world\n');
        const result = execGit(['status', '--short'], '/repo');
        expect(result).toBe('hello world');
    });

    it('should strip Windows-style trailing newline', () => {
        mockExecSync.mockReturnValue('output\r\n');
        const result = execGit(['log'], '/repo');
        expect(result).toBe('output');
    });

    it('should build the correct command with -C flag', () => {
        mockExecSync.mockReturnValue('');
        execGit(['log', '--oneline', '-5'], '/my/repo');
        expect(mockExecSync).toHaveBeenCalledWith(
            'git -C /my/repo log --oneline -5',
            expect.objectContaining({ encoding: 'utf-8' }),
        );
    });

    it('should pass default maxBuffer, timeout, and encoding', () => {
        mockExecSync.mockReturnValue('');
        execGit(['status'], '/repo');
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                maxBuffer: 10 * 1024 * 1024,
                timeout: 30_000,
                encoding: 'utf-8',
            }),
        );
    });

    it('should allow overriding maxBuffer and timeout', () => {
        mockExecSync.mockReturnValue('');
        const opts: ExecGitOptions = { maxBuffer: 1024, timeout: 5000 };
        execGit(['diff'], '/repo', opts);
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                maxBuffer: 1024,
                timeout: 5000,
            }),
        );
    });

    it('should pass cwd when provided', () => {
        mockExecSync.mockReturnValue('');
        execGit(['status'], '/repo', { cwd: '/other/dir' });
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ cwd: '/other/dir' }),
        );
    });

    it('should throw a descriptive error when git command fails', () => {
        const error = new Error('Command failed') as Error & { stderr: string };
        error.stderr = 'fatal: not a git repository';
        mockExecSync.mockImplementation(() => { throw error; });
        expect(() => execGit(['log'], '/bad-repo')).toThrow(
            'git log failed: fatal: not a git repository',
        );
    });

    it('should handle errors without stderr gracefully', () => {
        mockExecSync.mockImplementation(() => { throw new Error('fail'); });
        expect(() => execGit(['status'], '/repo')).toThrow('git status failed:');
    });
});

// ---------------------------------------------------------------------------
// Barrel re-export
// ---------------------------------------------------------------------------

describe('Barrel re-export (git/index)', () => {
    it('should export all expected symbols from the barrel', () => {
        // Constants
        expect(STATUS_SHORT).toBeDefined();
        expect(STAGE_PREFIX).toBeDefined();
        expect(STAGE_LABEL).toBeDefined();

        // Function
        expect(typeof execGit).toBe('function');
    });

    it('should re-export types that compile correctly', () => {
        // These assignments confirm the types are importable and usable.
        const _change: GitChange = {
            filePath: '/a',
            status: 'added',
            stage: 'staged',
            repositoryRoot: '/r',
            repositoryName: 'r',
        };
        const _commit: GitCommit = {
            hash: 'h', shortHash: 's', subject: 'sub',
            authorName: 'a', authorEmail: 'e',
            date: 'd', relativeDate: 'rd',
            parentHashes: 'p', refs: [],
            repositoryRoot: '/r', repositoryName: 'r',
        };
        const _range: GitCommitRange = {
            baseRef: 'b', headRef: 'h', commitCount: 0,
            files: [], additions: 0, deletions: 0,
            mergeBase: 'm', repositoryRoot: '/r', repositoryName: 'r',
        };
        expect(_change).toBeDefined();
        expect(_commit).toBeDefined();
        expect(_range).toBeDefined();
    });
});
