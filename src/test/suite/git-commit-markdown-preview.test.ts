/**
 * Tests for Git Commit Markdown Preview functionality
 * 
 * Tests the ability to open markdown files from commit history
 * using VSCode's markdown preview with virtual documents.
 */

import * as assert from 'assert';
import * as path from 'path';
import { GitCommitFileItem } from '../../shortcuts/git/git-commit-file-item';
import { createGitShowUri, GIT_SHOW_SCHEME } from '../../shortcuts/git/git-show-text-document-provider';
import { GitCommitFile, GitChangeStatus } from '../../shortcuts/git/types';

suite('Git Commit Markdown Preview Tests', () => {

    // Helper to create mock commit file
    const createMockCommitFile = (
        filePath: string,
        status: GitChangeStatus = 'modified',
        originalPath?: string
    ): GitCommitFile => ({
        path: filePath,
        originalPath,
        status,
        commitHash: 'abc123def456789012345678901234567890abcd',
        parentHash: 'parent123456789012345678901234567890abcd',
        repositoryRoot: '/path/to/repo'
    });

    // ============================================
    // GitCommitFileItem Context Value Tests
    // ============================================
    suite('GitCommitFileItem Context Value for Markdown Files', () => {
        test('should have _md suffix for .md files', () => {
            const file = createMockCommitFile('docs/README.md');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile_md');
        });

        test('should have _md suffix for .MD files (uppercase)', () => {
            const file = createMockCommitFile('docs/NOTES.MD');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile_md');
        });

        test('should not have _md suffix for .ts files', () => {
            const file = createMockCommitFile('src/file.ts');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile');
        });

        test('should not have _md suffix for .tsx files', () => {
            const file = createMockCommitFile('src/Component.tsx');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile');
        });

        test('should not have _md suffix for .js files', () => {
            const file = createMockCommitFile('src/index.js');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile');
        });

        test('should not have _md suffix for .json files', () => {
            const file = createMockCommitFile('package.json');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile');
        });

        test('should not have _md suffix for files without extension', () => {
            const file = createMockCommitFile('Makefile');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile');
        });

        test('should handle nested markdown files', () => {
            const file = createMockCommitFile('docs/api/endpoints/authentication.md');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile_md');
        });

        test('should handle markdown file in root', () => {
            const file = createMockCommitFile('README.md');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile_md');
        });
    });

    // ============================================
    // URI Generation for Markdown Preview Tests
    // ============================================
    suite('URI Generation for Markdown Preview', () => {
        test('should create valid git-show URI for markdown file', () => {
            const filePath = 'docs/README.md';
            const commitHash = 'abc123def456';
            const repoRoot = '/path/to/repo';

            const uri = createGitShowUri(filePath, commitHash, repoRoot);

            assert.strictEqual(uri.scheme, GIT_SHOW_SCHEME);
            assert.strictEqual(uri.path, filePath);

            const params = new URLSearchParams(uri.query);
            assert.strictEqual(params.get('commit'), commitHash);
            assert.strictEqual(params.get('repo'), repoRoot);
        });

        test('should handle markdown file with spaces in path', () => {
            const filePath = 'docs/User Guide.md';
            const commitHash = 'abc123';
            const repoRoot = '/path/to/repo';

            const uri = createGitShowUri(filePath, commitHash, repoRoot);

            assert.strictEqual(uri.scheme, GIT_SHOW_SCHEME);
            assert.strictEqual(uri.path, filePath);
        });

        test('should handle markdown file with special characters', () => {
            const filePath = 'docs/API-Reference_v2.md';
            const commitHash = 'abc123';
            const repoRoot = '/path/to/repo';

            const uri = createGitShowUri(filePath, commitHash, repoRoot);

            assert.strictEqual(uri.scheme, GIT_SHOW_SCHEME);
            assert.strictEqual(uri.path, filePath);
        });

        test('should handle Windows-style repo root', () => {
            const filePath = 'docs/README.md';
            const commitHash = 'abc123';
            const repoRoot = 'C:\\Users\\test\\repo';

            const uri = createGitShowUri(filePath, commitHash, repoRoot);

            const params = new URLSearchParams(uri.query);
            assert.strictEqual(params.get('repo'), repoRoot);
        });

        test('should handle Unix-style repo root', () => {
            const filePath = 'docs/README.md';
            const commitHash = 'abc123';
            const repoRoot = '/home/user/repo';

            const uri = createGitShowUri(filePath, commitHash, repoRoot);

            const params = new URLSearchParams(uri.query);
            assert.strictEqual(params.get('repo'), repoRoot);
        });
    });

    // ============================================
    // Cross-Platform Path Handling Tests
    // ============================================
    suite('Cross-Platform Path Handling', () => {
        test('should handle forward slashes in file path', () => {
            const file = createMockCommitFile('docs/api/README.md');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile_md');
        });

        test('should correctly get basename from path with forward slashes', () => {
            const file = createMockCommitFile('docs/api/README.md');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.label, 'README.md');
        });

        test('should correctly get extension regardless of path style', () => {
            // The path.extname should work correctly regardless of separator
            const mdFile = createMockCommitFile('some/path/to/file.md');
            const tsFile = createMockCommitFile('some/path/to/file.ts');

            const mdItem = new GitCommitFileItem(mdFile);
            const tsItem = new GitCommitFileItem(tsFile);

            assert.strictEqual(mdItem.contextValue, 'gitCommitFile_md');
            assert.strictEqual(tsItem.contextValue, 'gitCommitFile');
        });
    });

    // ============================================
    // All Git Change Statuses Tests
    // ============================================
    suite('Markdown Detection for All Change Statuses', () => {
        const statuses: GitChangeStatus[] = [
            'modified', 'added', 'deleted', 'renamed', 
            'copied', 'untracked', 'ignored', 'conflict'
        ];

        statuses.forEach(status => {
            test(`should detect markdown for ${status} files`, () => {
                const mdFile = createMockCommitFile('docs/file.md', status);
                const item = new GitCommitFileItem(mdFile);
                assert.strictEqual(item.contextValue, 'gitCommitFile_md');
            });

            test(`should not detect markdown for ${status} non-md files`, () => {
                const tsFile = createMockCommitFile('src/file.ts', status);
                const item = new GitCommitFileItem(tsFile);
                assert.strictEqual(item.contextValue, 'gitCommitFile');
            });
        });
    });

    // ============================================
    // Renamed/Copied File Tests
    // ============================================
    suite('Renamed and Copied Markdown Files', () => {
        test('should detect markdown for renamed files (new name is .md)', () => {
            const file = createMockCommitFile('docs/new-readme.md', 'renamed', 'docs/old-readme.md');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile_md');
        });

        test('should detect markdown for copied files', () => {
            const file = createMockCommitFile('docs/copy.md', 'copied', 'docs/original.md');
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.contextValue, 'gitCommitFile_md');
        });

        test('should detect markdown when renamed from non-md to md', () => {
            // File was renamed from .txt to .md
            const file = createMockCommitFile('docs/readme.md', 'renamed', 'docs/readme.txt');
            const item = new GitCommitFileItem(file);
            // Context value is based on current path, not original
            assert.strictEqual(item.contextValue, 'gitCommitFile_md');
        });

        test('should not detect markdown when renamed from md to non-md', () => {
            // File was renamed from .md to .txt
            const file = createMockCommitFile('docs/readme.txt', 'renamed', 'docs/readme.md');
            const item = new GitCommitFileItem(file);
            // Context value is based on current path, not original
            assert.strictEqual(item.contextValue, 'gitCommitFile');
        });
    });
});

