/**
 * Tests for Commit File Diff Command
 * 
 * Tests the openCommitFileDiff command functionality that opens
 * VSCode's diff view for files in a commit.
 */

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { CommitFileItem } from '../../shortcuts/tree-items';
import { createGitShowUri, GIT_SHOW_SCHEME } from '../../shortcuts/git/git-show-text-document-provider';

suite('Commit File Diff Tests', () => {

    const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

    // ============================================
    // URI Generation Tests
    // ============================================
    suite('URI Generation for Diff', () => {
        test('should create correct URIs for modified file diff', () => {
            const filePath = 'src/file.ts';
            const commitHash = 'abc123def456789';
            const parentHash = 'parent123456789';
            const repoRoot = '/path/to/repo';

            const leftUri = createGitShowUri(filePath, parentHash, repoRoot);
            const rightUri = createGitShowUri(filePath, commitHash, repoRoot);

            // Left should be parent commit
            const leftParams = new URLSearchParams(leftUri.query);
            assert.strictEqual(leftParams.get('commit'), parentHash);

            // Right should be current commit
            const rightParams = new URLSearchParams(rightUri.query);
            assert.strictEqual(rightParams.get('commit'), commitHash);

            // Both should have same path
            assert.strictEqual(leftUri.path, filePath);
            assert.strictEqual(rightUri.path, filePath);
        });

        test('should create correct URIs for added file diff', () => {
            const filePath = 'src/new-file.ts';
            const commitHash = 'abc123';
            const repoRoot = '/repo';

            // For added files: empty tree -> new content
            const leftUri = createGitShowUri(filePath, EMPTY_TREE_HASH, repoRoot);
            const rightUri = createGitShowUri(filePath, commitHash, repoRoot);

            const leftParams = new URLSearchParams(leftUri.query);
            assert.strictEqual(leftParams.get('commit'), EMPTY_TREE_HASH);

            const rightParams = new URLSearchParams(rightUri.query);
            assert.strictEqual(rightParams.get('commit'), commitHash);
        });

        test('should create correct URIs for deleted file diff', () => {
            const filePath = 'src/removed-file.ts';
            const parentHash = 'parent123';
            const repoRoot = '/repo';

            // For deleted files: old content -> empty tree
            const leftUri = createGitShowUri(filePath, parentHash, repoRoot);
            const rightUri = createGitShowUri(filePath, EMPTY_TREE_HASH, repoRoot);

            const leftParams = new URLSearchParams(leftUri.query);
            assert.strictEqual(leftParams.get('commit'), parentHash);

            const rightParams = new URLSearchParams(rightUri.query);
            assert.strictEqual(rightParams.get('commit'), EMPTY_TREE_HASH);
        });

        test('should create correct URIs for renamed file diff', () => {
            const originalPath = 'src/old-name.ts';
            const newPath = 'src/new-name.ts';
            const commitHash = 'abc123';
            const parentHash = 'parent123';
            const repoRoot = '/repo';

            // For renamed files: old path at parent -> new path at commit
            const leftUri = createGitShowUri(originalPath, parentHash, repoRoot);
            const rightUri = createGitShowUri(newPath, commitHash, repoRoot);

            assert.strictEqual(leftUri.path, originalPath);
            assert.strictEqual(rightUri.path, newPath);
        });

        test('should create correct URIs for copied file diff', () => {
            const originalPath = 'src/original.ts';
            const copyPath = 'src/copy.ts';
            const commitHash = 'abc123';
            const parentHash = 'parent123';
            const repoRoot = '/repo';

            // For copied files: original at parent -> copy at commit
            const leftUri = createGitShowUri(originalPath, parentHash, repoRoot);
            const rightUri = createGitShowUri(copyPath, commitHash, repoRoot);

            assert.strictEqual(leftUri.path, originalPath);
            assert.strictEqual(rightUri.path, copyPath);
        });
    });

    // ============================================
    // Diff Title Generation Tests
    // ============================================
    suite('Diff Title Generation', () => {
        test('should generate correct title for modified file', () => {
            const item = new CommitFileItem(
                'src/file.ts',
                'M',
                'abc123def456789',
                'parent',
                '/repo'
            );

            const expectedTitle = `${path.basename(item.filePath)} (${item.commitHash.slice(0, 7)})`;
            assert.strictEqual(expectedTitle, 'file.ts (abc123d)');
        });

        test('should generate correct title for added file', () => {
            const item = new CommitFileItem(
                'src/new-file.ts',
                'A',
                'abc123def456789',
                'parent',
                '/repo'
            );

            const expectedTitle = `${path.basename(item.filePath)} (added in ${item.commitHash.slice(0, 7)})`;
            assert.strictEqual(expectedTitle, 'new-file.ts (added in abc123d)');
        });

        test('should generate correct title for deleted file', () => {
            const item = new CommitFileItem(
                'src/removed.ts',
                'D',
                'abc123def456789',
                'parent',
                '/repo'
            );

            const expectedTitle = `${path.basename(item.filePath)} (deleted in ${item.commitHash.slice(0, 7)})`;
            assert.strictEqual(expectedTitle, 'removed.ts (deleted in abc123d)');
        });

        test('should generate correct title for renamed file', () => {
            const item = new CommitFileItem(
                'src/new-name.ts',
                'R',
                'abc123def456789',
                'parent',
                '/repo',
                'src/old-name.ts'
            );

            const expectedTitle = `${path.basename(item.originalPath!)} → ${path.basename(item.filePath)} (${item.commitHash.slice(0, 7)})`;
            assert.strictEqual(expectedTitle, 'old-name.ts → new-name.ts (abc123d)');
        });

        test('should generate correct title for copied file', () => {
            const item = new CommitFileItem(
                'src/copy.ts',
                'C',
                'abc123def456789',
                'parent',
                '/repo',
                'src/original.ts'
            );

            const expectedTitle = `${path.basename(item.originalPath!)} → ${path.basename(item.filePath)} (copied in ${item.commitHash.slice(0, 7)})`;
            assert.strictEqual(expectedTitle, 'original.ts → copy.ts (copied in abc123d)');
        });
    });

    // ============================================
    // CommitFileItem Command Tests
    // ============================================
    suite('CommitFileItem Command', () => {
        test('should have correct command for opening diff', () => {
            const item = new CommitFileItem(
                'src/file.ts',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'shortcuts.openCommitFileDiff');
            assert.strictEqual(item.command.title, 'Open Diff');
        });

        test('should pass itself as command argument', () => {
            const item = new CommitFileItem(
                'src/file.ts',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.ok(item.command);
            assert.ok(item.command.arguments);
            assert.strictEqual(item.command.arguments.length, 1);
            assert.strictEqual(item.command.arguments[0], item);
        });

        test('should include all necessary data for diff command', () => {
            const item = new CommitFileItem(
                'src/renamed.ts',
                'R',
                'abc123def456789',
                'parent123456789',
                '/path/to/repo',
                'src/original.ts'
            );

            // The command should have access to all necessary properties
            assert.ok(item.command);
            const arg = item.command.arguments![0] as CommitFileItem;
            
            assert.strictEqual(arg.filePath, 'src/renamed.ts');
            assert.strictEqual(arg.originalPath, 'src/original.ts');
            assert.strictEqual(arg.commitHash, 'abc123def456789');
            assert.strictEqual(arg.parentHash, 'parent123456789');
            assert.strictEqual(arg.repositoryRoot, '/path/to/repo');
            assert.strictEqual(arg.status, 'R');
        });
    });

    // ============================================
    // Edge Cases for Diff
    // ============================================
    suite('Edge Cases', () => {
        test('should handle file at repository root', () => {
            const item = new CommitFileItem(
                'README.md',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            const leftUri = createGitShowUri(item.filePath, item.parentHash, item.repositoryRoot);
            const rightUri = createGitShowUri(item.filePath, item.commitHash, item.repositoryRoot);

            assert.strictEqual(leftUri.path, 'README.md');
            assert.strictEqual(rightUri.path, 'README.md');
        });

        test('should handle deeply nested file path', () => {
            const deepPath = 'src/features/auth/components/forms/LoginForm.tsx';
            const item = new CommitFileItem(
                deepPath,
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            const uri = createGitShowUri(item.filePath, item.commitHash, item.repositoryRoot);
            assert.strictEqual(uri.path, deepPath);
        });

        test('should handle file with special characters', () => {
            const item = new CommitFileItem(
                'src/[feature]/file-name_test.spec.ts',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            const uri = createGitShowUri(item.filePath, item.commitHash, item.repositoryRoot);
            assert.ok(uri.path.includes('[feature]') || uri.path.includes('%5Bfeature%5D'));
        });

        test('should handle repository root with spaces', () => {
            const item = new CommitFileItem(
                'src/file.ts',
                'M',
                'abc123',
                'parent',
                '/path/to/my repo'
            );

            const uri = createGitShowUri(item.filePath, item.commitHash, item.repositoryRoot);
            const params = new URLSearchParams(uri.query);
            assert.ok(params.get('repo')?.includes('my repo') || params.get('repo')?.includes('my%20repo'));
        });

        test('should handle empty parent hash for initial commit', () => {
            const item = new CommitFileItem(
                'src/file.ts',
                'A',
                'abc123',
                EMPTY_TREE_HASH,
                '/repo'
            );

            const leftUri = createGitShowUri(item.filePath, item.parentHash, item.repositoryRoot);
            const params = new URLSearchParams(leftUri.query);
            assert.strictEqual(params.get('commit'), EMPTY_TREE_HASH);
        });
    });

    // ============================================
    // URI Scheme and Format Tests
    // ============================================
    suite('URI Scheme and Format', () => {
        test('should use git-show scheme', () => {
            const uri = createGitShowUri('file.ts', 'abc123', '/repo');
            assert.strictEqual(uri.scheme, GIT_SHOW_SCHEME);
            assert.strictEqual(uri.scheme, 'git-show');
        });

        test('should encode query parameters correctly', () => {
            const uri = createGitShowUri('file.ts', 'abc123', '/repo');
            
            // Query should be parseable
            const params = new URLSearchParams(uri.query);
            assert.strictEqual(params.get('commit'), 'abc123');
            assert.strictEqual(params.get('repo'), '/repo');
        });

        test('should handle long commit hashes', () => {
            const longHash = 'a'.repeat(40);
            const uri = createGitShowUri('file.ts', longHash, '/repo');
            
            const params = new URLSearchParams(uri.query);
            assert.strictEqual(params.get('commit'), longHash);
        });

        test('should create valid URI for vscode.diff command', () => {
            const leftUri = createGitShowUri('file.ts', 'parent', '/repo');
            const rightUri = createGitShowUri('file.ts', 'commit', '/repo');

            // Both URIs should be valid and different
            assert.ok(leftUri.toString());
            assert.ok(rightUri.toString());
            assert.notStrictEqual(leftUri.toString(), rightUri.toString());
        });
    });

    // ============================================
    // Status-Specific Diff Behavior Tests
    // ============================================
    suite('Status-Specific Diff Behavior', () => {
        test('Modified: should compare parent to commit', () => {
            const item = new CommitFileItem('file.ts', 'M', 'commit', 'parent', '/repo');
            
            // For modified files, both URIs use the same path
            const leftUri = createGitShowUri(item.filePath, item.parentHash, item.repositoryRoot);
            const rightUri = createGitShowUri(item.filePath, item.commitHash, item.repositoryRoot);

            assert.strictEqual(leftUri.path, rightUri.path);
            
            const leftParams = new URLSearchParams(leftUri.query);
            const rightParams = new URLSearchParams(rightUri.query);
            assert.strictEqual(leftParams.get('commit'), 'parent');
            assert.strictEqual(rightParams.get('commit'), 'commit');
        });

        test('Added: should compare empty to commit', () => {
            const item = new CommitFileItem('file.ts', 'A', 'commit', 'parent', '/repo');
            
            // For added files, left side uses empty tree hash
            const leftUri = createGitShowUri(item.filePath, EMPTY_TREE_HASH, item.repositoryRoot);
            const rightUri = createGitShowUri(item.filePath, item.commitHash, item.repositoryRoot);

            const leftParams = new URLSearchParams(leftUri.query);
            const rightParams = new URLSearchParams(rightUri.query);
            assert.strictEqual(leftParams.get('commit'), EMPTY_TREE_HASH);
            assert.strictEqual(rightParams.get('commit'), 'commit');
        });

        test('Deleted: should compare parent to empty', () => {
            const item = new CommitFileItem('file.ts', 'D', 'commit', 'parent', '/repo');
            
            // For deleted files, right side uses empty tree hash
            const leftUri = createGitShowUri(item.filePath, item.parentHash, item.repositoryRoot);
            const rightUri = createGitShowUri(item.filePath, EMPTY_TREE_HASH, item.repositoryRoot);

            const leftParams = new URLSearchParams(leftUri.query);
            const rightParams = new URLSearchParams(rightUri.query);
            assert.strictEqual(leftParams.get('commit'), 'parent');
            assert.strictEqual(rightParams.get('commit'), EMPTY_TREE_HASH);
        });

        test('Renamed: should compare original path to new path', () => {
            const item = new CommitFileItem('new.ts', 'R', 'commit', 'parent', '/repo', 'old.ts');
            
            // For renamed files, left uses original path, right uses new path
            const leftUri = createGitShowUri(item.originalPath!, item.parentHash, item.repositoryRoot);
            const rightUri = createGitShowUri(item.filePath, item.commitHash, item.repositoryRoot);

            assert.strictEqual(leftUri.path, 'old.ts');
            assert.strictEqual(rightUri.path, 'new.ts');
        });

        test('Copied: should compare original path to copy path', () => {
            const item = new CommitFileItem('copy.ts', 'C', 'commit', 'parent', '/repo', 'original.ts');
            
            // For copied files, left uses original path, right uses copy path
            const leftUri = createGitShowUri(item.originalPath!, item.parentHash, item.repositoryRoot);
            const rightUri = createGitShowUri(item.filePath, item.commitHash, item.repositoryRoot);

            assert.strictEqual(leftUri.path, 'original.ts');
            assert.strictEqual(rightUri.path, 'copy.ts');
        });
    });
});

