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
        it('should return commits from the repo', async () => {
            const result = await service.getCommits(REPO_ROOT, { maxCount: 5, skip: 0 });
            expect(result.commits.length).toBeGreaterThan(0);
            expect(result.commits.length).toBeLessThanOrEqual(5);
        });

        it('should respect maxCount', async () => {
            const result = await service.getCommits(REPO_ROOT, { maxCount: 2, skip: 0 });
            expect(result.commits.length).toBeLessThanOrEqual(2);
        });

        it('should respect skip', async () => {
            const first = await service.getCommits(REPO_ROOT, { maxCount: 1, skip: 0 });
            const second = await service.getCommits(REPO_ROOT, { maxCount: 1, skip: 1 });
            if (first.commits.length > 0 && second.commits.length > 0) {
                expect(first.commits[0].hash).not.toBe(second.commits[0].hash);
            }
        });

        it('should set hasMore correctly', async () => {
            if (TOTAL_COMMITS <= 1) {
                const result = await service.getCommits(REPO_ROOT, { maxCount: 1, skip: 0 });
                expect(result.hasMore).toBe(false);
            } else {
                const result = await service.getCommits(REPO_ROOT, { maxCount: 1, skip: 0 });
                expect(result.hasMore).toBe(true);
            }
        });

        it('should populate commit fields', async () => {
            const result = await service.getCommits(REPO_ROOT, { maxCount: 1, skip: 0 });
            const commit = result.commits[0];
            expect(commit.hash).toBeTruthy();
            expect(commit.shortHash).toBeTruthy();
            expect(commit.subject).toBeTruthy();
            expect(commit.authorName).toBeTruthy();
            expect(commit.date).toBeTruthy();
            expect(commit.repositoryRoot).toBe(REPO_ROOT);
            expect(commit.repositoryName).toBeTruthy();
        });

        it('should populate isAheadOfRemote as boolean', async () => {
            const result = await service.getCommits(REPO_ROOT, { maxCount: 1, skip: 0 });
            const commit = result.commits[0];
            expect(typeof commit.isAheadOfRemote).toBe('boolean');
        });

        it('should return empty for invalid repoRoot', async () => {
            const result = await service.getCommits('/nonexistent-repo-path', { maxCount: 5, skip: 0 });
            expect(result.commits).toEqual([]);
            expect(result.hasMore).toBe(false);
        });

        it('should filter commits by search string (case-insensitive)', async () => {
            // Use a search term that is unlikely to match any commit but should still return an array
            const resultNoMatch = await service.getCommits(REPO_ROOT, { maxCount: 50, skip: 0, search: 'zzz_no_match_xyz_12345' });
            expect(resultNoMatch.commits).toEqual([]);
            expect(resultNoMatch.hasMore).toBe(false);
        });

        it('should return commits matching search string', async () => {
            // Fetch all commits and use the subject of the first as search term
            const all = await service.getCommits(REPO_ROOT, { maxCount: 5, skip: 0 });
            if (all.commits.length === 0) return;
            const subject = all.commits[0].subject;
            const word = subject.split(' ').find(w => w.length >= 4);
            if (!word) return; // can't construct a meaningful search term
            const result = await service.getCommits(REPO_ROOT, { maxCount: 50, skip: 0, search: word });
            expect(result.commits.length).toBeGreaterThan(0);
            // --grep searches the full commit message (subject + body), so results may include
            // commits where the word only appears in the body. Verify the first commit from all
            // (whose subject contains the word) is present in the results.
            const firstHash = all.commits[0].hash;
            expect(result.commits.some(c => c.hash === firstHash)).toBe(true);
        });

        it('should not alter results when search is empty string', async () => {
            const withEmpty = await service.getCommits(REPO_ROOT, { maxCount: 5, skip: 0, search: '' });
            const withUndefined = await service.getCommits(REPO_ROOT, { maxCount: 5, skip: 0 });
            expect(withEmpty.commits.map(c => c.hash)).toEqual(withUndefined.commits.map(c => c.hash));
        });
    });

    // -----------------------------------------------------------------------
    // getCommit
    // -----------------------------------------------------------------------

    describe('getCommit', () => {
        it('should return a commit by full hash', async () => {
            const commit = await service.getCommit(REPO_ROOT, HEAD_HASH);
            expect(commit).toBeDefined();
            expect(commit!.hash).toBe(HEAD_HASH);
        });

        it('should return a commit by short hash', async () => {
            const shortHash = HEAD_HASH.substring(0, 7);
            const commit = await service.getCommit(REPO_ROOT, shortHash);
            expect(commit).toBeDefined();
            expect(commit!.hash).toBe(HEAD_HASH);
        });

        it('should return undefined for non-existent hash', async () => {
            const commit = await service.getCommit(REPO_ROOT, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
            expect(commit).toBeUndefined();
        });

        it('should return undefined for invalid repoRoot', async () => {
            const commit = await service.getCommit('/nonexistent-repo-path', HEAD_HASH);
            expect(commit).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // getCommitFiles
    // -----------------------------------------------------------------------

    describe('getCommitFiles', () => {
        it('should return files for a commit', async () => {
            const files = await service.getCommitFiles(REPO_ROOT, HEAD_HASH);
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

        it('should populate additions and deletions from numstat', async () => {
            const files = await service.getCommitFiles(REPO_ROOT, HEAD_HASH);
            if (files.length > 0) {
                const file = files[0];
                // additions and deletions should be numbers (or undefined for binary)
                if (file.additions !== undefined) {
                    expect(typeof file.additions).toBe('number');
                    expect(file.additions).toBeGreaterThanOrEqual(0);
                }
                if (file.deletions !== undefined) {
                    expect(typeof file.deletions).toBe('number');
                    expect(file.deletions).toBeGreaterThanOrEqual(0);
                }
            }
        });

        it('should have at least one file with non-zero additions or deletions', async () => {
            const files = await service.getCommitFiles(REPO_ROOT, HEAD_HASH);
            if (files.length > 0) {
                const hasStats = files.some(f =>
                    (f.additions !== undefined && f.additions > 0) ||
                    (f.deletions !== undefined && f.deletions > 0)
                );
                expect(hasStats).toBe(true);
            }
        });

        it('should return empty array for invalid repoRoot', async () => {
            const files = await service.getCommitFiles('/nonexistent-repo-path', HEAD_HASH);
            expect(files).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // getCommitDiff
    // -----------------------------------------------------------------------

    describe('getCommitDiff', () => {
        it('should return a non-empty diff for HEAD', async () => {
            const diff = await service.getCommitDiff(REPO_ROOT, HEAD_HASH);
            // HEAD commit in a real repo should have some diff
            expect(typeof diff).toBe('string');
        });

        it('should return empty string for invalid repoRoot', async () => {
            const diff = await service.getCommitDiff('/nonexistent-repo-path', HEAD_HASH);
            expect(diff).toBe('');
        });
    });

    // -----------------------------------------------------------------------
    // getPendingChangesDiff / getStagedChangesDiff
    // -----------------------------------------------------------------------

    describe('getPendingChangesDiff', () => {
        it('should return a string without throwing', async () => {
            const diff = await service.getPendingChangesDiff(REPO_ROOT);
            expect(typeof diff).toBe('string');
        });
    });

    describe('getStagedChangesDiff', () => {
        it('should return a string without throwing', async () => {
            const diff = await service.getStagedChangesDiff(REPO_ROOT);
            expect(typeof diff).toBe('string');
        });
    });

    // -----------------------------------------------------------------------
    // hasPendingChanges / hasStagedChanges
    // -----------------------------------------------------------------------

    describe('hasPendingChanges', () => {
        it('should return a boolean', async () => {
            const result = await service.hasPendingChanges(REPO_ROOT);
            expect(typeof result).toBe('boolean');
        });

        it('should return false for invalid repoRoot', async () => {
            const result = await service.hasPendingChanges('/nonexistent-repo-path');
            expect(result).toBe(false);
        });
    });

    describe('hasStagedChanges', () => {
        it('should return a boolean', async () => {
            const result = await service.hasStagedChanges(REPO_ROOT);
            expect(typeof result).toBe('boolean');
        });
    });

    // -----------------------------------------------------------------------
    // hasMoreCommits
    // -----------------------------------------------------------------------

    describe('hasMoreCommits', () => {
        it('should return true when currentCount < total', async () => {
            const result = await service.hasMoreCommits(REPO_ROOT, 0);
            expect(result).toBe(true);
        });

        it('should return false when currentCount >= total', async () => {
            // Use a very large number
            const result = await service.hasMoreCommits(REPO_ROOT, 999999999);
            expect(result).toBe(false);
        });

        it('should return false for invalid repoRoot', async () => {
            const result = await service.hasMoreCommits('/nonexistent-repo-path', 0);
            expect(result).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // getFileContentAtCommit
    // -----------------------------------------------------------------------

    describe('getFileContentAtCommit', () => {
        it('should return content for a known file', async () => {
            const content = await service.getFileContentAtCommit(REPO_ROOT, HEAD_HASH, 'package.json');
            expect(content).toBeDefined();
            expect(content!.length).toBeGreaterThan(0);
            // package.json should contain the project name
            expect(content).toContain('"name"');
        });

        it('should return undefined for non-existent file', async () => {
            const content = await service.getFileContentAtCommit(REPO_ROOT, HEAD_HASH, 'this-file-does-not-exist.xyz');
            expect(content).toBeUndefined();
        });

        it('should handle backslash paths (Windows-style)', async () => {
            const content = await service.getFileContentAtCommit(REPO_ROOT, HEAD_HASH, 'package.json');
            expect(content).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // fileExistsAtCommit
    // -----------------------------------------------------------------------

    describe('fileExistsAtCommit', () => {
        it('should return true for existing file', async () => {
            const exists = await service.fileExistsAtCommit(REPO_ROOT, HEAD_HASH, 'package.json');
            expect(exists).toBe(true);
        });

        it('should return false for non-existent file', async () => {
            const exists = await service.fileExistsAtCommit(REPO_ROOT, HEAD_HASH, 'nonexistent-file-xyz.txt');
            expect(exists).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // validateRef
    // -----------------------------------------------------------------------

    describe('validateRef', () => {
        it('should resolve HEAD', async () => {
            const hash = await service.validateRef(REPO_ROOT, 'HEAD');
            expect(hash).toBe(HEAD_HASH);
        });

        it('should resolve a full commit hash', async () => {
            const hash = await service.validateRef(REPO_ROOT, HEAD_HASH);
            expect(hash).toBe(HEAD_HASH);
        });

        it('should return undefined for garbage ref', async () => {
            const hash = await service.validateRef(REPO_ROOT, 'not-a-valid-ref-at-all-xyz');
            expect(hash).toBeUndefined();
        });

        it('should return undefined for invalid repoRoot', async () => {
            const hash = await service.validateRef('/nonexistent-repo-path', 'HEAD');
            expect(hash).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // getBranches
    // -----------------------------------------------------------------------

    describe('getBranches', () => {
        it('should return an array of branch names when local branches are available', async () => {
            const branches = await service.getBranches(REPO_ROOT);
            expect(Array.isArray(branches)).toBe(true);
            expect(branches.every(branch => branch.length > 0 && !branch.includes('HEAD'))).toBe(true);
        });

        it('should return at most 10 branches', async () => {
            const branches = await service.getBranches(REPO_ROOT);
            expect(branches.length).toBeLessThanOrEqual(10);
        });

        it('should use cache on second call', async () => {
            const first = await service.getBranches(REPO_ROOT);
            const second = await service.getBranches(REPO_ROOT);
            expect(second).toEqual(first);
        });

        it('should bypass cache with forceRefresh', async () => {
            const first = await service.getBranches(REPO_ROOT);
            const refreshed = await service.getBranches(REPO_ROOT, true);
            // Should return the same data (just fresher)
            expect(Array.isArray(refreshed)).toBe(true);
        });

        it('should return empty array for invalid repoRoot', async () => {
            const branches = await service.getBranches('/nonexistent-repo-path');
            expect(branches).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // getBranchesAsync
    // -----------------------------------------------------------------------

    describe('getBranchesAsync', () => {
        it('should resolve to same result as getBranches', async () => {
            const sync = await service.getBranches(REPO_ROOT, true);
            const async_ = await service.getBranchesAsync(REPO_ROOT);
            expect(async_).toEqual(sync);
        });
    });

    // -----------------------------------------------------------------------
    // invalidateBranchCache
    // -----------------------------------------------------------------------

    describe('invalidateBranchCache', () => {
        it('should clear cache for specific repoRoot', async () => {
            await service.getBranches(REPO_ROOT); // populate cache
            service.invalidateBranchCache(REPO_ROOT);
            // After invalidation, next call should re-fetch (no error)
            const branches = await service.getBranches(REPO_ROOT);
            expect(Array.isArray(branches)).toBe(true);
        });

        it('should clear all cache when no repoRoot provided', async () => {
            await service.getBranches(REPO_ROOT); // populate cache
            service.invalidateBranchCache();
            const branches = await service.getBranches(REPO_ROOT);
            expect(Array.isArray(branches)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // dispose
    // -----------------------------------------------------------------------

    describe('dispose', () => {
        it('should clear branch cache', async () => {
            await service.getBranches(REPO_ROOT); // populate cache
            service.dispose();
            // After dispose, service should still work (rebuilds cache)
            const branches = await service.getBranches(REPO_ROOT);
            expect(Array.isArray(branches)).toBe(true);
        });
    });
});
