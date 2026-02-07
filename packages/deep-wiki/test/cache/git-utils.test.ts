/**
 * Git Utilities Tests
 *
 * Tests for git hash detection, change detection, and git availability checks.
 * Uses the actual git repository for integration tests.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { getRepoHeadHash, getChangedFiles, hasChanges, isGitAvailable, isGitRepo } from '../../src/cache/git-utils';

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
