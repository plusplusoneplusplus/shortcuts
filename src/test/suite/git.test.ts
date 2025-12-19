/**
 * Tests for unified Git view functionality
 * Covers: Changes, Commits, Section Headers, Pagination, Tree Structure
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { GitChangeItem } from '../../shortcuts/git/git-change-item';
import { GitCommitItem } from '../../shortcuts/git/git-commit-item';
import { LoadMoreItem } from '../../shortcuts/git/load-more-item';
import { SectionHeaderItem } from '../../shortcuts/git/section-header-item';
import {
    GitChange,
    GitChangeStatus,
    GitChangeStage,
    GitChangeCounts,
    GitCommit,
    CommitLoadOptions,
    CommitLoadResult,
    GitSectionType,
    GitViewCounts
} from '../../shortcuts/git/types';

suite('Git View Tests', () => {

    // ============================================
    // Type Tests
    // ============================================
    suite('Git Types', () => {
        test('should define all required change status types', () => {
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

        test('should have correct GitCommit structure', () => {
            const commit: GitCommit = {
                hash: 'abc123def456789',
                shortHash: 'abc123d',
                subject: 'Fix bug in parser',
                authorName: 'John Doe',
                authorEmail: 'john@example.com',
                date: '2024-01-15T10:30:00Z',
                relativeDate: '2 hours ago',
                parentHashes: 'parent123',
                refs: ['main', 'origin/main'],
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };
            assert.strictEqual(commit.hash, 'abc123def456789');
            assert.strictEqual(commit.shortHash, 'abc123d');
            assert.deepStrictEqual(commit.refs, ['main', 'origin/main']);
        });

        test('should have correct CommitLoadOptions structure', () => {
            const options: CommitLoadOptions = {
                maxCount: 20,
                skip: 0
            };
            assert.strictEqual(options.maxCount, 20);
            assert.strictEqual(options.skip, 0);
        });

        test('should have correct CommitLoadResult structure', () => {
            const result: CommitLoadResult = {
                commits: [],
                hasMore: true
            };
            assert.deepStrictEqual(result.commits, []);
            assert.strictEqual(result.hasMore, true);
        });

        test('should define section types', () => {
            const sections: GitSectionType[] = ['changes', 'commits'];
            assert.strictEqual(sections.length, 2);
        });

        test('should have correct GitViewCounts structure', () => {
            const counts: GitViewCounts = {
                changes: { staged: 1, unstaged: 2, untracked: 0, total: 3 },
                commitCount: 20,
                hasMoreCommits: true
            };
            assert.strictEqual(counts.changes.total, 3);
            assert.strictEqual(counts.commitCount, 20);
            assert.strictEqual(counts.hasMoreCommits, true);
        });
    });

    // ============================================
    // Section Header Tests
    // ============================================
    suite('SectionHeaderItem', () => {
        test('should create changes section header', () => {
            const header = new SectionHeaderItem('changes', 5, false);
            assert.strictEqual(header.label, 'Changes');
            assert.strictEqual(header.sectionType, 'changes');
            assert.strictEqual(header.contextValue, 'gitSection_changes');
            assert.strictEqual(header.description, '5');
        });

        test('should create commits section header', () => {
            const header = new SectionHeaderItem('commits', 20, false);
            assert.strictEqual(header.label, 'Commits');
            assert.strictEqual(header.sectionType, 'commits');
            assert.strictEqual(header.contextValue, 'gitSection_commits');
            assert.strictEqual(header.description, '20');
        });

        test('should show "+" when hasMore is true', () => {
            const header = new SectionHeaderItem('commits', 20, true);
            assert.strictEqual(header.description, '20+');
        });

        test('should show "0" for empty section', () => {
            const header = new SectionHeaderItem('changes', 0, false);
            assert.strictEqual(header.description, '0');
        });

        test('should be expanded by default', () => {
            const header = new SectionHeaderItem('changes', 5, false);
            assert.strictEqual(header.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
        });

        test('should have correct icon for changes section', () => {
            const header = new SectionHeaderItem('changes', 5, false);
            assert.ok(header.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((header.iconPath as vscode.ThemeIcon).id, 'git-compare');
        });

        test('should have correct icon for commits section', () => {
            const header = new SectionHeaderItem('commits', 20, false);
            assert.ok(header.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((header.iconPath as vscode.ThemeIcon).id, 'history');
        });

        test('should have tooltip for changes section', () => {
            const header = new SectionHeaderItem('changes', 5, false);
            assert.ok(header.tooltip?.toString().includes('5'));
            assert.ok(header.tooltip?.toString().includes('change'));
        });

        test('should have tooltip for commits section with hasMore', () => {
            const header = new SectionHeaderItem('commits', 20, true);
            assert.ok(header.tooltip?.toString().includes('20'));
            assert.ok(header.tooltip?.toString().includes('more available'));
        });

        test('should have tooltip for empty section', () => {
            const header = new SectionHeaderItem('changes', 0, false);
            assert.ok(header.tooltip?.toString().includes('No'));
        });
    });

    // ============================================
    // GitChangeItem Tests (existing + enhanced)
    // ============================================
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

            test('should store the change object', () => {
                const change = createMockChange('modified', 'staged');
                const item = new GitChangeItem(change);
                assert.strictEqual(item.change, change);
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

            test('untracked should use question icon', () => {
                const change = createMockChange('untracked', 'untracked');
                const item = new GitChangeItem(change);
                assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'question');
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

    // ============================================
    // GitCommitItem Tests
    // ============================================
    suite('GitCommitItem', () => {
        const createMockCommit = (
            subject: string = 'Fix bug in parser',
            refs: string[] = []
        ): GitCommit => ({
            hash: 'abc123def456789012345678901234567890abcd',
            shortHash: 'abc123d',
            subject,
            authorName: 'John Doe',
            authorEmail: 'john@example.com',
            date: '2024-01-15T10:30:00Z',
            relativeDate: '2 hours ago',
            parentHashes: 'parent123',
            refs,
            repositoryRoot: '/repo',
            repositoryName: 'repo'
        });

        suite('Basic Properties', () => {
            test('should set label with short hash and subject', () => {
                const commit = createMockCommit('Fix bug');
                const item = new GitCommitItem(commit);
                assert.ok((item.label as string).includes('abc123d'));
                assert.ok((item.label as string).includes('Fix bug'));
            });

            test('should truncate long subjects', () => {
                const longSubject = 'This is a very long commit message that should be truncated for display';
                const commit = createMockCommit(longSubject);
                const item = new GitCommitItem(commit);
                const label = item.label as string;
                assert.ok(label.length < longSubject.length + 10); // +10 for hash
                assert.ok(label.includes('...'));
            });

            test('should set contextValue to gitCommit', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                assert.strictEqual(item.contextValue, 'gitCommit');
            });

            test('should not be collapsible', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
            });

            test('should have git-commit icon', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                assert.ok(item.iconPath instanceof vscode.ThemeIcon);
                assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'git-commit');
            });

            test('should store the commit object', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                assert.strictEqual(item.commit, commit);
            });

            test('should set command to view commit', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                assert.strictEqual(item.command?.command, 'git.viewCommit');
                assert.deepStrictEqual(item.command?.arguments, [commit.hash]);
            });
        });

        suite('Description Format', () => {
            test('should include author name', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                assert.ok(item.description?.toString().includes('John Doe'));
            });

            test('should include relative date', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                assert.ok(item.description?.toString().includes('2 hours ago'));
            });

            test('should include refs when present', () => {
                const commit = createMockCommit('Fix bug', ['main', 'origin/main']);
                const item = new GitCommitItem(commit);
                assert.ok(item.description?.toString().includes('main'));
            });

            test('should not include refs when empty', () => {
                const commit = createMockCommit('Fix bug', []);
                const item = new GitCommitItem(commit);
                assert.ok(!item.description?.toString().includes('('));
            });

            test('should filter out HEAD refs', () => {
                const commit = createMockCommit('Fix bug', ['HEAD -> main', 'main']);
                const item = new GitCommitItem(commit);
                const desc = item.description?.toString() || '';
                assert.ok(!desc.includes('HEAD'));
            });
        });

        suite('Tooltip', () => {
            test('should create markdown tooltip', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                assert.ok(item.tooltip instanceof vscode.MarkdownString);
            });

            test('should include full hash in tooltip', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes(commit.hash));
            });

            test('should include full subject in tooltip', () => {
                const longSubject = 'This is a very long commit message that should be truncated for display';
                const commit = createMockCommit(longSubject);
                const item = new GitCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes(longSubject));
            });

            test('should include author email in tooltip', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('john@example.com'));
            });

            test('should indicate merge commit in tooltip', () => {
                const commit = createMockCommit();
                commit.parentHashes = 'parent1 parent2';
                const item = new GitCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('Merge commit'));
            });

            test('should include refs in tooltip', () => {
                const commit = createMockCommit('Fix', ['main', 'develop']);
                const item = new GitCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('main'));
                assert.ok(tooltip.value.includes('develop'));
            });

            test('should include repository name in tooltip', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('repo'));
            });
        });
    });

    // ============================================
    // LoadMoreItem Tests
    // ============================================
    suite('LoadMoreItem', () => {
        test('should have default label', () => {
            const item = new LoadMoreItem();
            assert.strictEqual(item.label, 'Load More Commits...');
        });

        test('should set contextValue to gitLoadMore', () => {
            const item = new LoadMoreItem();
            assert.strictEqual(item.contextValue, 'gitLoadMore');
        });

        test('should use default load count of 20', () => {
            const item = new LoadMoreItem();
            assert.strictEqual(item.loadCount, 20);
        });

        test('should accept custom load count', () => {
            const item = new LoadMoreItem(50);
            assert.strictEqual(item.loadCount, 50);
        });

        test('should show load count in description', () => {
            const item = new LoadMoreItem(30);
            assert.ok(item.description?.toString().includes('30'));
        });

        test('should not be collapsible', () => {
            const item = new LoadMoreItem();
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
        });

        test('should have ellipsis icon', () => {
            const item = new LoadMoreItem();
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'ellipsis');
        });

        test('should have command to load more commits', () => {
            const item = new LoadMoreItem(25);
            assert.strictEqual(item.command?.command, 'gitView.loadMoreCommits');
            assert.deepStrictEqual(item.command?.arguments, [25]);
        });

        test('should have tooltip', () => {
            const item = new LoadMoreItem(20);
            assert.ok(item.tooltip?.toString().includes('20'));
        });
    });

    // ============================================
    // Change Sorting Logic Tests
    // ============================================
    suite('Change Sorting Logic', () => {
        const stagePriority = { staged: 0, unstaged: 1, untracked: 2 };

        const sortChanges = (changes: GitChange[]): GitChange[] => {
            return [...changes].sort((a, b) => {
                const stageDiff = stagePriority[a.stage] - stagePriority[b.stage];
                if (stageDiff !== 0) return stageDiff;
                return a.path.localeCompare(b.path);
            });
        };

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

            const sorted = sortChanges([unstaged, staged]);
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

            const sorted = sortChanges([untracked, unstaged]);
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

            const sorted = sortChanges([fileB, fileA]);
            assert.strictEqual(sorted[0].path, '/repo/a.ts');
            assert.strictEqual(sorted[1].path, '/repo/b.ts');
        });

        test('should handle all three stages correctly', () => {
            const staged: GitChange = {
                path: '/repo/c.ts',
                status: 'modified',
                stage: 'staged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/c.ts')
            };
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

            const sorted = sortChanges([untracked, unstaged, staged]);
            assert.strictEqual(sorted[0].stage, 'staged');
            assert.strictEqual(sorted[1].stage, 'unstaged');
            assert.strictEqual(sorted[2].stage, 'untracked');
        });
    });

    // ============================================
    // Tree Structure Tests
    // ============================================
    suite('Tree Structure', () => {
        test('SectionHeaderItem should be instance of TreeItem', () => {
            const header = new SectionHeaderItem('changes', 5, false);
            assert.ok(header instanceof vscode.TreeItem);
        });

        test('GitChangeItem should be instance of TreeItem', () => {
            const change: GitChange = {
                path: '/repo/file.ts',
                status: 'modified',
                stage: 'staged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/file.ts')
            };
            const item = new GitChangeItem(change);
            assert.ok(item instanceof vscode.TreeItem);
        });

        test('GitCommitItem should be instance of TreeItem', () => {
            const commit: GitCommit = {
                hash: 'abc123',
                shortHash: 'abc',
                subject: 'Fix',
                authorName: 'John',
                authorEmail: 'john@test.com',
                date: '2024-01-15T10:30:00Z',
                relativeDate: '2h ago',
                parentHashes: '',
                refs: [],
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };
            const item = new GitCommitItem(commit);
            assert.ok(item instanceof vscode.TreeItem);
        });

        test('LoadMoreItem should be instance of TreeItem', () => {
            const item = new LoadMoreItem();
            assert.ok(item instanceof vscode.TreeItem);
        });
    });

    // ============================================
    // Service Integration Tests
    // ============================================
    suite('Service Integration', () => {
        test('GitService should be importable', async () => {
            const { GitService } = await import('../../shortcuts/git/git-service');
            assert.ok(GitService, 'GitService should be defined');
        });

        test('GitLogService should be importable', async () => {
            const { GitLogService } = await import('../../shortcuts/git/git-log-service');
            assert.ok(GitLogService, 'GitLogService should be defined');
        });

        test('GitTreeDataProvider should be importable', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
            assert.ok(GitTreeDataProvider, 'GitTreeDataProvider should be defined');
        });

        test('GitTreeDataProvider should implement TreeDataProvider interface', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
            const provider = new GitTreeDataProvider();

            // Check required methods exist
            assert.ok(typeof provider.getTreeItem === 'function');
            assert.ok(typeof provider.getChildren === 'function');
            assert.ok(typeof provider.refresh === 'function');
            assert.ok(provider.onDidChangeTreeData);

            // Cleanup
            provider.dispose();
        });

        test('GitTreeDataProvider should return empty array when not initialized', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
            const provider = new GitTreeDataProvider();

            const children = await provider.getChildren();
            assert.deepStrictEqual(children, []);

            provider.dispose();
        });

        test('GitTreeDataProvider should return zero counts when not initialized', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
            const provider = new GitTreeDataProvider();

            const counts = provider.getChangeCounts();
            assert.strictEqual(counts.staged, 0);
            assert.strictEqual(counts.unstaged, 0);
            assert.strictEqual(counts.untracked, 0);
            assert.strictEqual(counts.total, 0);

            provider.dispose();
        });

        test('GitTreeDataProvider should have loadMoreCommits method', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
            const provider = new GitTreeDataProvider();

            assert.ok(typeof provider.loadMoreCommits === 'function');

            provider.dispose();
        });

        test('GitTreeDataProvider should have getViewCounts method', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
            const provider = new GitTreeDataProvider();

            const counts = provider.getViewCounts();
            assert.ok('changes' in counts);
            assert.ok('commitCount' in counts);
            assert.ok('hasMoreCommits' in counts);

            provider.dispose();
        });

        test('GitTreeDataProvider should have copyCommitHash method', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
            const provider = new GitTreeDataProvider();

            assert.ok(typeof provider.copyCommitHash === 'function');

            provider.dispose();
        });
    });

    // ============================================
    // Status to Icon Mapping Tests
    // ============================================
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

    // ============================================
    // Edge Cases
    // ============================================
    suite('Edge Cases', () => {
        test('should handle empty refs array in commit', () => {
            const commit: GitCommit = {
                hash: 'abc123',
                shortHash: 'abc',
                subject: 'Fix',
                authorName: 'John',
                authorEmail: 'john@test.com',
                date: '2024-01-15T10:30:00Z',
                relativeDate: '2h ago',
                parentHashes: '',
                refs: [],
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };
            const item = new GitCommitItem(commit);
            assert.ok(item.description !== undefined);
        });

        test('should handle commit with no parent (initial commit)', () => {
            const commit: GitCommit = {
                hash: 'abc123',
                shortHash: 'abc',
                subject: 'Initial commit',
                authorName: 'John',
                authorEmail: 'john@test.com',
                date: '2024-01-15T10:30:00Z',
                relativeDate: '2h ago',
                parentHashes: '',
                refs: [],
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };
            const item = new GitCommitItem(commit);
            const tooltip = item.tooltip as vscode.MarkdownString;
            assert.ok(!tooltip.value.includes('Merge commit'));
        });

        test('should handle change with original path (rename)', () => {
            const change: GitChange = {
                path: '/repo/new-name.ts',
                originalPath: '/repo/old-name.ts',
                status: 'renamed',
                stage: 'staged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/new-name.ts')
            };
            const item = new GitChangeItem(change);
            const tooltip = item.tooltip as vscode.MarkdownString;
            assert.ok(tooltip.value.includes('old-name.ts'));
        });

        test('should handle section header with singular count', () => {
            const header = new SectionHeaderItem('changes', 1, false);
            assert.ok(header.tooltip?.toString().includes('1'));
            assert.ok(header.tooltip?.toString().includes('change'));
            assert.ok(!header.tooltip?.toString().includes('changes'));
        });

        test('should handle LoadMoreItem with 0 count', () => {
            const item = new LoadMoreItem(0);
            assert.strictEqual(item.loadCount, 0);
        });
    });

    // ============================================
    // Index Exports Tests
    // ============================================
    suite('Index Exports', () => {
        test('should export all types', async () => {
            const exports = await import('../../shortcuts/git');
            
            // Types are checked at compile time, but we can verify the module loads
            assert.ok(exports);
        });

        test('should export GitService', async () => {
            const { GitService } = await import('../../shortcuts/git');
            assert.ok(GitService);
        });

        test('should export GitLogService', async () => {
            const { GitLogService } = await import('../../shortcuts/git');
            assert.ok(GitLogService);
        });

        test('should export GitChangeItem', async () => {
            const { GitChangeItem } = await import('../../shortcuts/git');
            assert.ok(GitChangeItem);
        });

        test('should export GitCommitItem', async () => {
            const { GitCommitItem } = await import('../../shortcuts/git');
            assert.ok(GitCommitItem);
        });

        test('should export SectionHeaderItem', async () => {
            const { SectionHeaderItem } = await import('../../shortcuts/git');
            assert.ok(SectionHeaderItem);
        });

        test('should export LoadMoreItem', async () => {
            const { LoadMoreItem } = await import('../../shortcuts/git');
            assert.ok(LoadMoreItem);
        });

        test('should export GitTreeDataProvider', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            assert.ok(GitTreeDataProvider);
        });
    });
});

