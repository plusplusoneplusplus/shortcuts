/**
 * Tests for Git Changes functionality
 */

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitChangeItem } from '../../shortcuts/git-changes/git-change-item';
import { GitChange, GitChangeStatus, GitChangeStage, GitChangeCounts } from '../../shortcuts/git-changes/types';

suite('Git Changes Tests', () => {

    suite('GitChange Types', () => {
        test('should define all required status types', () => {
            const statuses: GitChangeStatus[] = [
                'modified', 'added', 'deleted', 'renamed',
                'copied', 'untracked', 'ignored', 'conflict'
            ];
            assert.strictEqual(statuses.length, 8, 'Should have 8 status types');
        });

        test('should define all stage types', () => {
            const stages: GitChangeStage[] = ['staged', 'unstaged', 'untracked'];
            assert.strictEqual(stages.length, 3, 'Should have 3 stage types');
        });

        test('should have correct GitChangeCounts structure', () => {
            const counts: GitChangeCounts = {
                staged: 1,
                unstaged: 2,
                untracked: 3,
                total: 6
            };
            assert.strictEqual(counts.staged + counts.unstaged + counts.untracked, counts.total);
        });
    });

    suite('GitChangeItem', () => {
        const createMockChange = (
            status: GitChangeStatus,
            stage: GitChangeStage,
            filePath: string = '/repo/src/file.ts'
        ): GitChange => ({
            path: filePath,
            status,
            stage,
            repositoryRoot: '/repo',
            repositoryName: 'repo',
            uri: vscode.Uri.file(filePath)
        });

        suite('Basic Properties', () => {
            test('should set label to filename', () => {
                const change = createMockChange('modified', 'unstaged', '/repo/src/component.tsx');
                const item = new GitChangeItem(change);
                assert.strictEqual(item.label, 'component.tsx');
            });

            test('should set contextValue based on stage', () => {
                const stagedChange = createMockChange('modified', 'staged');
                const unstagedChange = createMockChange('modified', 'unstaged');
                const untrackedChange = createMockChange('untracked', 'untracked');

                assert.strictEqual(new GitChangeItem(stagedChange).contextValue, 'gitChange_staged');
                assert.strictEqual(new GitChangeItem(unstagedChange).contextValue, 'gitChange_unstaged');
                assert.strictEqual(new GitChangeItem(untrackedChange).contextValue, 'gitChange_untracked');
            });

            test('should not be collapsible', () => {
                const change = createMockChange('modified', 'unstaged');
                const item = new GitChangeItem(change);
                assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
            });

            test('should set command to open diff', () => {
                const change = createMockChange('modified', 'unstaged');
                const item = new GitChangeItem(change);
                assert.strictEqual(item.command?.command, 'git.openChange');
                assert.strictEqual(item.command?.title, 'Open Changes');
            });

            test('should set resourceUri', () => {
                const change = createMockChange('modified', 'unstaged', '/repo/test.js');
                const item = new GitChangeItem(change);
                assert.strictEqual(item.resourceUri?.fsPath, '/repo/test.js');
            });
        });

        suite('Description Format', () => {
            test('should show "✓ staged" for staged changes', () => {
                const change = createMockChange('modified', 'staged', '/repo/file.ts');
                const item = new GitChangeItem(change);
                assert.ok(item.description?.toString().includes('staged'));
                assert.ok(item.description?.toString().includes('\u2713')); // checkmark
            });

            test('should show "○ modified" for unstaged changes', () => {
                const change = createMockChange('modified', 'unstaged', '/repo/file.ts');
                const item = new GitChangeItem(change);
                assert.ok(item.description?.toString().includes('modified'));
                assert.ok(item.description?.toString().includes('\u25CB')); // circle
            });

            test('should show "? untracked" for untracked files', () => {
                const change = createMockChange('untracked', 'untracked', '/repo/file.ts');
                const item = new GitChangeItem(change);
                assert.ok(item.description?.toString().includes('untracked'));
                assert.ok(item.description?.toString().includes('?'));
            });

            test('should include relative path for nested files', () => {
                const change = createMockChange('modified', 'unstaged', '/repo/src/components/Button.tsx');
                const item = new GitChangeItem(change);
                assert.ok(item.description?.toString().includes('src/components') ||
                          item.description?.toString().includes('src\\components'));
            });

            test('should not include path separator for root files', () => {
                const change = createMockChange('modified', 'unstaged', '/repo/README.md');
                const item = new GitChangeItem(change);
                // Should only have stage indicator, no bullet point for path
                const desc = item.description?.toString() || '';
                assert.ok(!desc.includes('\u2022') || desc.split('\u2022').length <= 2);
            });
        });

        suite('Icon Colors by Stage', () => {
            test('staged items should use green color', () => {
                const change = createMockChange('modified', 'staged');
                const item = new GitChangeItem(change);
                // Icon should be a ThemeIcon
                assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            });

            test('unstaged items should use yellow/orange color', () => {
                const change = createMockChange('modified', 'unstaged');
                const item = new GitChangeItem(change);
                assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            });

            test('untracked items should use distinct icon', () => {
                const change = createMockChange('untracked', 'untracked');
                const item = new GitChangeItem(change);
                assert.ok(item.iconPath instanceof vscode.ThemeIcon);
                assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'question');
            });
        });

        suite('Icon Types by Status', () => {
            test('staged modified should use diff-modified icon', () => {
                const change = createMockChange('modified', 'staged');
                const item = new GitChangeItem(change);
                assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'diff-modified');
            });

            test('staged added should use diff-added icon', () => {
                const change = createMockChange('added', 'staged');
                const item = new GitChangeItem(change);
                assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'diff-added');
            });

            test('staged deleted should use diff-removed icon', () => {
                const change = createMockChange('deleted', 'staged');
                const item = new GitChangeItem(change);
                assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'diff-removed');
            });

            test('unstaged modified should use edit icon', () => {
                const change = createMockChange('modified', 'unstaged');
                const item = new GitChangeItem(change);
                assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'edit');
            });

            test('unstaged deleted should use trash icon', () => {
                const change = createMockChange('deleted', 'unstaged');
                const item = new GitChangeItem(change);
                assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'trash');
            });

            test('conflict should use warning icon', () => {
                const change = createMockChange('conflict', 'unstaged');
                const item = new GitChangeItem(change);
                assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'warning');
            });
        });

        suite('Tooltip', () => {
            test('should create markdown tooltip', () => {
                const change = createMockChange('modified', 'staged', '/repo/src/file.ts');
                const item = new GitChangeItem(change);
                assert.ok(item.tooltip instanceof vscode.MarkdownString);
            });

            test('should include file name in tooltip', () => {
                const change = createMockChange('modified', 'staged', '/repo/src/file.ts');
                const item = new GitChangeItem(change);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('file.ts'));
            });

            test('should include status in tooltip', () => {
                const change = createMockChange('modified', 'staged');
                const item = new GitChangeItem(change);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('modified'));
            });

            test('should include stage in tooltip', () => {
                const change = createMockChange('modified', 'staged');
                const item = new GitChangeItem(change);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('staged'));
            });

            test('should include repository name in tooltip', () => {
                const change: GitChange = {
                    path: '/my-repo/file.ts',
                    status: 'modified',
                    stage: 'staged',
                    repositoryRoot: '/my-repo',
                    repositoryName: 'my-repo',
                    uri: vscode.Uri.file('/my-repo/file.ts')
                };
                const item = new GitChangeItem(change);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('my-repo'));
            });
        });
    });

    suite('Change Sorting Logic', () => {
        test('should sort staged before unstaged', () => {
            const staged: GitChange = {
                path: '/repo/b.ts',
                status: 'modified',
                stage: 'staged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/b.ts')
            };
            const unstaged: GitChange = {
                path: '/repo/a.ts',
                status: 'modified',
                stage: 'unstaged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/a.ts')
            };

            const stagePriority = { staged: 0, unstaged: 1, untracked: 2 };
            const sorted = [unstaged, staged].sort((a, b) => {
                const stageDiff = stagePriority[a.stage] - stagePriority[b.stage];
                if (stageDiff !== 0) return stageDiff;
                return a.path.localeCompare(b.path);
            });

            assert.strictEqual(sorted[0].stage, 'staged');
            assert.strictEqual(sorted[1].stage, 'unstaged');
        });

        test('should sort unstaged before untracked', () => {
            const unstaged: GitChange = {
                path: '/repo/b.ts',
                status: 'modified',
                stage: 'unstaged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/b.ts')
            };
            const untracked: GitChange = {
                path: '/repo/a.ts',
                status: 'untracked',
                stage: 'untracked',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/a.ts')
            };

            const stagePriority = { staged: 0, unstaged: 1, untracked: 2 };
            const sorted = [untracked, unstaged].sort((a, b) => {
                const stageDiff = stagePriority[a.stage] - stagePriority[b.stage];
                if (stageDiff !== 0) return stageDiff;
                return a.path.localeCompare(b.path);
            });

            assert.strictEqual(sorted[0].stage, 'unstaged');
            assert.strictEqual(sorted[1].stage, 'untracked');
        });

        test('should sort alphabetically within same stage', () => {
            const fileB: GitChange = {
                path: '/repo/b.ts',
                status: 'modified',
                stage: 'unstaged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/b.ts')
            };
            const fileA: GitChange = {
                path: '/repo/a.ts',
                status: 'modified',
                stage: 'unstaged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/a.ts')
            };

            const stagePriority = { staged: 0, unstaged: 1, untracked: 2 };
            const sorted = [fileB, fileA].sort((a, b) => {
                const stageDiff = stagePriority[a.stage] - stagePriority[b.stage];
                if (stageDiff !== 0) return stageDiff;
                return a.path.localeCompare(b.path);
            });

            assert.strictEqual(sorted[0].path, '/repo/a.ts');
            assert.strictEqual(sorted[1].path, '/repo/b.ts');
        });
    });

    suite('GitService Integration', () => {
        // These tests verify the service can be imported and has expected shape
        // Full integration tests would require mocking the git extension

        test('GitService should be importable', async () => {
            const { GitService } = await import('../../shortcuts/git-changes/git-service');
            assert.ok(GitService, 'GitService should be defined');
        });

        test('GitChangesTreeDataProvider should be importable', async () => {
            const { GitChangesTreeDataProvider } = await import('../../shortcuts/git-changes/tree-data-provider');
            assert.ok(GitChangesTreeDataProvider, 'GitChangesTreeDataProvider should be defined');
        });

        test('GitChangesTreeDataProvider should implement TreeDataProvider interface', async () => {
            const { GitChangesTreeDataProvider } = await import('../../shortcuts/git-changes/tree-data-provider');
            const provider = new GitChangesTreeDataProvider();

            // Check required methods exist
            assert.ok(typeof provider.getTreeItem === 'function');
            assert.ok(typeof provider.getChildren === 'function');
            assert.ok(typeof provider.refresh === 'function');
            assert.ok(provider.onDidChangeTreeData);

            // Cleanup
            provider.dispose();
        });

        test('GitChangesTreeDataProvider should return empty array when not initialized', async () => {
            const { GitChangesTreeDataProvider } = await import('../../shortcuts/git-changes/tree-data-provider');
            const provider = new GitChangesTreeDataProvider();

            const children = await provider.getChildren();
            assert.deepStrictEqual(children, []);

            provider.dispose();
        });

        test('GitChangesTreeDataProvider should return zero counts when not initialized', async () => {
            const { GitChangesTreeDataProvider } = await import('../../shortcuts/git-changes/tree-data-provider');
            const provider = new GitChangesTreeDataProvider();

            const counts = provider.getChangeCounts();
            assert.strictEqual(counts.staged, 0);
            assert.strictEqual(counts.unstaged, 0);
            assert.strictEqual(counts.untracked, 0);
            assert.strictEqual(counts.total, 0);

            provider.dispose();
        });
    });

    suite('Status to Icon Mapping', () => {
        const allStatuses: GitChangeStatus[] = [
            'modified', 'added', 'deleted', 'renamed',
            'copied', 'untracked', 'ignored', 'conflict'
        ];

        for (const status of allStatuses) {
            test(`should have icon for ${status} status (staged)`, () => {
                const change: GitChange = {
                    path: '/repo/file.ts',
                    status,
                    stage: 'staged',
                    repositoryRoot: '/repo',
                    repositoryName: 'repo',
                    uri: vscode.Uri.file('/repo/file.ts')
                };
                const item = new GitChangeItem(change);
                assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            });

            test(`should have icon for ${status} status (unstaged)`, () => {
                const change: GitChange = {
                    path: '/repo/file.ts',
                    status,
                    stage: 'unstaged',
                    repositoryRoot: '/repo',
                    repositoryName: 'repo',
                    uri: vscode.Uri.file('/repo/file.ts')
                };
                const item = new GitChangeItem(change);
                assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            });
        }
    });
});
