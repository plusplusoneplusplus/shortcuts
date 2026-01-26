/**
 * Tests for Git view copy path functionality
 * Covers: Copy Relative Path, Copy Absolute Path for GitChangeItem, GitCommitFileItem, GitRangeFileItem
 */

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitChangeItem } from '../../shortcuts/git/git-change-item';
import { GitCommitFileItem } from '../../shortcuts/git/git-commit-file-item';
import { GitRangeFileItem } from '../../shortcuts/git/git-range-file-item';
import {
    GitChange,
    GitChangeStage,
    GitChangeStatus,
    GitCommitFile,
    GitCommitRange,
    GitCommitRangeFile
} from '../../shortcuts/git/types';

suite('Git Copy Path Tests', () => {
    // Platform-aware paths for cross-platform tests
    const isWindows = process.platform === 'win32';
    const sep = isWindows ? '\\' : '/';
    const repoRoot = isWindows ? 'C:\\repo' : '/repo';
    const workspaceRoot = isWindows ? 'C:\\workspace' : '/workspace';

    // ============================================
    // GitChangeItem Path Tests
    // ============================================
    suite('GitChangeItem - Path Information', () => {
        const createMockChange = (
            status: GitChangeStatus,
            stage: GitChangeStage,
            filePath: string
        ): GitChange => ({
            path: filePath,
            status,
            stage,
            repositoryRoot: repoRoot,
            repositoryName: 'repo',
            uri: vscode.Uri.file(filePath)
        });

        test('should have correct path for staged file', () => {
            const filePath = path.join(repoRoot, 'src', 'component.tsx');
            const change = createMockChange('modified', 'staged', filePath);
            const item = new GitChangeItem(change);
            
            assert.strictEqual(item.change.path, filePath);
            assert.strictEqual(item.change.repositoryRoot, repoRoot);
        });

        test('should have correct path for unstaged file', () => {
            const filePath = path.join(repoRoot, 'lib', 'utils.ts');
            const change = createMockChange('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);
            
            assert.strictEqual(item.change.path, filePath);
        });

        test('should have correct path for untracked file', () => {
            const filePath = path.join(repoRoot, 'new-file.ts');
            const change = createMockChange('untracked', 'untracked', filePath);
            const item = new GitChangeItem(change);
            
            assert.strictEqual(item.change.path, filePath);
        });

        test('should have correct path for nested directory file', () => {
            const filePath = path.join(repoRoot, 'src', 'components', 'ui', 'Button.tsx');
            const change = createMockChange('added', 'staged', filePath);
            const item = new GitChangeItem(change);
            
            assert.strictEqual(item.change.path, filePath);
            assert.ok(item.change.path.includes('components'));
            assert.ok(item.change.path.includes('ui'));
        });

        test('should handle file in root directory', () => {
            const filePath = path.join(repoRoot, 'README.md');
            const change = createMockChange('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);
            
            assert.strictEqual(item.change.path, filePath);
            assert.strictEqual(path.basename(item.change.path), 'README.md');
        });

        test('should preserve repositoryRoot for path calculation', () => {
            const customRepoRoot = isWindows ? 'D:\\projects\\my-repo' : '/home/user/projects/my-repo';
            const filePath = path.join(customRepoRoot, 'src', 'index.ts');
            const change: GitChange = {
                path: filePath,
                status: 'modified',
                stage: 'staged',
                repositoryRoot: customRepoRoot,
                repositoryName: 'my-repo',
                uri: vscode.Uri.file(filePath)
            };
            const item = new GitChangeItem(change);
            
            assert.strictEqual(item.change.repositoryRoot, customRepoRoot);
            assert.strictEqual(item.change.path, filePath);
        });

        test('should handle files with special characters in name', () => {
            const filePath = path.join(repoRoot, 'src', 'my-component.test.tsx');
            const change = createMockChange('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);
            
            assert.ok(item.change.path.includes('my-component.test.tsx'));
        });

        test('should handle files with spaces in path', () => {
            const dirWithSpace = isWindows ? 'My Documents' : 'My Documents';
            const filePath = path.join(repoRoot, dirWithSpace, 'file.ts');
            const change = createMockChange('added', 'staged', filePath);
            const item = new GitChangeItem(change);
            
            assert.ok(item.change.path.includes(dirWithSpace));
        });
    });

    // ============================================
    // GitCommitFileItem Path Tests
    // ============================================
    suite('GitCommitFileItem - Path Information', () => {
        const createMockCommitFile = (relativePath: string, commitHash: string = 'abc1234'): GitCommitFile => ({
            path: relativePath,
            status: 'modified',
            commitHash,
            parentHash: 'parent123',
            repositoryRoot: repoRoot
        });

        test('should have correct relative path for commit file', () => {
            const relativePath = path.join('src', 'component.tsx');
            const file = createMockCommitFile(relativePath);
            const item = new GitCommitFileItem(file);
            
            assert.strictEqual(item.file.path, relativePath);
            assert.strictEqual(item.file.repositoryRoot, repoRoot);
        });

        test('should have correct path for deeply nested commit file', () => {
            const relativePath = path.join('src', 'components', 'ui', 'forms', 'Input.tsx');
            const file = createMockCommitFile(relativePath);
            const item = new GitCommitFileItem(file);
            
            assert.strictEqual(item.file.path, relativePath);
            assert.ok(item.file.path.includes('forms'));
        });

        test('should construct full path from repositoryRoot and path', () => {
            const relativePath = path.join('lib', 'utils.ts');
            const file = createMockCommitFile(relativePath);
            const item = new GitCommitFileItem(file);
            
            const expectedFullPath = path.join(repoRoot, relativePath);
            const actualFullPath = path.join(item.file.repositoryRoot, item.file.path);
            
            assert.strictEqual(actualFullPath, expectedFullPath);
        });

        test('should handle file in repository root', () => {
            const relativePath = 'package.json';
            const file = createMockCommitFile(relativePath);
            const item = new GitCommitFileItem(file);
            
            assert.strictEqual(item.file.path, relativePath);
        });

        test('should preserve commit hash for reference', () => {
            const relativePath = 'src/index.ts';
            const commitHash = 'def5678abcdef1234567890';
            const file = createMockCommitFile(relativePath, commitHash);
            const item = new GitCommitFileItem(file);
            
            assert.strictEqual(item.file.commitHash, commitHash);
        });

        test('should handle renamed files with originalPath', () => {
            const file: GitCommitFile = {
                path: path.join('src', 'new-name.ts'),
                originalPath: path.join('src', 'old-name.ts'),
                status: 'renamed',
                commitHash: 'abc1234',
                parentHash: 'parent123',
                repositoryRoot: repoRoot
            };
            const item = new GitCommitFileItem(file);
            
            assert.strictEqual(item.file.path, path.join('src', 'new-name.ts'));
            assert.strictEqual(item.file.originalPath, path.join('src', 'old-name.ts'));
        });
    });

    // ============================================
    // GitRangeFileItem Path Tests
    // ============================================
    suite('GitRangeFileItem - Path Information', () => {
        const createMockRangeFile = (relativePath: string): GitCommitRangeFile => ({
            path: relativePath,
            status: 'modified',
            additions: 10,
            deletions: 5,
            repositoryRoot: repoRoot
        });

        const createMockRange = (): GitCommitRange => ({
            baseRef: 'main',
            headRef: 'feature-branch',
            mergeBase: 'abc123',
            commitCount: 3,
            files: [],
            additions: 100,
            deletions: 50,
            repositoryRoot: repoRoot,
            repositoryName: 'repo'
        });

        test('should have correct relative path for range file', () => {
            const relativePath = path.join('src', 'feature.ts');
            const file = createMockRangeFile(relativePath);
            const range = createMockRange();
            const item = new GitRangeFileItem(file, range);
            
            assert.strictEqual(item.file.path, relativePath);
            assert.strictEqual(item.file.repositoryRoot, repoRoot);
        });

        test('should have correct path for deeply nested range file', () => {
            const relativePath = path.join('packages', 'core', 'src', 'utils', 'helpers.ts');
            const file = createMockRangeFile(relativePath);
            const range = createMockRange();
            const item = new GitRangeFileItem(file, range);
            
            assert.strictEqual(item.file.path, relativePath);
        });

        test('should construct full path from repositoryRoot and path', () => {
            const relativePath = path.join('tests', 'unit', 'test.spec.ts');
            const file = createMockRangeFile(relativePath);
            const range = createMockRange();
            const item = new GitRangeFileItem(file, range);
            
            const expectedFullPath = path.join(repoRoot, relativePath);
            const actualFullPath = path.join(item.file.repositoryRoot, item.file.path);
            
            assert.strictEqual(actualFullPath, expectedFullPath);
        });

        test('should preserve range information', () => {
            const relativePath = 'src/index.ts';
            const file = createMockRangeFile(relativePath);
            const range = createMockRange();
            const item = new GitRangeFileItem(file, range);
            
            assert.strictEqual(item.range.baseRef, 'main');
            assert.strictEqual(item.range.headRef, 'feature-branch');
        });

        test('should handle file with old path (renamed)', () => {
            const file: GitCommitRangeFile = {
                path: path.join('src', 'renamed-file.ts'),
                oldPath: path.join('src', 'original-file.ts'),
                status: 'renamed',
                additions: 0,
                deletions: 0,
                repositoryRoot: repoRoot
            };
            const range = createMockRange();
            const item = new GitRangeFileItem(file, range);
            
            assert.strictEqual(item.file.path, path.join('src', 'renamed-file.ts'));
            assert.strictEqual(item.file.oldPath, path.join('src', 'original-file.ts'));
        });
    });

    // ============================================
    // Path Calculation Tests (for copy functionality)
    // ============================================
    suite('Path Calculation for Copy', () => {
        test('should calculate relative path from workspace root for GitChangeItem', () => {
            const filePath = path.join(repoRoot, 'src', 'file.ts');
            const change: GitChange = {
                path: filePath,
                status: 'modified',
                stage: 'staged',
                repositoryRoot: repoRoot,
                repositoryName: 'repo',
                uri: vscode.Uri.file(filePath)
            };
            const item = new GitChangeItem(change);
            
            // When calculating relative path for copy, we use the path relative to repo root
            const relativePath = path.relative(repoRoot, item.change.path);
            assert.strictEqual(relativePath, path.join('src', 'file.ts'));
        });

        test('should return absolute path for GitChangeItem', () => {
            const filePath = path.join(repoRoot, 'lib', 'utils.ts');
            const change: GitChange = {
                path: filePath,
                status: 'modified',
                stage: 'unstaged',
                repositoryRoot: repoRoot,
                repositoryName: 'repo',
                uri: vscode.Uri.file(filePath)
            };
            const item = new GitChangeItem(change);
            
            assert.strictEqual(item.change.path, filePath);
            assert.ok(path.isAbsolute(item.change.path));
        });

        test('should calculate relative path for GitCommitFileItem', () => {
            const relativePath = path.join('src', 'component.tsx');
            const file: GitCommitFile = {
                path: relativePath,
                status: 'modified',
                commitHash: 'abc1234',
                parentHash: 'parent123',
                repositoryRoot: repoRoot
            };
            const item = new GitCommitFileItem(file);
            
            // GitCommitFileItem typically stores relative path
            assert.strictEqual(item.file.path, relativePath);
        });

        test('should calculate absolute path for GitCommitFileItem', () => {
            const relativePath = path.join('src', 'component.tsx');
            const file: GitCommitFile = {
                path: relativePath,
                status: 'modified',
                commitHash: 'abc1234',
                parentHash: 'parent123',
                repositoryRoot: repoRoot
            };
            const item = new GitCommitFileItem(file);
            
            const absolutePath = path.isAbsolute(item.file.path)
                ? item.file.path
                : path.join(item.file.repositoryRoot, item.file.path);
            
            assert.strictEqual(absolutePath, path.join(repoRoot, relativePath));
            assert.ok(path.isAbsolute(absolutePath));
        });

        test('should calculate paths correctly across platforms', () => {
            // Test that path operations work consistently
            const relativePath = ['src', 'components', 'Button.tsx'].join(sep);
            const fullPath = [repoRoot, 'src', 'components', 'Button.tsx'].join(sep);
            
            const file: GitCommitFile = {
                path: relativePath,
                status: 'added',
                commitHash: 'abc1234',
                parentHash: 'parent123',
                repositoryRoot: repoRoot
            };
            const item = new GitCommitFileItem(file);
            
            const calculatedFullPath = path.join(item.file.repositoryRoot, item.file.path);
            assert.strictEqual(calculatedFullPath, fullPath);
        });
    });

    // ============================================
    // Edge Cases
    // ============================================
    suite('Edge Cases', () => {
        test('should handle dot files', () => {
            const filePath = path.join(repoRoot, '.gitignore');
            const change: GitChange = {
                path: filePath,
                status: 'modified',
                stage: 'staged',
                repositoryRoot: repoRoot,
                repositoryName: 'repo',
                uri: vscode.Uri.file(filePath)
            };
            const item = new GitChangeItem(change);
            
            assert.ok(item.change.path.endsWith('.gitignore'));
        });

        test('should handle hidden directories', () => {
            const filePath = path.join(repoRoot, '.vscode', 'settings.json');
            const change: GitChange = {
                path: filePath,
                status: 'modified',
                stage: 'unstaged',
                repositoryRoot: repoRoot,
                repositoryName: 'repo',
                uri: vscode.Uri.file(filePath)
            };
            const item = new GitChangeItem(change);
            
            assert.ok(item.change.path.includes('.vscode'));
        });

        test('should handle files with multiple extensions', () => {
            const filePath = path.join(repoRoot, 'src', 'component.test.tsx');
            const change: GitChange = {
                path: filePath,
                status: 'added',
                stage: 'staged',
                repositoryRoot: repoRoot,
                repositoryName: 'repo',
                uri: vscode.Uri.file(filePath)
            };
            const item = new GitChangeItem(change);
            
            assert.strictEqual(path.basename(item.change.path), 'component.test.tsx');
        });

        test('should handle unicode characters in file names', () => {
            const filePath = path.join(repoRoot, 'src', '日本語ファイル.ts');
            const change: GitChange = {
                path: filePath,
                status: 'added',
                stage: 'staged',
                repositoryRoot: repoRoot,
                repositoryName: 'repo',
                uri: vscode.Uri.file(filePath)
            };
            const item = new GitChangeItem(change);
            
            assert.ok(item.change.path.includes('日本語ファイル'));
        });

        test('should handle very long paths', () => {
            const deepPath = ['src', 'very', 'deep', 'nested', 'directory', 'structure', 'file.ts'].join(sep);
            const filePath = path.join(repoRoot, deepPath);
            const change: GitChange = {
                path: filePath,
                status: 'modified',
                stage: 'staged',
                repositoryRoot: repoRoot,
                repositoryName: 'repo',
                uri: vscode.Uri.file(filePath)
            };
            const item = new GitChangeItem(change);
            
            assert.strictEqual(item.change.path, filePath);
        });
    });

    // ============================================
    // Context Value Tests (for menu contributions)
    // ============================================
    suite('Context Values for Menu Contributions', () => {
        test('GitChangeItem should have correct contextValue prefix', () => {
            const filePath = path.join(repoRoot, 'src', 'file.ts');
            const change: GitChange = {
                path: filePath,
                status: 'modified',
                stage: 'staged',
                repositoryRoot: repoRoot,
                repositoryName: 'repo',
                uri: vscode.Uri.file(filePath)
            };
            const item = new GitChangeItem(change);
            
            assert.ok(item.contextValue?.startsWith('gitChange_'));
        });

        test('GitCommitFileItem should have correct contextValue prefix', () => {
            const file: GitCommitFile = {
                path: path.join('src', 'file.ts'),
                status: 'modified',
                commitHash: 'abc1234',
                parentHash: 'parent123',
                repositoryRoot: repoRoot
            };
            const item = new GitCommitFileItem(file);
            
            assert.ok(item.contextValue?.startsWith('gitCommitFile'));
        });

        test('GitRangeFileItem should have correct contextValue prefix', () => {
            const file: GitCommitRangeFile = {
                path: path.join('src', 'file.ts'),
                status: 'modified',
                additions: 5,
                deletions: 2,
                repositoryRoot: repoRoot
            };
            const range: GitCommitRange = {
                baseRef: 'main',
                headRef: 'feature',
                mergeBase: 'abc123',
                commitCount: 1,
                files: [],
                additions: 5,
                deletions: 2,
                repositoryRoot: repoRoot,
                repositoryName: 'repo'
            };
            const item = new GitRangeFileItem(file, range);
            
            assert.ok(item.contextValue?.startsWith('gitRangeFile'));
        });

        test('GitChangeItem for markdown should include _md suffix', () => {
            const filePath = path.join(repoRoot, 'docs', 'README.md');
            const change: GitChange = {
                path: filePath,
                status: 'modified',
                stage: 'staged',
                repositoryRoot: repoRoot,
                repositoryName: 'repo',
                uri: vscode.Uri.file(filePath)
            };
            const item = new GitChangeItem(change);
            
            assert.ok(item.contextValue?.includes('_md'));
        });

        test('GitCommitFileItem for markdown should include _md suffix', () => {
            const file: GitCommitFile = {
                path: 'docs/README.md',
                status: 'modified',
                commitHash: 'abc1234',
                parentHash: 'parent123',
                repositoryRoot: repoRoot
            };
            const item = new GitCommitFileItem(file);
            
            assert.ok(item.contextValue?.includes('_md'));
        });

        test('GitRangeFileItem for markdown should include _md suffix', () => {
            const file: GitCommitRangeFile = {
                path: 'docs/README.md',
                status: 'modified',
                additions: 5,
                deletions: 2,
                repositoryRoot: repoRoot
            };
            const range: GitCommitRange = {
                baseRef: 'main',
                headRef: 'feature',
                mergeBase: 'abc123',
                commitCount: 1,
                files: [],
                additions: 5,
                deletions: 2,
                repositoryRoot: repoRoot,
                repositoryName: 'repo'
            };
            const item = new GitRangeFileItem(file, range);
            
            assert.ok(item.contextValue?.includes('_md'));
        });
    });

    // ============================================
    // ResourceUri Tests (for file operations)
    // ============================================
    suite('ResourceUri Tests', () => {
        test('GitChangeItem should have resourceUri set', () => {
            const filePath = path.join(repoRoot, 'src', 'file.ts');
            const change: GitChange = {
                path: filePath,
                status: 'modified',
                stage: 'staged',
                repositoryRoot: repoRoot,
                repositoryName: 'repo',
                uri: vscode.Uri.file(filePath)
            };
            const item = new GitChangeItem(change);
            
            assert.ok(item.resourceUri);
            // On Windows, drive letter may be normalized
            if (isWindows) {
                assert.strictEqual(item.resourceUri?.fsPath.toLowerCase(), filePath.toLowerCase());
            } else {
                assert.strictEqual(item.resourceUri?.fsPath, filePath);
            }
        });

        test('GitCommitFileItem should have resourceUri set', () => {
            const relativePath = path.join('src', 'file.ts');
            const file: GitCommitFile = {
                path: relativePath,
                status: 'modified',
                commitHash: 'abc1234',
                parentHash: 'parent123',
                repositoryRoot: repoRoot
            };
            const item = new GitCommitFileItem(file);
            
            assert.ok(item.resourceUri);
            const expectedPath = path.join(repoRoot, relativePath);
            // On Windows, drive letter may be normalized
            if (isWindows) {
                assert.strictEqual(item.resourceUri?.fsPath.toLowerCase(), expectedPath.toLowerCase());
            } else {
                assert.strictEqual(item.resourceUri?.fsPath, expectedPath);
            }
        });

        test('GitRangeFileItem should have resourceUri set', () => {
            const relativePath = path.join('src', 'file.ts');
            const file: GitCommitRangeFile = {
                path: relativePath,
                status: 'modified',
                additions: 5,
                deletions: 2,
                repositoryRoot: repoRoot
            };
            const range: GitCommitRange = {
                baseRef: 'main',
                headRef: 'feature',
                mergeBase: 'abc123',
                commitCount: 1,
                files: [],
                additions: 5,
                deletions: 2,
                repositoryRoot: repoRoot,
                repositoryName: 'repo'
            };
            const item = new GitRangeFileItem(file, range);
            
            assert.ok(item.resourceUri);
            const expectedPath = path.join(repoRoot, relativePath);
            // On Windows, drive letter may be normalized
            if (isWindows) {
                assert.strictEqual(item.resourceUri?.fsPath.toLowerCase(), expectedPath.toLowerCase());
            } else {
                assert.strictEqual(item.resourceUri?.fsPath, expectedPath);
            }
        });
    });
});
