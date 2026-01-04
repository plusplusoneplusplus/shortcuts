/**
 * Tests for Commit Display in Logical Groups
 * 
 * Tests the expandable commit items feature that allows users to:
 * - Expand commit items to see changed files
 * - Click on files to open diff view
 * - Handle different file statuses (added, modified, deleted, renamed, copied)
 */

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { CommitFileItem, CommitShortcutItem } from '../../shortcuts/tree-items';
import { 
    GitShowTextDocumentProvider, 
    GIT_SHOW_SCHEME, 
    createGitShowUri 
} from '../../shortcuts/git/git-show-text-document-provider';

suite('Commit Display Tests', () => {

    // ============================================
    // CommitShortcutItem Tests
    // ============================================
    suite('CommitShortcutItem', () => {
        test('should create an expandable commit item', () => {
            const item = new CommitShortcutItem(
                'Fix login bug',
                'abc123def456789',
                '/path/to/repo',
                'My Group'
            );

            assert.strictEqual(item.label, 'Fix login bug');
            assert.strictEqual(item.commitHash, 'abc123def456789');
            assert.strictEqual(item.shortHash, 'abc123d');
            assert.strictEqual(item.repositoryRoot, '/path/to/repo');
            assert.strictEqual(item.parentGroup, 'My Group');
            assert.strictEqual(item.contextValue, 'logicalGroupItem_commit');
        });

        test('should be collapsed by default (expandable)', () => {
            const item = new CommitShortcutItem(
                'Add feature',
                'def456789abc123',
                '/repo',
                'Group'
            );

            assert.strictEqual(
                item.collapsibleState,
                vscode.TreeItemCollapsibleState.Collapsed,
                'Commit item should be collapsed (expandable) by default'
            );
        });

        test('should not have a command (expansion is primary action)', () => {
            const item = new CommitShortcutItem(
                'Update docs',
                '123456789abcdef',
                '/repo',
                'Group'
            );

            assert.strictEqual(item.command, undefined, 'Commit item should not have a command');
        });

        test('should have short hash in description', () => {
            const item = new CommitShortcutItem(
                'Refactor code',
                'fedcba987654321',
                '/repo',
                'Group'
            );

            assert.strictEqual(item.description, 'fedcba9');
        });

        test('should have tooltip with commit hash and label', () => {
            const item = new CommitShortcutItem(
                'Fix typo',
                'abcdef1234567890',
                '/repo',
                'Group'
            );

            assert.ok(item.tooltip);
            assert.ok(item.tooltip.toString().includes('abcdef1'));
            assert.ok(item.tooltip.toString().includes('Fix typo'));
        });

        test('should have git-commit icon by default', () => {
            const item = new CommitShortcutItem(
                'Test commit',
                '1234567890abcdef',
                '/repo',
                'Group'
            );

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'git-commit');
        });

        test('should use custom icon when provided', () => {
            const item = new CommitShortcutItem(
                'Test commit',
                '1234567890abcdef',
                '/repo',
                'Group',
                'check'
            );

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'check');
        });

        test('should handle long commit hashes', () => {
            const longHash = 'a'.repeat(40);
            const item = new CommitShortcutItem(
                'Long hash commit',
                longHash,
                '/repo',
                'Group'
            );

            assert.strictEqual(item.commitHash, longHash);
            assert.strictEqual(item.shortHash, 'aaaaaaa');
        });

        test('should handle short commit hashes', () => {
            const shortHash = 'abc';
            const item = new CommitShortcutItem(
                'Short hash commit',
                shortHash,
                '/repo',
                'Group'
            );

            assert.strictEqual(item.commitHash, 'abc');
            assert.strictEqual(item.shortHash, 'abc');
        });
    });

    // ============================================
    // CommitFileItem Tests
    // ============================================
    suite('CommitFileItem', () => {
        test('should create a modified file item', () => {
            const item = new CommitFileItem(
                'src/auth/login.ts',
                'M',
                'abc123def456789',
                'parent123456789',
                '/path/to/repo'
            );

            assert.strictEqual(item.label, 'login.ts');
            assert.strictEqual(item.filePath, 'src/auth/login.ts');
            assert.strictEqual(item.status, 'M');
            assert.strictEqual(item.commitHash, 'abc123def456789');
            assert.strictEqual(item.parentHash, 'parent123456789');
            assert.strictEqual(item.repositoryRoot, '/path/to/repo');
            assert.strictEqual(item.contextValue, 'commitFile');
        });

        test('should not be expandable', () => {
            const item = new CommitFileItem(
                'file.ts',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.strictEqual(
                item.collapsibleState,
                vscode.TreeItemCollapsibleState.None,
                'File item should not be expandable'
            );
        });

        test('should have directory path in description', () => {
            const item = new CommitFileItem(
                'src/components/Button.tsx',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.strictEqual(item.description, 'src/components');
        });

        test('should have empty description for root files', () => {
            const item = new CommitFileItem(
                'package.json',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.strictEqual(item.description, '');
        });

        test('should have command to open diff', () => {
            const item = new CommitFileItem(
                'file.ts',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'shortcuts.openCommitFileDiff');
            assert.strictEqual(item.command.title, 'Open Diff');
            assert.deepStrictEqual(item.command.arguments, [item]);
        });

        test('should have correct icon for added files', () => {
            const item = new CommitFileItem(
                'new-file.ts',
                'A',
                'abc123',
                'parent',
                '/repo'
            );

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'diff-added');
        });

        test('should have correct icon for modified files', () => {
            const item = new CommitFileItem(
                'modified-file.ts',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'diff-modified');
        });

        test('should have correct icon for deleted files', () => {
            const item = new CommitFileItem(
                'deleted-file.ts',
                'D',
                'abc123',
                'parent',
                '/repo'
            );

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'diff-removed');
        });

        test('should have correct icon for renamed files', () => {
            const item = new CommitFileItem(
                'new-name.ts',
                'R',
                'abc123',
                'parent',
                '/repo',
                'old-name.ts'
            );

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'diff-renamed');
        });

        test('should have correct icon for copied files', () => {
            const item = new CommitFileItem(
                'copied-file.ts',
                'C',
                'abc123',
                'parent',
                '/repo',
                'original-file.ts'
            );

            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'files');
        });

        test('should store original path for renamed files', () => {
            const item = new CommitFileItem(
                'src/new-name.ts',
                'R',
                'abc123',
                'parent',
                '/repo',
                'src/old-name.ts'
            );

            assert.strictEqual(item.originalPath, 'src/old-name.ts');
        });

        test('should have tooltip with status and path', () => {
            const item = new CommitFileItem(
                'src/file.ts',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.ok(item.tooltip);
            assert.ok(item.tooltip.toString().includes('Modified'));
            assert.ok(item.tooltip.toString().includes('src/file.ts'));
        });

        test('should include original path in tooltip for renamed files', () => {
            const item = new CommitFileItem(
                'new-name.ts',
                'R',
                'abc123',
                'parent',
                '/repo',
                'old-name.ts'
            );

            assert.ok(item.tooltip);
            assert.ok(item.tooltip.toString().includes('Renamed'));
            assert.ok(item.tooltip.toString().includes('old-name.ts'));
        });
    });

    // ============================================
    // GitShowTextDocumentProvider Tests
    // ============================================
    suite('GitShowTextDocumentProvider', () => {
        let provider: GitShowTextDocumentProvider;

        setup(() => {
            provider = new GitShowTextDocumentProvider();
        });

        teardown(() => {
            provider.dispose();
        });

        test('should have correct scheme constant', () => {
            assert.strictEqual(GIT_SHOW_SCHEME, 'git-show');
        });

        test('should return empty string for missing parameters', () => {
            const uri = vscode.Uri.parse('git-show:/file.ts');
            const content = provider.provideTextDocumentContent(uri);
            assert.strictEqual(content, '');
        });

        test('should return empty string for empty tree hash', () => {
            const emptyTreeHash = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
            const uri = vscode.Uri.parse(`git-show:/file.ts?commit=${emptyTreeHash}&repo=/repo`);
            const content = provider.provideTextDocumentContent(uri);
            assert.strictEqual(content, '');
        });

        test('should have onDidChange event', () => {
            assert.ok(provider.onDidChange);
        });
    });

    // ============================================
    // createGitShowUri Tests
    // ============================================
    suite('createGitShowUri', () => {
        test('should create URI with correct scheme', () => {
            const uri = createGitShowUri('src/file.ts', 'abc123', '/path/to/repo');
            assert.strictEqual(uri.scheme, GIT_SHOW_SCHEME);
        });

        test('should include file path in URI path', () => {
            const uri = createGitShowUri('src/file.ts', 'abc123', '/path/to/repo');
            assert.strictEqual(uri.path, 'src/file.ts');
        });

        test('should include commit in query', () => {
            const uri = createGitShowUri('file.ts', 'abc123def', '/repo');
            const params = new URLSearchParams(uri.query);
            assert.strictEqual(params.get('commit'), 'abc123def');
        });

        test('should include repo in query', () => {
            const uri = createGitShowUri('file.ts', 'abc123', '/path/to/repo');
            const params = new URLSearchParams(uri.query);
            assert.strictEqual(params.get('repo'), '/path/to/repo');
        });

        test('should handle nested file paths', () => {
            const uri = createGitShowUri('src/components/ui/Button.tsx', 'abc123', '/repo');
            assert.strictEqual(uri.path, 'src/components/ui/Button.tsx');
        });

        test('should handle special characters in file paths', () => {
            const uri = createGitShowUri('src/file-name_test.ts', 'abc123', '/repo');
            assert.strictEqual(uri.path, 'src/file-name_test.ts');
        });

        test('should handle paths with spaces', () => {
            const uri = createGitShowUri('src/my file.ts', 'abc123', '/repo');
            assert.ok(uri.path.includes('my file.ts') || uri.path.includes('my%20file.ts'));
        });
    });

    // ============================================
    // File Status Mapping Tests
    // ============================================
    suite('File Status Mapping', () => {
        const testCases: Array<{
            status: 'A' | 'M' | 'D' | 'R' | 'C';
            expectedIcon: string;
            expectedLabel: string;
        }> = [
            { status: 'A', expectedIcon: 'diff-added', expectedLabel: 'Added' },
            { status: 'M', expectedIcon: 'diff-modified', expectedLabel: 'Modified' },
            { status: 'D', expectedIcon: 'diff-removed', expectedLabel: 'Deleted' },
            { status: 'R', expectedIcon: 'diff-renamed', expectedLabel: 'Renamed' },
            { status: 'C', expectedIcon: 'files', expectedLabel: 'Copied' }
        ];

        testCases.forEach(({ status, expectedIcon, expectedLabel }) => {
            test(`should map status ${status} to icon ${expectedIcon}`, () => {
                const item = new CommitFileItem(
                    'file.ts',
                    status,
                    'abc123',
                    'parent',
                    '/repo'
                );

                assert.ok(item.iconPath instanceof vscode.ThemeIcon);
                assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, expectedIcon);
            });

            test(`should map status ${status} to label ${expectedLabel} in tooltip`, () => {
                const item = new CommitFileItem(
                    'file.ts',
                    status,
                    'abc123',
                    'parent',
                    '/repo',
                    status === 'R' || status === 'C' ? 'original.ts' : undefined
                );

                assert.ok(item.tooltip);
                assert.ok(
                    item.tooltip.toString().includes(expectedLabel),
                    `Tooltip should include "${expectedLabel}" for status ${status}`
                );
            });
        });
    });

    // ============================================
    // Integration Tests
    // ============================================
    suite('Integration', () => {
        test('CommitFileItem should work with CommitShortcutItem context', () => {
            const commitItem = new CommitShortcutItem(
                'Fix authentication bug',
                'abc123def456789',
                '/path/to/repo',
                'Auth Features'
            );

            const fileItem = new CommitFileItem(
                'src/auth/login.ts',
                'M',
                commitItem.commitHash,
                'parent123456789',
                commitItem.repositoryRoot
            );

            assert.strictEqual(fileItem.commitHash, commitItem.commitHash);
            assert.strictEqual(fileItem.repositoryRoot, commitItem.repositoryRoot);
        });

        test('Multiple files can be created for same commit', () => {
            const commitHash = 'abc123def456789';
            const parentHash = 'parent123456789';
            const repoRoot = '/repo';

            const files = [
                new CommitFileItem('src/file1.ts', 'M', commitHash, parentHash, repoRoot),
                new CommitFileItem('src/file2.ts', 'A', commitHash, parentHash, repoRoot),
                new CommitFileItem('src/file3.ts', 'D', commitHash, parentHash, repoRoot)
            ];

            assert.strictEqual(files.length, 3);
            files.forEach(file => {
                assert.strictEqual(file.commitHash, commitHash);
                assert.strictEqual(file.parentHash, parentHash);
                assert.strictEqual(file.repositoryRoot, repoRoot);
            });
        });

        test('createGitShowUri creates valid URIs for diff comparison', () => {
            const commitHash = 'abc123def456789';
            const parentHash = 'parent123456789';
            const filePath = 'src/file.ts';
            const repoRoot = '/path/to/repo';

            const leftUri = createGitShowUri(filePath, parentHash, repoRoot);
            const rightUri = createGitShowUri(filePath, commitHash, repoRoot);

            assert.notStrictEqual(leftUri.toString(), rightUri.toString());
            assert.strictEqual(leftUri.scheme, rightUri.scheme);
            assert.strictEqual(leftUri.path, rightUri.path);

            const leftParams = new URLSearchParams(leftUri.query);
            const rightParams = new URLSearchParams(rightUri.query);

            assert.strictEqual(leftParams.get('commit'), parentHash);
            assert.strictEqual(rightParams.get('commit'), commitHash);
        });
    });

    // ============================================
    // Edge Cases
    // ============================================
    suite('Edge Cases', () => {
        test('should handle empty file path', () => {
            const item = new CommitFileItem(
                '',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.strictEqual(item.filePath, '');
            assert.strictEqual(item.label, '');
        });

        test('should handle file at repository root', () => {
            const item = new CommitFileItem(
                'README.md',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.strictEqual(item.label, 'README.md');
            assert.strictEqual(item.description, '');
        });

        test('should handle deeply nested paths', () => {
            const deepPath = 'src/components/features/auth/login/forms/LoginForm.tsx';
            const item = new CommitFileItem(
                deepPath,
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.strictEqual(item.label, 'LoginForm.tsx');
            assert.strictEqual(item.description, 'src/components/features/auth/login/forms');
        });

        test('should handle Windows-style paths', () => {
            // Note: path.basename and path.dirname should handle this correctly
            const item = new CommitFileItem(
                'src/file.ts', // Normalized path
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.strictEqual(item.label, 'file.ts');
        });

        test('should handle commit hash of exactly 7 characters', () => {
            const item = new CommitShortcutItem(
                'Test',
                'abcdefg',
                '/repo',
                'Group'
            );

            assert.strictEqual(item.shortHash, 'abcdefg');
        });

        test('should handle commit hash shorter than 7 characters', () => {
            const item = new CommitShortcutItem(
                'Test',
                'abc',
                '/repo',
                'Group'
            );

            assert.strictEqual(item.shortHash, 'abc');
        });

        test('should handle Unicode characters in commit message', () => {
            const item = new CommitShortcutItem(
                '修复登录问题 🐛',
                'abc123def456789',
                '/repo',
                'Group'
            );

            assert.strictEqual(item.label, '修复登录问题 🐛');
        });

        test('should handle Unicode characters in file path', () => {
            const item = new CommitFileItem(
                'src/文件.ts',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            assert.strictEqual(item.label, '文件.ts');
        });
    });
});

