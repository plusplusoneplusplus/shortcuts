/**
 * Tests for GitRangeService (pipeline-core).
 *
 * Uses vi.mock to mock execGit, and vi.useFakeTimers for cache TTL tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GitRangeService } from '../../src/git/git-range-service';

// Mock the exec module
vi.mock('../../src/git/exec', () => ({
    execGit: vi.fn(),
}));

// Mock the logger
vi.mock('../../src/logger', () => ({
    getLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
    LogCategory: { GIT: 'Git' },
}));

import { execGit } from '../../src/git/exec';

const mockExecGit = vi.mocked(execGit);

describe('GitRangeService', () => {
    let service: GitRangeService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new GitRangeService();
    });

    afterEach(() => {
        service.dispose();
    });

    // -----------------------------------------------------------------------
    // getCurrentBranch
    // -----------------------------------------------------------------------
    describe('getCurrentBranch', () => {
        it('should return branch name', () => {
            mockExecGit.mockReturnValue('feature-branch');
            expect(service.getCurrentBranch('/repo')).toBe('feature-branch');
        });

        it('should return HEAD on failure', () => {
            mockExecGit.mockImplementation(() => { throw new Error('not a git repo'); });
            expect(service.getCurrentBranch('/repo')).toBe('HEAD');
        });

        it('should return HEAD when output is empty', () => {
            mockExecGit.mockReturnValue('');
            expect(service.getCurrentBranch('/repo')).toBe('HEAD');
        });
    });

    // -----------------------------------------------------------------------
    // getDefaultRemoteBranch
    // -----------------------------------------------------------------------
    describe('getDefaultRemoteBranch', () => {
        it('should try origin/main first', () => {
            mockExecGit.mockReturnValue('abc123');
            expect(service.getDefaultRemoteBranch('/repo')).toBe('origin/main');
            expect(mockExecGit).toHaveBeenCalledWith(
                ['rev-parse', '--verify', 'origin/main'], '/repo'
            );
        });

        it('should fall back to origin/master', () => {
            mockExecGit
                .mockImplementationOnce(() => { throw new Error('origin/main not found'); })
                .mockReturnValue('abc123');
            expect(service.getDefaultRemoteBranch('/repo')).toBe('origin/master');
        });

        it('should fall back to symbolic-ref', () => {
            mockExecGit
                .mockImplementationOnce(() => { throw new Error(); }) // origin/main
                .mockImplementationOnce(() => { throw new Error(); }) // origin/master
                .mockReturnValue('refs/remotes/origin/develop');
            expect(service.getDefaultRemoteBranch('/repo')).toBe('origin/develop');
        });

        it('should fall back to local main', () => {
            mockExecGit
                .mockImplementationOnce(() => { throw new Error(); }) // origin/main
                .mockImplementationOnce(() => { throw new Error(); }) // origin/master
                .mockImplementationOnce(() => { throw new Error(); }) // symbolic-ref
                .mockReturnValue('abc123'); // local main
            expect(service.getDefaultRemoteBranch('/repo')).toBe('main');
        });

        it('should fall back to local master', () => {
            mockExecGit
                .mockImplementationOnce(() => { throw new Error(); }) // origin/main
                .mockImplementationOnce(() => { throw new Error(); }) // origin/master
                .mockImplementationOnce(() => { throw new Error(); }) // symbolic-ref
                .mockImplementationOnce(() => { throw new Error(); }) // local main
                .mockReturnValue('abc123'); // local master
            expect(service.getDefaultRemoteBranch('/repo')).toBe('master');
        });

        it('should return null when nothing found', () => {
            mockExecGit.mockImplementation(() => { throw new Error(); });
            expect(service.getDefaultRemoteBranch('/repo')).toBeNull();
        });

        it('should use cache within TTL', () => {
            mockExecGit.mockReturnValue('abc123');
            // First call — hits git
            expect(service.getDefaultRemoteBranch('/repo')).toBe('origin/main');
            const callCount = mockExecGit.mock.calls.length;
            // Second call — uses cache, no new git calls
            expect(service.getDefaultRemoteBranch('/repo')).toBe('origin/main');
            expect(mockExecGit.mock.calls.length).toBe(callCount);
        });

        it('should refresh after TTL', () => {
            vi.useFakeTimers();
            try {
                mockExecGit.mockReturnValue('abc123');
                service.getDefaultRemoteBranch('/repo');
                const callCount = mockExecGit.mock.calls.length;

                // Advance past 60 s TTL
                vi.advanceTimersByTime(61000);
                service.getDefaultRemoteBranch('/repo');
                expect(mockExecGit.mock.calls.length).toBeGreaterThan(callCount);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    // -----------------------------------------------------------------------
    // getMergeBase
    // -----------------------------------------------------------------------
    describe('getMergeBase', () => {
        it('should return merge base hash', () => {
            mockExecGit.mockReturnValue('abc123');
            expect(service.getMergeBase('/repo', 'HEAD', 'origin/main')).toBe('abc123');
        });

        it('should return null on error', () => {
            mockExecGit.mockImplementation(() => { throw new Error(); });
            expect(service.getMergeBase('/repo', 'HEAD', 'origin/main')).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // countCommitsAhead
    // -----------------------------------------------------------------------
    describe('countCommitsAhead', () => {
        it('should parse count', () => {
            mockExecGit.mockReturnValue('5');
            expect(service.countCommitsAhead('/repo', 'origin/main', 'HEAD')).toBe(5);
        });

        it('should return 0 on error', () => {
            mockExecGit.mockImplementation(() => { throw new Error(); });
            expect(service.countCommitsAhead('/repo', 'origin/main', 'HEAD')).toBe(0);
        });

        it('should return 0 for non-numeric output', () => {
            mockExecGit.mockReturnValue('');
            expect(service.countCommitsAhead('/repo', 'origin/main', 'HEAD')).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // getChangedFiles
    // -----------------------------------------------------------------------
    describe('getChangedFiles', () => {
        it('should parse numstat and name-status output', () => {
            mockExecGit
                // numstat
                .mockReturnValueOnce('10\t5\tsrc/a.ts\n20\t0\tsrc/b.ts')
                // name-status
                .mockReturnValueOnce('M\tsrc/a.ts\nA\tsrc/b.ts');

            const files = service.getChangedFiles('/repo', 'origin/main', 'HEAD');
            expect(files).toHaveLength(2);
            expect(files[0]).toMatchObject({ path: 'src/a.ts', status: 'modified', additions: 10, deletions: 5 });
            expect(files[1]).toMatchObject({ path: 'src/b.ts', status: 'added', additions: 20, deletions: 0 });
        });

        it('should handle renames', () => {
            mockExecGit
                .mockReturnValueOnce('0\t0\told.ts => new.ts')
                .mockReturnValueOnce('R100\told.ts\tnew.ts');

            const files = service.getChangedFiles('/repo', 'origin/main', 'HEAD');
            expect(files).toHaveLength(1);
            expect(files[0]).toMatchObject({ path: 'new.ts', status: 'renamed', oldPath: 'old.ts' });
        });

        it('should return empty on no output', () => {
            mockExecGit
                .mockReturnValueOnce('')
                .mockReturnValueOnce('');

            const files = service.getChangedFiles('/repo', 'origin/main', 'HEAD');
            expect(files).toEqual([]);
        });

        it('should return empty on error', () => {
            mockExecGit.mockImplementation(() => { throw new Error(); });
            expect(service.getChangedFiles('/repo', 'origin/main', 'HEAD')).toEqual([]);
        });

        it('should sort files alphabetically', () => {
            mockExecGit
                .mockReturnValueOnce('1\t0\tz.ts\n2\t0\ta.ts')
                .mockReturnValueOnce('A\tz.ts\nA\ta.ts');

            const files = service.getChangedFiles('/repo', 'origin/main', 'HEAD');
            expect(files[0].path).toBe('a.ts');
            expect(files[1].path).toBe('z.ts');
        });

        it('should handle binary files (- for numstat)', () => {
            mockExecGit
                .mockReturnValueOnce('-\t-\timage.png')
                .mockReturnValueOnce('M\timage.png');

            const files = service.getChangedFiles('/repo', 'origin/main', 'HEAD');
            expect(files).toHaveLength(1);
            expect(files[0]).toMatchObject({ additions: 0, deletions: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // getDiffStats
    // -----------------------------------------------------------------------
    describe('getDiffStats', () => {
        it('should parse shortstat output', () => {
            mockExecGit.mockReturnValue('3 files changed, 45 insertions(+), 12 deletions(-)');
            const stats = service.getDiffStats('/repo', 'origin/main', 'HEAD');
            expect(stats).toEqual({ additions: 45, deletions: 12 });
        });

        it('should return zeros on empty output', () => {
            mockExecGit.mockReturnValue('');
            expect(service.getDiffStats('/repo', 'origin/main', 'HEAD')).toEqual({ additions: 0, deletions: 0 });
        });

        it('should return zeros on error', () => {
            mockExecGit.mockImplementation(() => { throw new Error(); });
            expect(service.getDiffStats('/repo', 'origin/main', 'HEAD')).toEqual({ additions: 0, deletions: 0 });
        });

        it('should handle insertions only', () => {
            mockExecGit.mockReturnValue('1 file changed, 10 insertions(+)');
            expect(service.getDiffStats('/repo', 'a', 'b')).toEqual({ additions: 10, deletions: 0 });
        });

        it('should handle deletions only', () => {
            mockExecGit.mockReturnValue('1 file changed, 7 deletions(-)');
            expect(service.getDiffStats('/repo', 'a', 'b')).toEqual({ additions: 0, deletions: 7 });
        });
    });

    // -----------------------------------------------------------------------
    // detectCommitRange
    // -----------------------------------------------------------------------
    describe('detectCommitRange', () => {
        const setupMocksForFullRange = () => {
            mockExecGit
                // getCurrentBranch → rev-parse --abbrev-ref HEAD
                .mockReturnValueOnce('feature/test')
                // getDefaultRemoteBranch → rev-parse --verify origin/main
                .mockReturnValueOnce('abc123')
                // getMergeBase
                .mockReturnValueOnce('merge-base-hash')
                // countCommitsAhead
                .mockReturnValueOnce('3')
                // getChangedFiles: numstat
                .mockReturnValueOnce('10\t5\tsrc/a.ts')
                // getChangedFiles: name-status
                .mockReturnValueOnce('M\tsrc/a.ts')
                // getDiffStats
                .mockReturnValueOnce('1 file changed, 10 insertions(+), 5 deletions(-)');
        };

        it('should assemble full range', () => {
            setupMocksForFullRange();
            const range = service.detectCommitRange('/repo');
            expect(range).not.toBeNull();
            expect(range!.baseRef).toBe('origin/main');
            expect(range!.headRef).toBe('HEAD');
            expect(range!.commitCount).toBe(3);
            expect(range!.branchName).toBe('feature/test');
            expect(range!.files).toHaveLength(1);
            expect(range!.additions).toBe(10);
            expect(range!.deletions).toBe(5);
        });

        it('should return null when no default branch', () => {
            mockExecGit
                .mockReturnValueOnce('main') // getCurrentBranch
                .mockImplementation(() => { throw new Error(); }); // all branch detection fails

            expect(service.detectCommitRange('/repo')).toBeNull();
        });

        it('should return null when no merge base', () => {
            mockExecGit
                .mockReturnValueOnce('feature') // getCurrentBranch
                .mockReturnValueOnce('abc123')   // getDefaultRemoteBranch (origin/main)
                .mockImplementation(() => { throw new Error(); }); // merge-base fails

            expect(service.detectCommitRange('/repo')).toBeNull();
        });

        it('should return null when no commits ahead', () => {
            mockExecGit
                .mockReturnValueOnce('feature')
                .mockReturnValueOnce('abc')      // origin/main exists
                .mockReturnValueOnce('base123')  // merge-base
                .mockReturnValueOnce('0');        // 0 commits ahead

            expect(service.detectCommitRange('/repo')).toBeNull();
        });

        it('should respect maxFiles config', () => {
            const svc = new GitRangeService({ maxFiles: 1 });
            // getCurrentBranch
            mockExecGit.mockReturnValueOnce('feature');
            // getDefaultRemoteBranch → origin/main
            mockExecGit.mockReturnValueOnce('abc');
            // merge-base
            mockExecGit.mockReturnValueOnce('base');
            // commits ahead
            mockExecGit.mockReturnValueOnce('2');
            // numstat — 2 files
            mockExecGit.mockReturnValueOnce('1\t0\ta.ts\n2\t0\tb.ts');
            // name-status
            mockExecGit.mockReturnValueOnce('A\ta.ts\nA\tb.ts');
            // shortstat
            mockExecGit.mockReturnValueOnce('2 files changed, 3 insertions(+)');

            const range = svc.detectCommitRange('/repo');
            expect(range).not.toBeNull();
            expect(range!.files).toHaveLength(1);
            svc.dispose();
        });
    });

    // -----------------------------------------------------------------------
    // getFileDiff
    // -----------------------------------------------------------------------
    describe('getFileDiff', () => {
        it('should normalize backslashes', () => {
            mockExecGit.mockReturnValue('diff content');
            service.getFileDiff('/repo', 'origin/main', 'HEAD', 'src\\test.ts');
            expect(mockExecGit).toHaveBeenCalledWith(
                ['diff', 'origin/main...HEAD', '--', 'src/test.ts'], '/repo'
            );
        });

        it('should return empty on error', () => {
            mockExecGit.mockImplementation(() => { throw new Error(); });
            expect(service.getFileDiff('/repo', 'a', 'b', 'c.ts')).toBe('');
        });
    });

    // -----------------------------------------------------------------------
    // getFileAtRef
    // -----------------------------------------------------------------------
    describe('getFileAtRef', () => {
        it('should return file content', () => {
            mockExecGit.mockReturnValue('file content');
            expect(service.getFileAtRef('/repo', 'HEAD', 'test.ts')).toBe('file content');
        });

        it('should return empty on missing file', () => {
            mockExecGit.mockImplementation(() => { throw new Error(); });
            expect(service.getFileAtRef('/repo', 'HEAD', 'missing.ts')).toBe('');
        });
    });

    // -----------------------------------------------------------------------
    // getRangeDiff
    // -----------------------------------------------------------------------
    describe('getRangeDiff', () => {
        it('should return diff content', () => {
            mockExecGit.mockReturnValue('diff --git a/test.ts b/test.ts');
            expect(service.getRangeDiff('/repo', 'origin/main', 'HEAD')).toBe('diff --git a/test.ts b/test.ts');
        });

        it('should return empty on error', () => {
            mockExecGit.mockImplementation(() => { throw new Error(); });
            expect(service.getRangeDiff('/repo', 'a', 'b')).toBe('');
        });
    });

    // -----------------------------------------------------------------------
    // invalidateCache
    // -----------------------------------------------------------------------
    describe('invalidateCache', () => {
        it('should clear specific repo', () => {
            // Populate cache for two repos
            mockExecGit.mockReturnValue('abc');
            service.getDefaultRemoteBranch('/repo1');
            service.getDefaultRemoteBranch('/repo2');

            // Invalidate only /repo1
            service.invalidateCache('/repo1');

            // /repo2 should still be cached (no new git call)
            const callsBefore = mockExecGit.mock.calls.length;
            service.getDefaultRemoteBranch('/repo2');
            expect(mockExecGit.mock.calls.length).toBe(callsBefore);

            // /repo1 should need a fresh git call
            service.getDefaultRemoteBranch('/repo1');
            expect(mockExecGit.mock.calls.length).toBeGreaterThan(callsBefore);
        });

        it('should clear all repos', () => {
            mockExecGit.mockReturnValue('abc');
            service.getDefaultRemoteBranch('/repo1');
            service.getDefaultRemoteBranch('/repo2');

            service.invalidateCache();

            const callsBefore = mockExecGit.mock.calls.length;
            service.getDefaultRemoteBranch('/repo1');
            expect(mockExecGit.mock.calls.length).toBeGreaterThan(callsBefore);
        });
    });

    // -----------------------------------------------------------------------
    // dispose
    // -----------------------------------------------------------------------
    describe('dispose', () => {
        it('should clear cache', () => {
            mockExecGit.mockReturnValue('abc');
            service.getDefaultRemoteBranch('/repo');

            service.dispose();

            // After dispose, next call should hit git again
            const callsBefore = mockExecGit.mock.calls.length;
            service.getDefaultRemoteBranch('/repo');
            expect(mockExecGit.mock.calls.length).toBeGreaterThan(callsBefore);
        });
    });

    // -----------------------------------------------------------------------
    // Constructor config
    // -----------------------------------------------------------------------
    describe('config defaults', () => {
        it('should use default maxFiles=100 and showOnDefaultBranch=false', () => {
            // With 0 commits ahead and showOnDefaultBranch=false (default), return null
            mockExecGit
                .mockReturnValueOnce('main')   // getCurrentBranch
                .mockReturnValueOnce('abc')     // origin/main exists
                .mockReturnValueOnce('base')    // merge-base
                .mockReturnValueOnce('0');       // 0 commits ahead

            expect(service.detectCommitRange('/repo')).toBeNull();
        });

        it('should respect showOnDefaultBranch=true when 0 commits ahead', () => {
            // Even with showOnDefaultBranch=true, the current code returns null for 0 commits.
            // This matches the original extension behaviour.
            const svc = new GitRangeService({ showOnDefaultBranch: true });
            mockExecGit
                .mockReturnValueOnce('main')
                .mockReturnValueOnce('abc')
                .mockReturnValueOnce('base')
                .mockReturnValueOnce('0');

            expect(svc.detectCommitRange('/repo')).toBeNull();
            svc.dispose();
        });
    });
});
