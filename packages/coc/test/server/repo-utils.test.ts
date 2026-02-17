/**
 * Repository Path Utilities Tests
 *
 * Tests for extractRepoId, findGitRoot, normalizeRepoPath, and getWorkingDirectory.
 * Includes both unit tests (using the host repo) and integration tests
 * (using temporary git repos created in os.tmpdir()).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { extractRepoId, findGitRoot, normalizeRepoPath, getWorkingDirectory } from '../../src/server/repo-utils';

// Resolve the monorepo root (four levels up from test/server/)
const MONOREPO_ROOT = path.resolve(__dirname, '../../../..');

describe('repo-utils', () => {
    // ========================================================================
    // findGitRoot
    // ========================================================================
    describe('findGitRoot', () => {
        it('should find git root for workspace directory', () => {
            const gitRoot = findGitRoot(MONOREPO_ROOT);
            expect(gitRoot).not.toBeNull();
            // Normalize both sides for cross-platform comparison
            expect(path.resolve(gitRoot!)).toBe(path.resolve(MONOREPO_ROOT));
        });

        it('should find git root for nested directory', () => {
            const nested = path.join(MONOREPO_ROOT, 'packages', 'coc', 'src');
            const gitRoot = findGitRoot(nested);
            expect(gitRoot).not.toBeNull();
            expect(path.resolve(gitRoot!)).toBe(path.resolve(MONOREPO_ROOT));
        });

        it('should find git root for a file path', () => {
            const filePath = path.resolve(__dirname, '../../src/server/repo-utils.ts');
            const gitRoot = findGitRoot(filePath);
            expect(gitRoot).not.toBeNull();
            expect(path.resolve(gitRoot!)).toBe(path.resolve(MONOREPO_ROOT));
        });

        it('should return null for nonexistent path', () => {
            const gitRoot = findGitRoot('/nonexistent/path/that/does/not/exist');
            expect(gitRoot).toBeNull();
        });

        it('should handle relative paths', () => {
            const cwd = process.cwd();
            const relative = path.relative(cwd, MONOREPO_ROOT);
            const gitRoot = findGitRoot(relative);
            expect(gitRoot).not.toBeNull();
        });

        it('should return null for non-git directory', () => {
            // Create a temp dir that is definitely not inside a git repo
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
            try {
                const gitRoot = findGitRoot(tmpDir);
                // tmpdir might be inside a git repo on some systems, but our
                // fresh tmpdir should not be
                expect(gitRoot).toBeNull();
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    // ========================================================================
    // normalizeRepoPath
    // ========================================================================
    describe('normalizeRepoPath', () => {
        it('should convert to absolute path', () => {
            const normalized = normalizeRepoPath('./src');
            expect(path.isAbsolute(normalized)).toBe(true);
        });

        it('should use forward slashes', () => {
            const normalized = normalizeRepoPath(MONOREPO_ROOT);
            expect(normalized).not.toContain('\\');
        });

        it('should be idempotent', () => {
            const first = normalizeRepoPath(MONOREPO_ROOT);
            const second = normalizeRepoPath(first);
            expect(first).toBe(second);
        });

        it('should remove trailing slashes', () => {
            const withTrailing = normalizeRepoPath(MONOREPO_ROOT + '/');
            const withoutTrailing = normalizeRepoPath(MONOREPO_ROOT);
            expect(withTrailing).toBe(withoutTrailing);
        });

        it('should handle root paths correctly', () => {
            if (process.platform !== 'win32') {
                const normalized = normalizeRepoPath('/');
                expect(normalized).toBe('/');
            }
        });

        it('should resolve relative segments', () => {
            const withRelative = normalizeRepoPath(path.join(MONOREPO_ROOT, 'packages', '..'));
            const plain = normalizeRepoPath(MONOREPO_ROOT);
            expect(withRelative).toBe(plain);
        });

        if (process.platform === 'win32') {
            it('should convert to lowercase on Windows', () => {
                const normalized = normalizeRepoPath('C:\\Users\\Test');
                expect(normalized).toBe('c:/users/test');
            });
        }
    });

    // ========================================================================
    // extractRepoId
    // ========================================================================
    describe('extractRepoId', () => {
        it('should extract from workingDirectory', () => {
            const payload = { workingDirectory: MONOREPO_ROOT };
            const repoId = extractRepoId(payload);
            expect(repoId).not.toBeNull();
            expect(repoId).toBe(normalizeRepoPath(MONOREPO_ROOT));
        });

        it('should extract from promptFilePath', () => {
            const payload = { promptFilePath: path.resolve(__dirname, '../../src/server/repo-utils.ts') };
            const repoId = extractRepoId(payload);
            expect(repoId).not.toBeNull();
            expect(repoId).toBe(normalizeRepoPath(MONOREPO_ROOT));
        });

        it('should extract from filePath', () => {
            const payload = { filePath: path.resolve(__dirname, '../../src/server/repo-utils.ts') };
            const repoId = extractRepoId(payload);
            expect(repoId).not.toBeNull();
            expect(repoId).toBe(normalizeRepoPath(MONOREPO_ROOT));
        });

        it('should extract from documentUri (file:// scheme)', () => {
            const absPath = path.resolve(__dirname, '../../src/server/repo-utils.ts');
            const fileUri = 'file://' + absPath;
            const payload = { documentUri: fileUri, commentIds: [], promptTemplate: '' };
            const repoId = extractRepoId(payload);
            expect(repoId).not.toBeNull();
            expect(repoId).toBe(normalizeRepoPath(MONOREPO_ROOT));
        });

        it('should extract from rulesFolder (code-review tasks)', () => {
            const rulesDir = path.join(MONOREPO_ROOT, '.github', 'cr-rules');
            // Only test if the directory exists
            if (fs.existsSync(rulesDir)) {
                const payload = { diffType: 'staged' as const, rulesFolder: rulesDir };
                const repoId = extractRepoId(payload);
                expect(repoId).not.toBeNull();
                expect(repoId).toBe(normalizeRepoPath(MONOREPO_ROOT));
            }
        });

        it('should return null for empty payload', () => {
            const payload = { data: {} };
            const repoId = extractRepoId(payload as any);
            expect(repoId).toBeNull();
        });

        it('should try multiple candidates (fallback)', () => {
            const payload = {
                workingDirectory: '/nonexistent',
                promptFilePath: path.resolve(__dirname, '../../src/server/repo-utils.ts'),
            };
            const repoId = extractRepoId(payload);
            // Should fall back to promptFilePath when workingDirectory fails
            expect(repoId).not.toBeNull();
            expect(repoId).toBe(normalizeRepoPath(MONOREPO_ROOT));
        });

        it('should skip empty string candidates', () => {
            const payload = {
                workingDirectory: '',
                promptFilePath: path.resolve(__dirname, '../../src/server/repo-utils.ts'),
            };
            const repoId = extractRepoId(payload);
            expect(repoId).not.toBeNull();
        });

        it('should handle encoded URI components in documentUri', () => {
            // Use real path to avoid null from non-existent file
            const absPath = path.resolve(__dirname, '../../src/server/repo-utils.ts');
            const encoded = 'file://' + encodeURIComponent(absPath).replace(/%2F/gi, '/');
            const payload = { documentUri: encoded, commentIds: [], promptTemplate: '' };
            const repoId = extractRepoId(payload);
            expect(repoId).not.toBeNull();
        });

        it('should ignore non-file:// documentUri', () => {
            const payload = {
                documentUri: 'https://example.com/file.md',
                commentIds: [],
                promptTemplate: '',
            };
            const repoId = extractRepoId(payload as any);
            expect(repoId).toBeNull();
        });
    });

    // ========================================================================
    // getWorkingDirectory
    // ========================================================================
    describe('getWorkingDirectory', () => {
        it('should return workingDirectory if present', () => {
            const payload = { workingDirectory: '/path/to/repo' };
            const result = getWorkingDirectory(payload);
            expect(result).toBe('/path/to/repo');
        });

        it('should return null if workingDirectory is missing', () => {
            const payload = { filePath: '/path/to/file' };
            const result = getWorkingDirectory(payload as any);
            expect(result).toBeNull();
        });

        it('should return empty string as-is', () => {
            const payload = { workingDirectory: '' };
            const result = getWorkingDirectory(payload);
            expect(result).toBe('');
        });
    });

    // ========================================================================
    // Integration: temp git repo
    // ========================================================================
    describe('integration (temp git repo)', () => {
        let tempDir: string;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-utils-test-'));
            execSync('git init', { cwd: tempDir, stdio: 'ignore' });
            execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
            execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
            fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Repo');
            execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
            execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' });
        });

        afterEach(() => {
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        it('should extract repo ID from task in temp git repo', () => {
            const payload = { workingDirectory: tempDir };
            const repoId = extractRepoId(payload);
            expect(repoId).toBe(normalizeRepoPath(tempDir));
        });

        it('should handle nested subdirectories', () => {
            const srcDir = path.join(tempDir, 'src', 'components');
            fs.mkdirSync(srcDir, { recursive: true });
            const payload = { workingDirectory: srcDir };
            const repoId = extractRepoId(payload);
            expect(repoId).toBe(normalizeRepoPath(tempDir));
        });

        it('should handle file paths inside the repo', () => {
            const filePath = path.join(tempDir, 'README.md');
            const payload = { filePath };
            const repoId = extractRepoId(payload);
            expect(repoId).toBe(normalizeRepoPath(tempDir));
        });

        it('should produce consistent IDs for same repo', () => {
            const payload1 = { workingDirectory: tempDir };
            const payload2 = { workingDirectory: path.join(tempDir, 'src', '..') };
            const id1 = extractRepoId(payload1);
            const id2 = extractRepoId(payload2);
            expect(id1).toBe(id2);
        });

        it('should produce different IDs for different repos', () => {
            const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-utils-test2-'));
            try {
                execSync('git init', { cwd: tempDir2, stdio: 'ignore' });
                execSync('git config user.name "Test"', { cwd: tempDir2, stdio: 'ignore' });
                execSync('git config user.email "test@example.com"', { cwd: tempDir2, stdio: 'ignore' });
                fs.writeFileSync(path.join(tempDir2, 'README.md'), '# Test Repo 2');
                execSync('git add .', { cwd: tempDir2, stdio: 'ignore' });
                execSync('git commit -m "Initial"', { cwd: tempDir2, stdio: 'ignore' });

                const id1 = extractRepoId({ workingDirectory: tempDir });
                const id2 = extractRepoId({ workingDirectory: tempDir2 });
                expect(id1).not.toBe(id2);
            } finally {
                fs.rmSync(tempDir2, { recursive: true, force: true });
            }
        });

        it('should find git root from a file in a subdirectory', () => {
            const subDir = path.join(tempDir, 'deep', 'nested');
            fs.mkdirSync(subDir, { recursive: true });
            const filePath = path.join(subDir, 'file.txt');
            fs.writeFileSync(filePath, 'content');

            const gitRoot = findGitRoot(filePath);
            expect(gitRoot).not.toBeNull();
            expect(normalizeRepoPath(gitRoot!)).toBe(normalizeRepoPath(tempDir));
        });
    });
});
