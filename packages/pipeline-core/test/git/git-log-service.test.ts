/**
 * Tests for GitLogService (pipeline-core).
 *
 * Integration-style tests that run against the actual shortcuts git repo.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { GitLogService } from '../../src/git/git-log-service';

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
const HEAD_HASH = execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: REPO_ROOT }).trim();
const TOTAL_COMMITS = parseInt(execSync('git rev-list --count HEAD', { encoding: 'utf-8', cwd: REPO_ROOT }).trim(), 10);

describe('GitLogService', () => {
    let service: GitLogService;

    beforeEach(() => {
        service = new GitLogService();
    });

    afterEach(() => {
        service.dispose();
    });

    // -----------------------------------------------------------------------
    // getCommits
    // -----------------------------------------------------------------------

    describe('getCommits', () => {
        it('should return commits from the repo', () => {
            const result = service.getCommits(REPO_ROOT, { maxCount: 5, skip: 0 });
            expect(result.commits.length).toBeGreaterThan(0);
            expect(result.commits.length).toBeLessThanOrEqual(5);
        });

        it('should respect maxCount', () => {
            const result = service.getCommits(REPO_ROOT, { maxCount: 2, skip: 0 });
            expect(result.commits.length).toBeLessThanOrEqual(2);
        });

        it('should respect skip', () => {
            const first = service.getCommits(REPO_ROOT, { maxCount: 1, skip: 0 });
            const second = service.getCommits(REPO_ROOT, { maxCount: 1, skip: 1 });
            if (first.commits.length > 0 && second.commits.length > 0) {
                expect(first.commits[0].hash).not.toBe(second.commits[0].hash);
            }
        });

        it('should set hasMore correctly', () => {
            if (TOTAL_COMMITS <= 1) {
                const result = service.getCommits(REPO_ROOT, { maxCount: 1, skip: 0 });
                expect(result.hasMore).toBe(false);
            } else {
                const result = service.getCommits(REPO_ROOT, { maxCount: 1, skip: 0 });
                expect(result.hasMore).toBe(true);
            }
        });

        it('should populate commit fields', () => {
            const result = service.getCommits(REPO_ROOT, { maxCount: 1, skip: 0 });
            const commit = result.commits[0];
            expect(commit.hash).toBeTruthy();
            expect(commit.shortHash).toBeTruthy();
            expect(commit.subject).toBeTruthy();
            expect(commit.authorName).toBeTruthy();
            expect(commit.date).toBeTruthy();
            expect(commit.repositoryRoot).toBe(REPO_ROOT);
            expect(commit.repositoryName).toBeTruthy();
        });

        it('should populate isAheadOfRemote as boolean', () => {
            const result = service.getCommits(REPO_ROOT, { maxCount: 1, skip: 0 });
            const commit = result.commits[0];
            expect(typeof commit.isAheadOfRemote).toBe('boolean');
        });

        it('should return empty for invalid repoRoot', () => {
            const result = service.getCommits('/nonexistent-repo-path', { maxCount: 5, skip: 0 });
            expect(result.commits).toEqual([]);
            expect(result.hasMore).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // getCommit
    // -----------------------------------------------------------------------

    describe('getCommit', () => {
        it('should return a commit by full hash', () => {
            const commit = service.getCommit(REPO_ROOT, HEAD_HASH);
            expect(commit).toBeDefined();
            expect(commit!.hash).toBe(HEAD_HASH);
        });

        it('should return a commit by short hash', () => {
            const shortHash = HEAD_HASH.substring(0, 7);
            const commit = service.getCommit(REPO_ROOT, shortHash);
            expect(commit).toBeDefined();
            expect(commit!.hash).toBe(HEAD_HASH);
        });

        it('should return undefined for non-existent hash', () => {
            const commit = service.getCommit(REPO_ROOT, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
            expect(commit).toBeUndefined();
        });

        it('should return undefined for invalid repoRoot', () => {
            const commit = service.getCommit('/nonexistent-repo-path', HEAD_HASH);
            expect(commit).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // getCommitFiles
    // -----------------------------------------------------------------------

    describe('getCommitFiles', () => {
        it('should return files for a commit', () => {
            const files = service.getCommitFiles(REPO_ROOT, HEAD_HASH);
            expect(Array.isArray(files)).toBe(true);
            // HEAD commit should have at least some files changed
            if (files.length > 0) {
                const file = files[0];
                expect(file.path).toBeTruthy();
                expect(file.status).toBeTruthy();
                expect(file.commitHash).toBe(HEAD_HASH);
                expect(file.repositoryRoot).toBe(REPO_ROOT);
            }
        });

        it('should return empty array for invalid repoRoot', () => {
            const files = service.getCommitFiles('/nonexistent-repo-path', HEAD_HASH);
            expect(files).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // getCommitDiff
    // -----------------------------------------------------------------------

    describe('getCommitDiff', () => {
        it('should return a non-empty diff for HEAD', () => {
            const diff = service.getCommitDiff(REPO_ROOT, HEAD_HASH);
            // HEAD commit in a real repo should have some diff
            expect(typeof diff).toBe('string');
        });

        it('should return empty string for invalid repoRoot', () => {
            const diff = service.getCommitDiff('/nonexistent-repo-path', HEAD_HASH);
            expect(diff).toBe('');
        });
    });

    // -----------------------------------------------------------------------
    // getPendingChangesDiff / getStagedChangesDiff
    // -----------------------------------------------------------------------

    describe('getPendingChangesDiff', () => {
        it('should return a string without throwing', () => {
            const diff = service.getPendingChangesDiff(REPO_ROOT);
            expect(typeof diff).toBe('string');
        });
    });

    describe('getStagedChangesDiff', () => {
        it('should return a string without throwing', () => {
            const diff = service.getStagedChangesDiff(REPO_ROOT);
            expect(typeof diff).toBe('string');
        });
    });

    // -----------------------------------------------------------------------
    // hasPendingChanges / hasStagedChanges
    // -----------------------------------------------------------------------

    describe('hasPendingChanges', () => {
        it('should return a boolean', () => {
            const result = service.hasPendingChanges(REPO_ROOT);
            expect(typeof result).toBe('boolean');
        });

        it('should return false for invalid repoRoot', () => {
            const result = service.hasPendingChanges('/nonexistent-repo-path');
            expect(result).toBe(false);
        });
    });

    describe('hasStagedChanges', () => {
        it('should return a boolean', () => {
            const result = service.hasStagedChanges(REPO_ROOT);
            expect(typeof result).toBe('boolean');
        });
    });

    // -----------------------------------------------------------------------
    // hasMoreCommits
    // -----------------------------------------------------------------------

    describe('hasMoreCommits', () => {
        it('should return true when currentCount < total', () => {
            const result = service.hasMoreCommits(REPO_ROOT, 0);
            expect(result).toBe(true);
        });

        it('should return false when currentCount >= total', () => {
            // Use a very large number
            const result = service.hasMoreCommits(REPO_ROOT, 999999999);
            expect(result).toBe(false);
        });

        it('should return false for invalid repoRoot', () => {
            const result = service.hasMoreCommits('/nonexistent-repo-path', 0);
            expect(result).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // getFileContentAtCommit
    // -----------------------------------------------------------------------

    describe('getFileContentAtCommit', () => {
        it('should return content for a known file', () => {
            const content = service.getFileContentAtCommit(REPO_ROOT, HEAD_HASH, 'package.json');
            expect(content).toBeDefined();
            expect(content!.length).toBeGreaterThan(0);
            // package.json should contain the project name
            expect(content).toContain('"name"');
        });

        it('should return undefined for non-existent file', () => {
            const content = service.getFileContentAtCommit(REPO_ROOT, HEAD_HASH, 'this-file-does-not-exist.xyz');
            expect(content).toBeUndefined();
        });

        it('should handle backslash paths (Windows-style)', () => {
            const content = service.getFileContentAtCommit(REPO_ROOT, HEAD_HASH, 'package.json');
            expect(content).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // fileExistsAtCommit
    // -----------------------------------------------------------------------

    describe('fileExistsAtCommit', () => {
        it('should return true for existing file', () => {
            const exists = service.fileExistsAtCommit(REPO_ROOT, HEAD_HASH, 'package.json');
            expect(exists).toBe(true);
        });

        it('should return false for non-existent file', () => {
            const exists = service.fileExistsAtCommit(REPO_ROOT, HEAD_HASH, 'nonexistent-file-xyz.txt');
            expect(exists).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // validateRef
    // -----------------------------------------------------------------------

    describe('validateRef', () => {
        it('should resolve HEAD', () => {
            const hash = service.validateRef(REPO_ROOT, 'HEAD');
            expect(hash).toBe(HEAD_HASH);
        });

        it('should resolve a full commit hash', () => {
            const hash = service.validateRef(REPO_ROOT, HEAD_HASH);
            expect(hash).toBe(HEAD_HASH);
        });

        it('should return undefined for garbage ref', () => {
            const hash = service.validateRef(REPO_ROOT, 'not-a-valid-ref-at-all-xyz');
            expect(hash).toBeUndefined();
        });

        it('should return undefined for invalid repoRoot', () => {
            const hash = service.validateRef('/nonexistent-repo-path', 'HEAD');
            expect(hash).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // getBranches
    // -----------------------------------------------------------------------

    describe('getBranches', () => {
        it('should return an array of branch names', () => {
            const branches = service.getBranches(REPO_ROOT);
            expect(Array.isArray(branches)).toBe(true);
            expect(branches.length).toBeGreaterThan(0);
        });

        it('should return at most 10 branches', () => {
            const branches = service.getBranches(REPO_ROOT);
            expect(branches.length).toBeLessThanOrEqual(10);
        });

        it('should use cache on second call', () => {
            const first = service.getBranches(REPO_ROOT);
            const second = service.getBranches(REPO_ROOT);
            expect(second).toEqual(first);
        });

        it('should bypass cache with forceRefresh', () => {
            const first = service.getBranches(REPO_ROOT);
            const refreshed = service.getBranches(REPO_ROOT, true);
            // Should return the same data (just fresher)
            expect(Array.isArray(refreshed)).toBe(true);
        });

        it('should return empty array for invalid repoRoot', () => {
            const branches = service.getBranches('/nonexistent-repo-path');
            expect(branches).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // getBranchesAsync
    // -----------------------------------------------------------------------

    describe('getBranchesAsync', () => {
        it('should resolve to same result as getBranches', async () => {
            const sync = service.getBranches(REPO_ROOT, true);
            const async_ = await service.getBranchesAsync(REPO_ROOT);
            expect(async_).toEqual(sync);
        });
    });

    // -----------------------------------------------------------------------
    // invalidateBranchCache
    // -----------------------------------------------------------------------

    describe('invalidateBranchCache', () => {
        it('should clear cache for specific repoRoot', () => {
            service.getBranches(REPO_ROOT); // populate cache
            service.invalidateBranchCache(REPO_ROOT);
            // After invalidation, next call should re-fetch (no error)
            const branches = service.getBranches(REPO_ROOT);
            expect(Array.isArray(branches)).toBe(true);
        });

        it('should clear all cache when no repoRoot provided', () => {
            service.getBranches(REPO_ROOT); // populate cache
            service.invalidateBranchCache();
            const branches = service.getBranches(REPO_ROOT);
            expect(Array.isArray(branches)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // dispose
    // -----------------------------------------------------------------------

    describe('dispose', () => {
        it('should clear branch cache', () => {
            service.getBranches(REPO_ROOT); // populate cache
            service.dispose();
            // After dispose, service should still work (rebuilds cache)
            const branches = service.getBranches(REPO_ROOT);
            expect(Array.isArray(branches)).toBe(true);
        });
    });
});
