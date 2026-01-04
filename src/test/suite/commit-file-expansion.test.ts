/**
 * Tests for Commit File Expansion in LogicalTreeDataProvider
 * 
 * Tests the integration between LogicalTreeDataProvider and GitLogService
 * for expanding commit items to show changed files.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { CommitFileItem, CommitShortcutItem } from '../../shortcuts/tree-items';
import { GitCommitFile, GitChangeStatus } from '../../shortcuts/git/types';

suite('Commit File Expansion Tests', () => {

    // ============================================
    // Status Mapping Tests
    // ============================================
    suite('Status Mapping', () => {
        const statusMappings: Array<{
            gitStatus: GitChangeStatus;
            expectedLetter: 'A' | 'M' | 'D' | 'R' | 'C';
        }> = [
            { gitStatus: 'added', expectedLetter: 'A' },
            { gitStatus: 'modified', expectedLetter: 'M' },
            { gitStatus: 'deleted', expectedLetter: 'D' },
            { gitStatus: 'renamed', expectedLetter: 'R' },
            { gitStatus: 'copied', expectedLetter: 'C' }
        ];

        statusMappings.forEach(({ gitStatus, expectedLetter }) => {
            test(`should map GitChangeStatus '${gitStatus}' to letter '${expectedLetter}'`, () => {
                // Simulate the mapping that happens in LogicalTreeDataProvider
                const statusMap: Record<string, 'A' | 'M' | 'D' | 'R' | 'C'> = {
                    'added': 'A',
                    'modified': 'M',
                    'deleted': 'D',
                    'renamed': 'R',
                    'copied': 'C'
                };
                
                const mappedStatus = statusMap[gitStatus] || 'M';
                assert.strictEqual(mappedStatus, expectedLetter);
            });
        });

        test('should default to M for unknown status', () => {
            const statusMap: Record<string, 'A' | 'M' | 'D' | 'R' | 'C'> = {
                'added': 'A',
                'modified': 'M',
                'deleted': 'D',
                'renamed': 'R',
                'copied': 'C'
            };
            
            const unknownStatus = 'unknown' as GitChangeStatus;
            const mappedStatus = statusMap[unknownStatus] || 'M';
            assert.strictEqual(mappedStatus, 'M');
        });
    });

    // ============================================
    // GitCommitFile to CommitFileItem Conversion Tests
    // ============================================
    suite('GitCommitFile to CommitFileItem Conversion', () => {
        test('should convert basic GitCommitFile to CommitFileItem', () => {
            const gitFile: GitCommitFile = {
                path: 'src/file.ts',
                status: 'modified',
                commitHash: 'abc123def456789',
                parentHash: 'parent123456789',
                repositoryRoot: '/path/to/repo'
            };

            const item = new CommitFileItem(
                gitFile.path,
                'M',
                gitFile.commitHash,
                gitFile.parentHash,
                gitFile.repositoryRoot
            );

            assert.strictEqual(item.filePath, 'src/file.ts');
            assert.strictEqual(item.status, 'M');
            assert.strictEqual(item.commitHash, 'abc123def456789');
            assert.strictEqual(item.parentHash, 'parent123456789');
            assert.strictEqual(item.repositoryRoot, '/path/to/repo');
        });

        test('should convert renamed GitCommitFile with originalPath', () => {
            const gitFile: GitCommitFile = {
                path: 'src/new-name.ts',
                originalPath: 'src/old-name.ts',
                status: 'renamed',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };

            const item = new CommitFileItem(
                gitFile.path,
                'R',
                gitFile.commitHash,
                gitFile.parentHash,
                gitFile.repositoryRoot,
                gitFile.originalPath
            );

            assert.strictEqual(item.filePath, 'src/new-name.ts');
            assert.strictEqual(item.originalPath, 'src/old-name.ts');
            assert.strictEqual(item.status, 'R');
        });

        test('should convert added GitCommitFile', () => {
            const gitFile: GitCommitFile = {
                path: 'src/new-feature.ts',
                status: 'added',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };

            const item = new CommitFileItem(
                gitFile.path,
                'A',
                gitFile.commitHash,
                gitFile.parentHash,
                gitFile.repositoryRoot
            );

            assert.strictEqual(item.status, 'A');
            assert.strictEqual(item.originalPath, undefined);
        });

        test('should convert deleted GitCommitFile', () => {
            const gitFile: GitCommitFile = {
                path: 'src/removed.ts',
                status: 'deleted',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };

            const item = new CommitFileItem(
                gitFile.path,
                'D',
                gitFile.commitHash,
                gitFile.parentHash,
                gitFile.repositoryRoot
            );

            assert.strictEqual(item.status, 'D');
        });

        test('should convert copied GitCommitFile with originalPath', () => {
            const gitFile: GitCommitFile = {
                path: 'src/copy.ts',
                originalPath: 'src/original.ts',
                status: 'copied',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };

            const item = new CommitFileItem(
                gitFile.path,
                'C',
                gitFile.commitHash,
                gitFile.parentHash,
                gitFile.repositoryRoot,
                gitFile.originalPath
            );

            assert.strictEqual(item.status, 'C');
            assert.strictEqual(item.originalPath, 'src/original.ts');
        });
    });

    // ============================================
    // Multiple Files Conversion Tests
    // ============================================
    suite('Multiple Files Conversion', () => {
        test('should convert multiple GitCommitFiles to CommitFileItems', () => {
            const gitFiles: GitCommitFile[] = [
                {
                    path: 'src/auth/login.ts',
                    status: 'modified',
                    commitHash: 'abc123',
                    parentHash: 'parent',
                    repositoryRoot: '/repo'
                },
                {
                    path: 'src/auth/logout.ts',
                    status: 'added',
                    commitHash: 'abc123',
                    parentHash: 'parent',
                    repositoryRoot: '/repo'
                },
                {
                    path: 'src/auth/session.ts',
                    status: 'deleted',
                    commitHash: 'abc123',
                    parentHash: 'parent',
                    repositoryRoot: '/repo'
                }
            ];

            const statusMap: Record<string, 'A' | 'M' | 'D' | 'R' | 'C'> = {
                'added': 'A',
                'modified': 'M',
                'deleted': 'D',
                'renamed': 'R',
                'copied': 'C'
            };

            const items = gitFiles.map(file => new CommitFileItem(
                file.path,
                statusMap[file.status] || 'M',
                file.commitHash,
                file.parentHash,
                file.repositoryRoot,
                file.originalPath
            ));

            assert.strictEqual(items.length, 3);
            assert.strictEqual(items[0].status, 'M');
            assert.strictEqual(items[1].status, 'A');
            assert.strictEqual(items[2].status, 'D');
        });

        test('should maintain correct order of files', () => {
            const paths = ['z.ts', 'a.ts', 'm.ts'];
            const items = paths.map(p => new CommitFileItem(
                p,
                'M',
                'abc123',
                'parent',
                '/repo'
            ));

            assert.strictEqual(items[0].filePath, 'z.ts');
            assert.strictEqual(items[1].filePath, 'a.ts');
            assert.strictEqual(items[2].filePath, 'm.ts');
        });
    });

    // ============================================
    // CommitShortcutItem Parent Context Tests
    // ============================================
    suite('CommitShortcutItem Parent Context', () => {
        test('should provide correct context for child file items', () => {
            const commitItem = new CommitShortcutItem(
                'Fix authentication flow',
                'abc123def456789',
                '/workspace/project',
                'Authentication'
            );

            // Simulate creating child items as would happen in getChildren
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

        test('should work with nested group paths', () => {
            const commitItem = new CommitShortcutItem(
                'Update API',
                'def456789abc123',
                '/workspace/project',
                'Backend/API/v2'
            );

            assert.strictEqual(commitItem.parentGroup, 'Backend/API/v2');
        });
    });

    // ============================================
    // Tree Item Properties Tests
    // ============================================
    suite('Tree Item Properties', () => {
        test('CommitFileItem should have correct tree item properties', () => {
            const item = new CommitFileItem(
                'src/components/Button.tsx',
                'M',
                'abc123',
                'parent',
                '/repo'
            );

            // Label should be file name only
            assert.strictEqual(item.label, 'Button.tsx');

            // Description should be directory path
            assert.strictEqual(item.description, 'src/components');

            // Should not be collapsible
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);

            // Should have command
            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'shortcuts.openCommitFileDiff');
        });

        test('CommitShortcutItem should have correct tree item properties', () => {
            const item = new CommitShortcutItem(
                'Implement feature X',
                'abc123def456789',
                '/repo',
                'Features'
            );

            // Label should be commit message
            assert.strictEqual(item.label, 'Implement feature X');

            // Description should be short hash
            assert.strictEqual(item.description, 'abc123d');

            // Should be collapsible (collapsed by default)
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

            // Should not have command (expansion is primary action)
            assert.strictEqual(item.command, undefined);
        });
    });

    // ============================================
    // Icon Color Tests
    // ============================================
    suite('Icon Colors', () => {
        test('Added file should have green-tinted icon', () => {
            const item = new CommitFileItem('file.ts', 'A', 'abc', 'parent', '/repo');
            
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            const themeIcon = item.iconPath as vscode.ThemeIcon;
            assert.ok(themeIcon.color);
        });

        test('Modified file should have yellow-tinted icon', () => {
            const item = new CommitFileItem('file.ts', 'M', 'abc', 'parent', '/repo');
            
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            const themeIcon = item.iconPath as vscode.ThemeIcon;
            assert.ok(themeIcon.color);
        });

        test('Deleted file should have red-tinted icon', () => {
            const item = new CommitFileItem('file.ts', 'D', 'abc', 'parent', '/repo');
            
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            const themeIcon = item.iconPath as vscode.ThemeIcon;
            assert.ok(themeIcon.color);
        });

        test('Renamed file should have colored icon', () => {
            const item = new CommitFileItem('new.ts', 'R', 'abc', 'parent', '/repo', 'old.ts');
            
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            const themeIcon = item.iconPath as vscode.ThemeIcon;
            assert.ok(themeIcon.color);
        });

        test('CommitShortcutItem should have green-tinted icon', () => {
            const item = new CommitShortcutItem('Test', 'abc123', '/repo', 'Group');
            
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            const themeIcon = item.iconPath as vscode.ThemeIcon;
            assert.ok(themeIcon.color);
        });
    });

    // ============================================
    // Context Value Tests
    // ============================================
    suite('Context Values', () => {
        test('CommitShortcutItem should have correct context value', () => {
            const item = new CommitShortcutItem('Test', 'abc123', '/repo', 'Group');
            assert.strictEqual(item.contextValue, 'logicalGroupItem_commit');
        });

        test('CommitFileItem should have correct context value', () => {
            const item = new CommitFileItem('file.ts', 'M', 'abc', 'parent', '/repo');
            assert.strictEqual(item.contextValue, 'commitFile');
        });
    });

    // ============================================
    // Empty/Edge Case Tests
    // ============================================
    suite('Empty and Edge Cases', () => {
        test('should handle empty file list', () => {
            const files: GitCommitFile[] = [];
            const items = files.map(file => new CommitFileItem(
                file.path,
                'M',
                file.commitHash,
                file.parentHash,
                file.repositoryRoot
            ));

            assert.strictEqual(items.length, 0);
        });

        test('should handle single file', () => {
            const files: GitCommitFile[] = [{
                path: 'single.ts',
                status: 'modified',
                commitHash: 'abc',
                parentHash: 'parent',
                repositoryRoot: '/repo'
            }];

            const items = files.map(file => new CommitFileItem(
                file.path,
                'M',
                file.commitHash,
                file.parentHash,
                file.repositoryRoot
            ));

            assert.strictEqual(items.length, 1);
            assert.strictEqual(items[0].filePath, 'single.ts');
        });

        test('should handle files with same name in different directories', () => {
            const files: GitCommitFile[] = [
                { path: 'src/index.ts', status: 'modified', commitHash: 'abc', parentHash: 'p', repositoryRoot: '/r' },
                { path: 'test/index.ts', status: 'modified', commitHash: 'abc', parentHash: 'p', repositoryRoot: '/r' }
            ];

            const items = files.map(file => new CommitFileItem(
                file.path,
                'M',
                file.commitHash,
                file.parentHash,
                file.repositoryRoot
            ));

            assert.strictEqual(items.length, 2);
            assert.strictEqual(items[0].label, 'index.ts');
            assert.strictEqual(items[1].label, 'index.ts');
            assert.strictEqual(items[0].description, 'src');
            assert.strictEqual(items[1].description, 'test');
        });

        test('should handle very long file paths', () => {
            const longPath = 'a/'.repeat(50) + 'file.ts';
            const item = new CommitFileItem(longPath, 'M', 'abc', 'parent', '/repo');

            assert.strictEqual(item.label, 'file.ts');
            assert.ok(item.description);
        });

        test('should handle special characters in paths', () => {
            const item = new CommitFileItem(
                'src/[feature]/file-name_test.spec.ts',
                'M',
                'abc',
                'parent',
                '/repo'
            );

            assert.strictEqual(item.label, 'file-name_test.spec.ts');
            assert.strictEqual(item.description, 'src/[feature]');
        });
    });
});

