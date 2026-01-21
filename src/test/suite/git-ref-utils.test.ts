/**
 * Tests for git-ref-utils.ts
 * Covers git ref shortening and display ref generation
 */

import * as assert from 'assert';
import * as path from 'path';
import { execSync } from 'child_process';
import {
    isFullCommitHash,
    shortenGitRef,
    shortenGitRefSync,
    getDisplayRefs
} from '../../shortcuts/git-diff-comments/git-ref-utils';
import { DiffGitContext } from '../../shortcuts/git-diff-comments/types';

suite('Git Ref Utils Tests', () => {

    suite('isFullCommitHash', () => {
        test('should return true for valid 40-char lowercase hex string', () => {
            assert.strictEqual(isFullCommitHash('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'), true);
        });

        test('should return true for valid 40-char uppercase hex string', () => {
            assert.strictEqual(isFullCommitHash('A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2'), true);
        });

        test('should return true for valid 40-char mixed case hex string', () => {
            assert.strictEqual(isFullCommitHash('a1B2c3D4e5F6a1B2c3D4e5F6a1B2c3D4e5F6a1B2'), true);
        });

        test('should return false for short hash (7 chars)', () => {
            assert.strictEqual(isFullCommitHash('a1b2c3d'), false);
        });

        test('should return false for special ref HEAD', () => {
            assert.strictEqual(isFullCommitHash('HEAD'), false);
        });

        test('should return false for special ref WORKING_TREE', () => {
            assert.strictEqual(isFullCommitHash('WORKING_TREE'), false);
        });

        test('should return false for index ref :0', () => {
            assert.strictEqual(isFullCommitHash(':0'), false);
        });

        test('should return false for EMPTY ref', () => {
            assert.strictEqual(isFullCommitHash('EMPTY'), false);
        });

        test('should return false for branch name', () => {
            assert.strictEqual(isFullCommitHash('main'), false);
            assert.strictEqual(isFullCommitHash('feature/my-branch'), false);
        });

        test('should return false for 40-char string with non-hex characters', () => {
            assert.strictEqual(isFullCommitHash('g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'), false);
            assert.strictEqual(isFullCommitHash('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1bz'), false);
        });

        test('should return false for 39-char hex string', () => {
            assert.strictEqual(isFullCommitHash('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b'), false);
        });

        test('should return false for 41-char hex string', () => {
            assert.strictEqual(isFullCommitHash('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c'), false);
        });

        test('should return false for empty string', () => {
            assert.strictEqual(isFullCommitHash(''), false);
        });
    });

    suite('shortenGitRef', () => {
        // Get the current git repository root for testing
        let repoRoot: string;
        let validCommitHash: string;

        suiteSetup(() => {
            // Use the current workspace as the test repo
            repoRoot = path.resolve(__dirname, '../../..');
            try {
                // Get a valid commit hash from the current repo
                validCommitHash = execSync('git rev-parse HEAD', {
                    cwd: repoRoot,
                    encoding: 'utf8'
                }).trim();
            } catch {
                // If not in a git repo, skip commit hash tests
                validCommitHash = '';
            }
        });

        test('should return special ref HEAD unchanged', async () => {
            const result = await shortenGitRef('HEAD', repoRoot);
            assert.strictEqual(result, 'HEAD');
        });

        test('should return special ref WORKING_TREE unchanged', async () => {
            const result = await shortenGitRef('WORKING_TREE', repoRoot);
            assert.strictEqual(result, 'WORKING_TREE');
        });

        test('should return index ref :0 unchanged', async () => {
            const result = await shortenGitRef(':0', repoRoot);
            assert.strictEqual(result, ':0');
        });

        test('should return EMPTY ref unchanged', async () => {
            const result = await shortenGitRef('EMPTY', repoRoot);
            assert.strictEqual(result, 'EMPTY');
        });

        test('should return branch name unchanged', async () => {
            const result = await shortenGitRef('main', repoRoot);
            assert.strictEqual(result, 'main');
        });

        test('should shorten a valid full commit hash', async function() {
            if (!validCommitHash) {
                this.skip();
                return;
            }

            const result = await shortenGitRef(validCommitHash, repoRoot);

            // Result should be shorter than 40 chars
            assert.ok(result.length < 40, `Expected shortened hash, got: ${result}`);
            // Result should be at least 4 chars (git minimum)
            assert.ok(result.length >= 4, `Expected at least 4 chars, got: ${result}`);
            // Result should be a prefix of the original
            assert.ok(validCommitHash.toLowerCase().startsWith(result.toLowerCase()),
                `Expected ${result} to be a prefix of ${validCommitHash}`);
        });

        test('should fallback to 7 chars for invalid commit hash in valid repo', async () => {
            // Use a fake but valid-looking 40-char hex string that doesn't exist
            const fakeHash = '0000000000000000000000000000000000000000';
            const result = await shortenGitRef(fakeHash, repoRoot);

            // Should fallback to first 7 chars
            assert.strictEqual(result, '0000000');
        });

        test('should fallback to 7 chars when repo path is invalid', async () => {
            const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
            const result = await shortenGitRef(hash, '/nonexistent/path');

            assert.strictEqual(result, 'a1b2c3d');
        });
    });

    suite('shortenGitRefSync', () => {
        let repoRoot: string;
        let validCommitHash: string;

        suiteSetup(() => {
            repoRoot = path.resolve(__dirname, '../../..');
            try {
                validCommitHash = execSync('git rev-parse HEAD', {
                    cwd: repoRoot,
                    encoding: 'utf8'
                }).trim();
            } catch {
                validCommitHash = '';
            }
        });

        test('should return special refs unchanged', () => {
            assert.strictEqual(shortenGitRefSync('HEAD', repoRoot), 'HEAD');
            assert.strictEqual(shortenGitRefSync('WORKING_TREE', repoRoot), 'WORKING_TREE');
            assert.strictEqual(shortenGitRefSync(':0', repoRoot), ':0');
            assert.strictEqual(shortenGitRefSync('EMPTY', repoRoot), 'EMPTY');
        });

        test('should shorten a valid full commit hash', function() {
            if (!validCommitHash) {
                this.skip();
                return;
            }

            const result = shortenGitRefSync(validCommitHash, repoRoot);

            assert.ok(result.length < 40, `Expected shortened hash, got: ${result}`);
            assert.ok(result.length >= 4, `Expected at least 4 chars, got: ${result}`);
            assert.ok(validCommitHash.toLowerCase().startsWith(result.toLowerCase()),
                `Expected ${result} to be a prefix of ${validCommitHash}`);
        });

        test('should fallback to 7 chars for invalid repo', () => {
            const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
            const result = shortenGitRefSync(hash, '/nonexistent/path');

            assert.strictEqual(result, 'a1b2c3d');
        });
    });

    suite('getDisplayRefs', () => {
        let repoRoot: string;
        let validCommitHash: string;
        let parentCommitHash: string;

        suiteSetup(() => {
            repoRoot = path.resolve(__dirname, '../../..');
            try {
                validCommitHash = execSync('git rev-parse HEAD', {
                    cwd: repoRoot,
                    encoding: 'utf8'
                }).trim();
                parentCommitHash = execSync('git rev-parse HEAD~1', {
                    cwd: repoRoot,
                    encoding: 'utf8'
                }).trim();
            } catch {
                validCommitHash = '';
                parentCommitHash = '';
            }
        });

        test('should shorten both commit hashes', async function() {
            if (!validCommitHash || !parentCommitHash) {
                this.skip();
                return;
            }

            const gitContext: DiffGitContext = {
                repositoryRoot: repoRoot,
                repositoryName: 'test-repo',
                oldRef: parentCommitHash,
                newRef: validCommitHash,
                wasStaged: true,
                commitHash: validCommitHash
            };

            const result = await getDisplayRefs(gitContext);

            // Both refs should be shortened
            assert.ok(result.oldRef.length < 40, `Expected shortened oldRef, got: ${result.oldRef}`);
            assert.ok(result.newRef.length < 40, `Expected shortened newRef, got: ${result.newRef}`);
            // Both should be valid prefixes
            assert.ok(parentCommitHash.toLowerCase().startsWith(result.oldRef.toLowerCase()));
            assert.ok(validCommitHash.toLowerCase().startsWith(result.newRef.toLowerCase()));
        });

        test('should leave special refs unchanged', async () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: repoRoot,
                repositoryName: 'test-repo',
                oldRef: 'HEAD',
                newRef: 'WORKING_TREE',
                wasStaged: false
            };

            const result = await getDisplayRefs(gitContext);

            assert.strictEqual(result.oldRef, 'HEAD');
            assert.strictEqual(result.newRef, 'WORKING_TREE');
        });

        test('should handle mixed refs (commit hash and special ref)', async function() {
            if (!validCommitHash) {
                this.skip();
                return;
            }

            const gitContext: DiffGitContext = {
                repositoryRoot: repoRoot,
                repositoryName: 'test-repo',
                oldRef: validCommitHash,
                newRef: 'WORKING_TREE',
                wasStaged: false
            };

            const result = await getDisplayRefs(gitContext);

            // oldRef should be shortened
            assert.ok(result.oldRef.length < 40, `Expected shortened oldRef, got: ${result.oldRef}`);
            assert.ok(validCommitHash.toLowerCase().startsWith(result.oldRef.toLowerCase()));
            // newRef should remain unchanged
            assert.strictEqual(result.newRef, 'WORKING_TREE');
        });

        test('should handle index refs', async () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: repoRoot,
                repositoryName: 'test-repo',
                oldRef: ':0',
                newRef: 'WORKING_TREE',
                wasStaged: false
            };

            const result = await getDisplayRefs(gitContext);

            assert.strictEqual(result.oldRef, ':0');
            assert.strictEqual(result.newRef, 'WORKING_TREE');
        });

        test('should handle staged changes context', async () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: repoRoot,
                repositoryName: 'test-repo',
                oldRef: 'HEAD',
                newRef: ':0',
                wasStaged: true
            };

            const result = await getDisplayRefs(gitContext);

            assert.strictEqual(result.oldRef, 'HEAD');
            assert.strictEqual(result.newRef, ':0');
        });
    });
});
