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
    execFileSync: vi.fn(),
    execFile: vi.fn(),
}));

vi.mock('../../src/git/safe-directory', () => ({
    ensureGitSafeDirectorySync: vi.fn(),
    ensureGitSafeDirectoryAsync: vi.fn(),
}));

vi.mock('../../src/utils/workspace-execution', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/workspace-execution')>();
    return {
        ...actual,
        getWslExecutablePath: vi.fn().mockReturnValue('C:\\Windows\\System32\\wsl.exe'),
        resolveWorkspaceExecutionContext: vi.fn((workingDirectory?: string) => {
            if (workingDirectory?.startsWith('\\\\wsl$')) {
                return actual.resolveWorkspaceExecutionContext(workingDirectory);
            }
            return { kind: 'windows', workingDirectory };
        }),
    };
});

import { execFileSync, execSync } from 'child_process';
import { ensureGitSafeDirectorySync } from '../../src/git/safe-directory';
const mockExecSync = vi.mocked(execSync);
const mockExecFileSync = vi.mocked(execFileSync);
const mockEnsureGitSafeDirectorySync = vi.mocked(ensureGitSafeDirectorySync);
const nativeRepoRoot = process.platform === 'win32' ? String.raw`C:\repo` : '/repo';
const nativeNestedRepoRoot = process.platform === 'win32' ? String.raw`C:\my\repo` : '/my/repo';
const badRepoRoot = process.platform === 'win32' ? String.raw`C:\bad-repo` : '/bad-repo';
const otherDir = process.platform === 'win32' ? String.raw`C:\other\dir` : '/other/dir';

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
        vi.clearAllMocks();
        mockExecSync.mockReset();
        mockExecFileSync.mockReset();
    });

    it('should return trimmed output on success', () => {
        mockExecFileSync.mockReturnValue('hello world\n');
        const result = execGit(['status', '--short'], nativeRepoRoot);
        expect(result).toBe('hello world');
    });

    it('should strip Windows-style trailing newline', () => {
        mockExecFileSync.mockReturnValue('output\r\n');
        const result = execGit(['log'], nativeRepoRoot);
        expect(result).toBe('output');
    });

    it('should call execFileSync with git and args array (no shell joining)', () => {
        mockExecFileSync.mockReturnValue('');
        execGit(['log', '--oneline', '-5'], nativeNestedRepoRoot);
        expect(mockExecFileSync).toHaveBeenCalledWith(
            'git',
            ['-C', nativeNestedRepoRoot, 'log', '--oneline', '-5'],
            expect.objectContaining({ encoding: 'utf-8' }),
        );
    });

    it('should pass default maxBuffer, timeout, and encoding', () => {
        mockExecFileSync.mockReturnValue('');
        execGit(['status'], nativeRepoRoot);
        expect(mockExecFileSync).toHaveBeenCalledWith(
            'git',
            expect.any(Array),
            expect.objectContaining({
                maxBuffer: 50 * 1024 * 1024,
                timeout: 30_000,
                encoding: 'utf-8',
            }),
        );
    });

    it('should allow overriding maxBuffer and timeout', () => {
        mockExecFileSync.mockReturnValue('');
        const opts: ExecGitOptions = { maxBuffer: 1024, timeout: 5000 };
        execGit(['diff'], nativeRepoRoot, opts);
        expect(mockExecFileSync).toHaveBeenCalledWith(
            'git',
            expect.any(Array),
            expect.objectContaining({
                maxBuffer: 1024,
                timeout: 5000,
            }),
        );
    });

    it('should pass cwd when provided', () => {
        mockExecFileSync.mockReturnValue('');
        execGit(['status'], nativeRepoRoot, { cwd: otherDir });
        expect(mockExecFileSync).toHaveBeenCalledWith(
            'git',
            expect.any(Array),
            expect.objectContaining({ cwd: otherDir }),
        );
    });

    it('should throw a descriptive error when git command fails', () => {
        const error = new Error('Command failed') as Error & { stderr: string };
        error.stderr = 'fatal: not a git repository';
        mockExecFileSync.mockImplementation(() => { throw error; });
        expect(() => execGit(['log'], badRepoRoot)).toThrow(
            'git log failed: fatal: not a git repository',
        );
    });

    it('should handle paths with spaces without shell corruption', () => {
        mockExecFileSync.mockReturnValue('main\n');
        const spacedPath = process.platform === 'win32'
            ? String.raw`C:\My Projects\my repo`
            : '/Users/John Doe/my repo';
        execGit(['status'], spacedPath);
        expect(mockExecFileSync).toHaveBeenCalledWith(
            'git',
            ['-C', spacedPath, 'status'],
            expect.anything(),
        );
    });

    it('passes special characters in args directly without shell escaping', () => {
        mockExecFileSync.mockReturnValue('');
        execGit(['log', 'abc123^!'], nativeRepoRoot);
        expect(mockExecFileSync).toHaveBeenCalledWith(
            'git',
            ['-C', nativeRepoRoot, 'log', 'abc123^!'],
            expect.objectContaining({ encoding: 'utf-8' }),
        );
    });

    it('should handle errors without stderr gracefully', () => {
        mockExecFileSync.mockImplementation(() => { throw new Error('fail'); });
        expect(() => execGit(['status'], nativeRepoRoot)).toThrow('git status failed:');
    });

    it.runIf(process.platform === 'win32')('routes WSL repos through wsl.exe', () => {
        const repoRoot = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        mockExecFileSync.mockReturnValue('main\n');

        const result = execGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);

        expect(result).toBe('main');
        expect(mockEnsureGitSafeDirectorySync).toHaveBeenCalledWith(repoRoot);
        expect(mockExecFileSync).toHaveBeenCalledWith(
            expect.stringContaining('wsl.exe'),
            ['-d', 'Ubuntu', '--cd', '/home/tester/repo', '--', 'git', '-C', '/home/tester/repo', 'rev-parse', '--abbrev-ref', 'HEAD'],
            expect.objectContaining({
                encoding: 'utf-8',
                windowsHide: true,
            }),
        );
        expect(mockExecSync).not.toHaveBeenCalled();
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
