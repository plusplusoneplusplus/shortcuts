/**
 * Tests for Git Search Provider
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { GitSearchProvider } from '../../shortcuts/discovery/search-providers/git-search-provider';
import { DEFAULT_DISCOVERY_SCOPE, DiscoveryScope } from '../../shortcuts/discovery/types';

suite('GitSearchProvider Tests', () => {
    let tempDir: string;
    let provider: GitSearchProvider;
    let isGitRepo = false;

    setup(function() {
        // Increase timeout for setup on CI
        this.timeout(10000);

        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-search-test-'));
        provider = new GitSearchProvider();

        // Try to initialize a git repo with timeout
        try {
            execSync('git init', { cwd: tempDir, stdio: 'pipe', timeout: 5000 });
            execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe', timeout: 5000 });
            execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'pipe', timeout: 5000 });
            isGitRepo = true;
        } catch {
            isGitRepo = false;
        }
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    /**
     * Helper to create a commit
     */
    function createCommit(message: string, files?: { [key: string]: string }) {
        if (!isGitRepo) {
            return;
        }

        if (files) {
            for (const [filePath, content] of Object.entries(files)) {
                const fullPath = path.join(tempDir, filePath);
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(fullPath, content);
                execSync(`git add "${filePath}"`, { cwd: tempDir, stdio: 'pipe' });
            }
        } else {
            // Create a file for the commit
            fs.writeFileSync(path.join(tempDir, 'temp.txt'), Date.now().toString());
            execSync('git add temp.txt', { cwd: tempDir, stdio: 'pipe' });
        }

        execSync(`git commit -m "${message}"`, { cwd: tempDir, stdio: 'pipe' });
    }

    suite('Constructor', () => {
        test('should create provider', () => {
            const p = new GitSearchProvider();
            assert.ok(p);
        });
    });

    suite('search method', () => {
        test('should have search method', () => {
            assert.ok(typeof provider.search === 'function');
        });

        test('should return array from search', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add authentication');

            const scope: DiscoveryScope = { ...DEFAULT_DISCOVERY_SCOPE };
            const results = await provider.search(['authentication'], scope, tempDir);

            assert.ok(Array.isArray(results));
        });

        test('should return empty when includeGitHistory is false', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add authentication');

            const scope: DiscoveryScope = { ...DEFAULT_DISCOVERY_SCOPE, includeGitHistory: false };
            const results = await provider.search(['authentication'], scope, tempDir);

            assert.deepStrictEqual(results, []);
        });
    });

    suite('searchByMessage', () => {
        test('should find commits matching keywords in subject', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add authentication module');
            createCommit('fix: Update user service');
            createCommit('chore: Update dependencies');

            const results = await provider.searchByMessage(['authentication'], 50, tempDir);

            assert.ok(results.length >= 1);
            assert.ok(results.some(r => r.name.includes('authentication')));
        });

        test('should return empty array for no matches', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add something');

            const results = await provider.searchByMessage(['nonexistent'], 50, tempDir);

            assert.deepStrictEqual(results, []);
        });

        test('should return empty array for empty keywords', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add feature');

            const results = await provider.searchByMessage([], 50, tempDir);

            assert.deepStrictEqual(results, []);
        });

        test('should respect maxCommits limit', async function() {
            // Increase timeout since creating multiple commits is slow on Windows
            this.timeout(30000);
            
            if (!isGitRepo) {
                this.skip();
                return;
            }

            // Create multiple commits with the same keyword
            for (let i = 0; i < 10; i++) {
                createCommit(`feat: Add auth feature ${i}`);
            }

            const results = await provider.searchByMessage(['auth'], 5, tempDir);

            assert.ok(results.length <= 5);
        });

        test('should include commit details', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add login functionality', {
                'src/login.ts': 'export function login() {}'
            });

            const results = await provider.searchByMessage(['login'], 50, tempDir);

            assert.ok(results.length >= 1);
            const result = results[0];
            assert.ok(result.type === 'commit');
            assert.ok(result.commit);
            assert.ok(result.commit!.hash);
            assert.ok(result.commit!.shortHash);
            assert.ok(result.commit!.subject);
            assert.ok(result.commit!.authorName);
            assert.ok(result.commit!.date);
            assert.ok(result.commit!.repositoryRoot);
        });

        test('should be case insensitive', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add AUTHENTICATION module');

            const results = await provider.searchByMessage(['authentication'], 50, tempDir);

            assert.ok(results.length >= 1);
        });

        test('should find multiple matching commits', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add auth service');
            createCommit('fix: Fix auth bug');
            createCommit('refactor: Improve auth performance');

            const results = await provider.searchByMessage(['auth'], 50, tempDir);

            assert.ok(results.length >= 3);
        });

        test('should handle special characters in keywords', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add OAuth2.0 support');

            const results = await provider.searchByMessage(['oauth2'], 50, tempDir);

            // Should handle the search gracefully
            assert.ok(Array.isArray(results));
        });

        test('should handle commits with long subjects', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            const longSubject = 'feat: ' + 'authentication '.repeat(20);
            createCommit(longSubject);

            const results = await provider.searchByMessage(['authentication'], 50, tempDir);

            assert.ok(results.length >= 1);
        });

        test('should handle commits with unicode', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add 認証 authentication');

            const results = await provider.searchByMessage(['authentication'], 50, tempDir);

            assert.ok(results.length >= 1);
        });
    });

    suite('searchByPaths', () => {
        test('should find commits touching specific paths', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add auth', {
                'src/auth.ts': 'auth code'
            });

            const results = await provider.searchByPaths(['src/auth.ts'], 50, tempDir);

            assert.ok(results.length >= 1);
        });

        test('should return empty for non-existent paths', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add something', {
                'src/other.ts': 'other code'
            });

            const results = await provider.searchByPaths(['src/nonexistent.ts'], 50, tempDir);

            assert.deepStrictEqual(results, []);
        });

        test('should return empty for empty paths array', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add something');

            const results = await provider.searchByPaths([], 50, tempDir);

            assert.deepStrictEqual(results, []);
        });
    });

    suite('isGitRepository static method', () => {
        test('should return true for git repository', function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            assert.strictEqual(GitSearchProvider.isGitRepository(tempDir), true);
        });

        test('should return false for non-git directory', () => {
            const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
            try {
                assert.strictEqual(GitSearchProvider.isGitRepository(nonGitDir), false);
            } finally {
                fs.rmSync(nonGitDir, { recursive: true, force: true });
            }
        });

        test('should return false for nonexistent path', () => {
            assert.strictEqual(GitSearchProvider.isGitRepository('/nonexistent/path'), false);
        });
    });

    suite('getCommitDiff', () => {
        test('should return diff for valid commit', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add auth', {
                'src/auth.ts': 'auth code'
            });

            // Get the commit hash
            const hash = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();

            const diff = provider.getCommitDiff(hash, tempDir);

            assert.ok(typeof diff === 'string');
        });

        test('should return empty string for invalid commit', function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            const diff = provider.getCommitDiff('invalid-hash', tempDir);

            assert.strictEqual(diff, '');
        });
    });

    suite('Edge cases', () => {
        test('should handle repository with no commits', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            // Fresh repo with no commits
            const emptyGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-git-'));
            try {
                execSync('git init', { cwd: emptyGitDir, stdio: 'pipe' });
                
                const results = await provider.searchByMessage(['auth'], 50, emptyGitDir);
                assert.deepStrictEqual(results, []);
            } finally {
                fs.rmSync(emptyGitDir, { recursive: true, force: true });
            }
        });

        test('should handle very large maxCommits', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add auth');

            const results = await provider.searchByMessage(['auth'], 10000, tempDir);

            assert.ok(Array.isArray(results));
        });

        test('should handle maxCommits of 0', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add auth');

            const results = await provider.searchByMessage(['auth'], 0, tempDir);

            assert.deepStrictEqual(results, []);
        });

        test('should handle invalid repository path', async () => {
            const results = await provider.searchByMessage(['auth'], 50, '/nonexistent/path');
            assert.deepStrictEqual(results, []);
        });

        test('should handle commits with merge messages', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit("Merge branch 'feature/auth' into main");

            const results = await provider.searchByMessage(['auth'], 50, tempDir);

            assert.ok(results.length >= 1);
        });

        test('should handle conventional commit format', async function() {
            this.timeout(10000);  // Increase timeout for Windows CI

            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat(auth): add login functionality');
            createCommit('fix(auth): resolve token issue');

            const results = await provider.searchByMessage(['auth'], 50, tempDir);

            assert.ok(results.length >= 2);
        });

        test('should handle commits with issue references', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add auth (#123)');

            const results = await provider.searchByMessage(['auth'], 50, tempDir);

            assert.ok(results.length >= 1);
        });
    });

    suite('Repository root detection', () => {
        test('should set repositoryRoot in results', async function() {
            if (!isGitRepo) {
                this.skip();
                return;
            }

            createCommit('feat: Add auth');

            const results = await provider.searchByMessage(['auth'], 50, tempDir);

            assert.ok(results.length >= 1);
            assert.ok(results[0].commit);
            assert.strictEqual(results[0].commit!.repositoryRoot, tempDir);
        });
    });
});

