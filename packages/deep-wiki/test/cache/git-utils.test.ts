/**
 * Git Utilities Tests
 *
 * Tests for git hash detection, change detection, git root detection,
 * subfolder-scoped hash, and git availability checks.
 * Uses the actual git repository for integration tests.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    getRepoHeadHash,
    getFolderHeadHash,
    getGitRoot,
    getChangedFiles,
    hasChanges,
    isGitAvailable,
    isGitRepo,
} from '../../src/cache/git-utils';

// Use the workspace root as a known git repository
const WORKSPACE_ROOT = path.resolve(__dirname, '../../../../');

describe('Git Utilities', () => {
    // ========================================================================
    // isGitAvailable
    // ========================================================================

    describe('isGitAvailable', () => {
        it('should return true when git is available', async () => {
            const available = await isGitAvailable();
            expect(available).toBe(true);
        });
    });

    // ========================================================================
    // isGitRepo
    // ========================================================================

    describe('isGitRepo', () => {
        it('should return true for a git repository', async () => {
            const result = await isGitRepo(WORKSPACE_ROOT);
            expect(result).toBe(true);
        });

        it('should return false for a non-git directory', async () => {
            // /tmp is unlikely to be a git repo
            const result = await isGitRepo('/tmp');
            expect(result).toBe(false);
        });

        it('should return false for a non-existent directory', async () => {
            const result = await isGitRepo('/nonexistent/path/that/doesnt/exist');
            expect(result).toBe(false);
        });
    });

    // ========================================================================
    // getGitRoot
    // ========================================================================

    describe('getGitRoot', () => {
        it('should return the git root for the workspace', async () => {
            const root = await getGitRoot(WORKSPACE_ROOT);
            expect(root).not.toBeNull();
            // The root should be an absolute path
            expect(path.isAbsolute(root!)).toBe(true);
        });

        it('should return the same root for a subfolder inside the repo', async () => {
            const root = await getGitRoot(WORKSPACE_ROOT);
            const subfolderRoot = await getGitRoot(path.join(WORKSPACE_ROOT, 'packages'));
            expect(subfolderRoot).toBe(root);
        });

        it('should return the same root for deeply nested subfolder', async () => {
            const root = await getGitRoot(WORKSPACE_ROOT);
            const deepRoot = await getGitRoot(path.join(WORKSPACE_ROOT, 'packages', 'deep-wiki', 'src'));
            expect(deepRoot).toBe(root);
        });

        it('should return null for a non-git directory', async () => {
            const root = await getGitRoot('/tmp');
            expect(root).toBeNull();
        });

        it('should return null for a non-existent directory', async () => {
            const root = await getGitRoot('/nonexistent/path/that/doesnt/exist');
            expect(root).toBeNull();
        });
    });

    // ========================================================================
    // getRepoHeadHash
    // ========================================================================

    describe('getRepoHeadHash', () => {
        it('should return a 40-character hex hash for a git repo', async () => {
            const hash = await getRepoHeadHash(WORKSPACE_ROOT);
            expect(hash).not.toBeNull();
            expect(hash).toMatch(/^[0-9a-f]{40}$/);
        });

        it('should return null for a non-git directory', async () => {
            const hash = await getRepoHeadHash('/tmp');
            expect(hash).toBeNull();
        });

        it('should return null for a non-existent directory', async () => {
            const hash = await getRepoHeadHash('/nonexistent/path');
            expect(hash).toBeNull();
        });
    });

    // ========================================================================
    // getFolderHeadHash
    // ========================================================================

    describe('getFolderHeadHash', () => {
        it('should return a valid 40-character hex hash for the repo root', async () => {
            const hash = await getFolderHeadHash(WORKSPACE_ROOT);
            expect(hash).not.toBeNull();
            expect(hash).toMatch(/^[0-9a-f]{40}$/);
        });

        it('should return same hash as getRepoHeadHash when called on repo root', async () => {
            const folderHash = await getFolderHeadHash(WORKSPACE_ROOT);
            const repoHash = await getRepoHeadHash(WORKSPACE_ROOT);
            // When called on the repo root, getFolderHeadHash falls back to getRepoHeadHash
            expect(folderHash).toBe(repoHash);
        });

        it('should return a valid hash for a subfolder', async () => {
            const subfolderPath = path.join(WORKSPACE_ROOT, 'packages', 'deep-wiki');
            const hash = await getFolderHeadHash(subfolderPath);
            expect(hash).not.toBeNull();
            expect(hash).toMatch(/^[0-9a-f]{40}$/);
        });

        it('should return a subfolder-scoped hash for a subfolder', async () => {
            // The subfolder hash should be a valid commit hash.
            // It may differ from HEAD if HEAD commit didn't touch the subfolder.
            const subfolderPath = path.join(WORKSPACE_ROOT, 'packages', 'deep-wiki', 'src');
            const hash = await getFolderHeadHash(subfolderPath);
            expect(hash).not.toBeNull();
            expect(hash).toMatch(/^[0-9a-f]{40}$/);
        });

        it('should return null for a non-git directory', async () => {
            const hash = await getFolderHeadHash('/tmp');
            expect(hash).toBeNull();
        });

        it('should return null for a non-existent directory', async () => {
            const hash = await getFolderHeadHash('/nonexistent/path');
            expect(hash).toBeNull();
        });

        it('should handle deeply nested subfolder', async () => {
            const deepPath = path.join(WORKSPACE_ROOT, 'packages', 'deep-wiki', 'src', 'cache');
            const hash = await getFolderHeadHash(deepPath);
            expect(hash).not.toBeNull();
            expect(hash).toMatch(/^[0-9a-f]{40}$/);
        });
    });

    // ========================================================================
    // getChangedFiles
    // ========================================================================

    describe('getChangedFiles', () => {
        it('should return an array when comparing valid hashes', async () => {
            const hash = await getRepoHeadHash(WORKSPACE_ROOT);
            if (!hash) {
                // Skip if no git repo
                return;
            }

            // Comparing HEAD to HEAD should show no changes
            const files = await getChangedFiles(WORKSPACE_ROOT, hash);
            expect(files).not.toBeNull();
            expect(Array.isArray(files)).toBe(true);
            expect(files!.length).toBe(0); // HEAD compared to HEAD = no changes
        });

        it('should return null for invalid hash', async () => {
            const files = await getChangedFiles(WORKSPACE_ROOT, 'invalid-hash-that-doesnt-exist');
            expect(files).toBeNull();
        });

        it('should return null for non-git directory', async () => {
            const files = await getChangedFiles('/tmp', 'abc123');
            expect(files).toBeNull();
        });
    });

    // ========================================================================
    // getChangedFiles with scopePath
    // ========================================================================

    describe('getChangedFiles with scopePath', () => {
        it('should return an empty array when comparing HEAD to HEAD with scopePath', async () => {
            const hash = await getRepoHeadHash(WORKSPACE_ROOT);
            if (!hash) {
                return;
            }

            const subfolderPath = path.join(WORKSPACE_ROOT, 'packages', 'deep-wiki');
            const files = await getChangedFiles(WORKSPACE_ROOT, hash, subfolderPath);
            expect(files).not.toBeNull();
            expect(Array.isArray(files)).toBe(true);
            expect(files!.length).toBe(0);
        });

        it('should return null for invalid hash with scopePath', async () => {
            const subfolderPath = path.join(WORKSPACE_ROOT, 'packages', 'deep-wiki');
            const files = await getChangedFiles(WORKSPACE_ROOT, 'invalid-hash', subfolderPath);
            expect(files).toBeNull();
        });

        it('should work when scopePath equals repoPath (git root)', async () => {
            const hash = await getRepoHeadHash(WORKSPACE_ROOT);
            if (!hash) {
                return;
            }

            // scopePath is the same as the git root — should not filter
            const files = await getChangedFiles(WORKSPACE_ROOT, hash, WORKSPACE_ROOT);
            expect(files).not.toBeNull();
            expect(Array.isArray(files)).toBe(true);
            expect(files!.length).toBe(0);
        });
    });

    // ========================================================================
    // hasChanges
    // ========================================================================

    describe('hasChanges', () => {
        it('should return false when comparing HEAD to HEAD', async () => {
            const hash = await getRepoHeadHash(WORKSPACE_ROOT);
            if (!hash) {
                return;
            }

            const changed = await hasChanges(WORKSPACE_ROOT, hash);
            expect(changed).toBe(false);
        });

        it('should return null for invalid input', async () => {
            const changed = await hasChanges('/tmp', 'invalid-hash');
            expect(changed).toBeNull();
        });
    });
});
