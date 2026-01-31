/**
 * Tests for unified Git view functionality
 * Covers: Changes, Commits, Section Headers, Pagination, Tree Structure
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { GitChangeItem } from '../../shortcuts/git/git-change-item';
import { GitCommitFileItem } from '../../shortcuts/git/git-commit-file-item';
import { GitCommitItem } from '../../shortcuts/git/git-commit-item';
import { LoadMoreItem } from '../../shortcuts/git/load-more-item';
import { SectionHeaderItem } from '../../shortcuts/git/section-header-item';
import { StageSectionItem } from '../../shortcuts/git/stage-section-item';
import {
    CommitLoadOptions,
    CommitLoadResult,
    GitChange,
    GitChangeCounts,
    GitChangeStage,
    GitChangeStatus,
    GitCommit,
    GitCommitFile,
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
            const sections: GitSectionType[] = ['changes', 'commits', 'comments'];
            assert.strictEqual(sections.length, 3);
        });

        test('should have correct GitViewCounts structure', () => {
            const counts: GitViewCounts = {
                changes: { staged: 1, unstaged: 2, untracked: 0, total: 3 },
                commitCount: 20,
                hasMoreCommits: true,
                comments: { open: 2, resolved: 1, total: 3 }
            };
            assert.strictEqual(counts.changes.total, 3);
            assert.strictEqual(counts.commitCount, 20);
            assert.strictEqual(counts.hasMoreCommits, true);
            assert.strictEqual(counts.comments.total, 3);
        });

        test('should have correct GitCommitFile structure', () => {
            const file: GitCommitFile = {
                path: 'src/file.ts',
                status: 'modified',
                commitHash: 'abc123def456789',
                parentHash: 'parent123456789',
                repositoryRoot: '/repo'
            };
            assert.strictEqual(file.path, 'src/file.ts');
            assert.strictEqual(file.status, 'modified');
            assert.strictEqual(file.commitHash, 'abc123def456789');
            assert.strictEqual(file.parentHash, 'parent123456789');
        });

        test('should have correct GitCommitFile structure with originalPath', () => {
            const file: GitCommitFile = {
                path: 'src/new-name.ts',
                originalPath: 'src/old-name.ts',
                status: 'renamed',
                commitHash: 'abc123def456789',
                parentHash: 'parent123456789',
                repositoryRoot: '/repo'
            };
            assert.strictEqual(file.originalPath, 'src/old-name.ts');
            assert.strictEqual(file.status, 'renamed');
        });

        test('should have correct GitCommitFile structure for added file', () => {
            const file: GitCommitFile = {
                path: 'src/new-feature.ts',
                status: 'added',
                commitHash: 'abc123def456789',
                parentHash: 'parent123456789',
                repositoryRoot: '/repo'
            };
            assert.strictEqual(file.status, 'added');
            assert.strictEqual(file.originalPath, undefined);
        });

        test('should have correct GitCommitFile structure for deleted file', () => {
            const file: GitCommitFile = {
                path: 'src/removed-file.ts',
                status: 'deleted',
                commitHash: 'abc123def456789',
                parentHash: 'parent123456789',
                repositoryRoot: '/repo'
            };
            assert.strictEqual(file.status, 'deleted');
            assert.strictEqual(file.originalPath, undefined);
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
        // Platform-aware paths for cross-platform tests
        const isWindows = process.platform === 'win32';
        const repoRoot = isWindows ? 'C:\\repo' : '/repo';
        const defaultFilePath = isWindows ? 'C:\\repo\\src\\file.ts' : '/repo/src/file.ts';

        const createMockChange = (
            status: GitChangeStatus,
            stage: GitChangeStage,
            filePath: string = defaultFilePath
        ): GitChange => ({
            path: filePath,
            status,
            stage,
            repositoryRoot: repoRoot,
            repositoryName: 'repo',
            uri: vscode.Uri.file(filePath)
        });

        suite('Basic Properties', () => {
            test('should set label to filename', () => {
                const componentPath = isWindows ? 'C:\\repo\\src\\component.tsx' : '/repo/src/component.tsx';
                const change = createMockChange('modified', 'unstaged', componentPath);
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

            test('should set command to open diff review', () => {
                const change = createMockChange('modified', 'unstaged');
                const item = new GitChangeItem(change);
                assert.strictEqual(item.command?.command, 'gitDiffComments.openWithReview');
                assert.strictEqual(item.command?.title, 'Open Diff Review');
            });

            test('should set resourceUri', () => {
                const testPath = isWindows ? 'C:\\repo\\test.js' : '/repo/test.js';
                const change = createMockChange('modified', 'unstaged', testPath);
                const item = new GitChangeItem(change);
                // On Windows, vscode.Uri.file() normalizes drive letter to lowercase
                if (isWindows) {
                    assert.strictEqual(item.resourceUri?.fsPath.toLowerCase(), testPath.toLowerCase());
                } else {
                    assert.strictEqual(item.resourceUri?.fsPath, testPath);
                }
            });

            test('should store the change object', () => {
                const change = createMockChange('modified', 'staged');
                const item = new GitChangeItem(change);
                assert.strictEqual(item.change, change);
            });
        });

        suite('Description Format', () => {
            test('should show status code M for modified staged changes', () => {
                const change = createMockChange('modified', 'staged', '/repo/file.ts');
                const item = new GitChangeItem(change);
                assert.ok(item.description?.toString().includes('M'));
            });

            test('should show status code M for modified unstaged changes', () => {
                const change = createMockChange('modified', 'unstaged', '/repo/file.ts');
                const item = new GitChangeItem(change);
                assert.ok(item.description?.toString().includes('M'));
            });

            test('should show status code U for untracked files', () => {
                const change = createMockChange('untracked', 'untracked', '/repo/file.ts');
                const item = new GitChangeItem(change);
                assert.ok(item.description?.toString().includes('U'));
            });

            test('should include relative path for nested files', () => {
                const change = createMockChange('modified', 'unstaged', '/repo/src/components/Button.tsx');
                const item = new GitChangeItem(change);
                assert.ok(item.description?.toString().includes('src/components') ||
                    item.description?.toString().includes('src\\components'));
            });
        });

        suite('Resource URI for File Icons', () => {
            // GitChangeItem now uses resourceUri for file icons from icon theme
            // instead of setting iconPath directly. These tests verify resourceUri is set.
            test('staged modified should have resourceUri', () => {
                const change = createMockChange('modified', 'staged');
                const item = new GitChangeItem(change);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });

            test('staged added should have resourceUri', () => {
                const change = createMockChange('added', 'staged');
                const item = new GitChangeItem(change);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });

            test('staged deleted should have resourceUri', () => {
                const change = createMockChange('deleted', 'staged');
                const item = new GitChangeItem(change);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });

            test('unstaged modified should have resourceUri', () => {
                const change = createMockChange('modified', 'unstaged');
                const item = new GitChangeItem(change);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });

            test('unstaged deleted should have resourceUri', () => {
                const change = createMockChange('deleted', 'unstaged');
                const item = new GitChangeItem(change);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });

            test('untracked should have resourceUri', () => {
                const change = createMockChange('untracked', 'untracked');
                const item = new GitChangeItem(change);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });

            test('conflict should have resourceUri', () => {
                const change = createMockChange('conflict', 'unstaged');
                const item = new GitChangeItem(change);
                assert.ok(item.resourceUri instanceof vscode.Uri);
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
            refs: string[] = [],
            isAheadOfRemote: boolean = false
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
            repositoryName: 'repo',
            isAheadOfRemote
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

            test('should be expandable (collapsed by default)', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
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

            test('should not have command (clicking expands/collapses)', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                assert.strictEqual(item.command, undefined);
            });
        });

        suite('Ahead of Remote Indicator', () => {
            test('should use green icon for unpushed commits', () => {
                const commit = createMockCommit('Unpushed commit', [], true);
                const item = new GitCommitItem(commit);
                const icon = item.iconPath as vscode.ThemeIcon;
                assert.strictEqual(icon.id, 'git-commit');
                assert.ok(icon.color, 'Icon should have a color');
            });

            test('should use default icon for pushed commits', () => {
                const commit = createMockCommit('Pushed commit', [], false);
                const item = new GitCommitItem(commit);
                const icon = item.iconPath as vscode.ThemeIcon;
                assert.strictEqual(icon.id, 'git-commit');
                // Default icon has no color
                assert.strictEqual(icon.color, undefined);
            });

            test('should indicate unpushed status in tooltip', () => {
                const commit = createMockCommit('Unpushed', [], true);
                const item = new GitCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('Unpushed'));
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

            test('should not include repository name in tooltip', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                // Repository name should not be in the tooltip anymore
                assert.ok(!tooltip.value.includes('Repository:'));
            });

            test('should include instruction to expand in tooltip', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('expand'));
            });

            test('should have isTrusted enabled for command links', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.strictEqual(tooltip.isTrusted, true);
            });

            test('should include copy links in tooltip', () => {
                const commit = createMockCommit();
                const item = new GitCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                // Should have copy command links
                assert.ok(tooltip.value.includes('command:gitView.copyCommitHash'));
                assert.ok(tooltip.value.includes('command:gitView.copyToClipboard'));
            });
        });
    });

    // ============================================
    // GitCommitFileItem Tests
    // ============================================
    suite('GitCommitFileItem', () => {
        const createMockCommitFile = (
            status: GitChangeStatus = 'modified',
            filePath: string = 'src/file.ts',
            originalPath?: string
        ): GitCommitFile => ({
            path: filePath,
            originalPath,
            status,
            commitHash: 'abc123def456789012345678901234567890abcd',
            parentHash: 'parent123456789012345678901234567890abcd',
            repositoryRoot: '/repo'
        });

        suite('Basic Properties', () => {
            test('should set label to filename', () => {
                const file = createMockCommitFile('modified', 'src/components/Button.tsx');
                const item = new GitCommitFileItem(file);
                assert.strictEqual(item.label, 'Button.tsx');
            });

            test('should set contextValue to gitCommitFile for non-markdown files', () => {
                const file = createMockCommitFile('modified', 'src/file.ts');
                const item = new GitCommitFileItem(file);
                assert.strictEqual(item.contextValue, 'gitCommitFile');
            });

            test('should set contextValue to gitCommitFile_md for markdown files', () => {
                const file = createMockCommitFile('modified', 'docs/README.md');
                const item = new GitCommitFileItem(file);
                assert.strictEqual(item.contextValue, 'gitCommitFile_md');
            });

            test('should handle case-insensitive .MD extension', () => {
                const file = createMockCommitFile('modified', 'docs/NOTES.MD');
                const item = new GitCommitFileItem(file);
                // Extension comparison is case-insensitive, .MD should also match
                assert.strictEqual(item.contextValue, 'gitCommitFile_md');
            });

            test('should not be collapsible', () => {
                const file = createMockCommitFile();
                const item = new GitCommitFileItem(file);
                assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
            });

            test('should set command to open diff', () => {
                const file = createMockCommitFile();
                const item = new GitCommitFileItem(file);
                assert.strictEqual(item.command?.command, 'gitView.openCommitFileDiff');
                assert.strictEqual(item.command?.title, 'Open Diff');
                assert.deepStrictEqual(item.command?.arguments, [file]);
            });

            test('should store the file object', () => {
                const file = createMockCommitFile();
                const item = new GitCommitFileItem(file);
                assert.strictEqual(item.file, file);
            });
        });

        suite('Description Format', () => {
            test('should show status indicator M for modified', () => {
                const file = createMockCommitFile('modified', 'file.ts');
                const item = new GitCommitFileItem(file);
                assert.ok(item.description?.toString().includes('M'));
            });

            test('should show status indicator A for added', () => {
                const file = createMockCommitFile('added', 'file.ts');
                const item = new GitCommitFileItem(file);
                assert.ok(item.description?.toString().includes('A'));
            });

            test('should show status indicator D for deleted', () => {
                const file = createMockCommitFile('deleted', 'file.ts');
                const item = new GitCommitFileItem(file);
                assert.ok(item.description?.toString().includes('D'));
            });

            test('should show status indicator R for renamed', () => {
                const file = createMockCommitFile('renamed', 'new-file.ts', 'old-file.ts');
                const item = new GitCommitFileItem(file);
                assert.ok(item.description?.toString().includes('R'));
            });

            test('should include directory path for nested files', () => {
                const file = createMockCommitFile('modified', 'src/components/Button.tsx');
                const item = new GitCommitFileItem(file);
                assert.ok(item.description?.toString().includes('src/components') ||
                    item.description?.toString().includes('src\\components'));
            });

            test('should show original filename for renames', () => {
                const file = createMockCommitFile('renamed', 'new-name.ts', 'old-name.ts');
                const item = new GitCommitFileItem(file);
                assert.ok(item.description?.toString().includes('old-name.ts'));
            });

            test('should not show directory for root level files', () => {
                const file = createMockCommitFile('modified', 'file.ts');
                const item = new GitCommitFileItem(file);
                // Should just have status, no bullet point for directory
                const desc = item.description?.toString() || '';
                assert.ok(!desc.includes('\u2022') || desc.indexOf('\u2022') > desc.indexOf('M'));
            });
        });

        suite('Resource URI for File Icons', () => {
            // GitCommitFileItem now uses resourceUri for file icons from icon theme
            // instead of setting iconPath directly. These tests verify resourceUri is set.
            test('modified should have resourceUri', () => {
                const file = createMockCommitFile('modified');
                const item = new GitCommitFileItem(file);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });

            test('added should have resourceUri', () => {
                const file = createMockCommitFile('added');
                const item = new GitCommitFileItem(file);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });

            test('deleted should have resourceUri', () => {
                const file = createMockCommitFile('deleted');
                const item = new GitCommitFileItem(file);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });

            test('renamed should have resourceUri', () => {
                const file = createMockCommitFile('renamed', 'new.ts', 'old.ts');
                const item = new GitCommitFileItem(file);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });

            test('copied should have resourceUri', () => {
                const file = createMockCommitFile('copied');
                const item = new GitCommitFileItem(file);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });

            test('conflict should have resourceUri', () => {
                const file = createMockCommitFile('conflict');
                const item = new GitCommitFileItem(file);
                assert.ok(item.resourceUri instanceof vscode.Uri);
            });
        });

        suite('Tooltip', () => {
            test('should create markdown tooltip', () => {
                const file = createMockCommitFile();
                const item = new GitCommitFileItem(file);
                assert.ok(item.tooltip instanceof vscode.MarkdownString);
            });

            test('should include file name in tooltip', () => {
                const file = createMockCommitFile('modified', 'src/file.ts');
                const item = new GitCommitFileItem(file);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('file.ts'));
            });

            test('should include status in tooltip', () => {
                const file = createMockCommitFile('modified');
                const item = new GitCommitFileItem(file);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('modified'));
            });

            test('should include path in tooltip', () => {
                const file = createMockCommitFile('modified', 'src/components/Button.tsx');
                const item = new GitCommitFileItem(file);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('src/components/Button.tsx'));
            });

            test('should include original path for renames', () => {
                const file = createMockCommitFile('renamed', 'new-name.ts', 'old-name.ts');
                const item = new GitCommitFileItem(file);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('old-name.ts'));
            });

            test('should include short commit hash in tooltip', () => {
                const file = createMockCommitFile();
                const item = new GitCommitFileItem(file);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('abc123d'));
            });
        });

        suite('All Statuses Have ResourceUri', () => {
            // GitCommitFileItem now uses resourceUri for file icons from icon theme
            const allStatuses: GitChangeStatus[] = [
                'modified', 'added', 'deleted', 'renamed',
                'copied', 'untracked', 'ignored', 'conflict'
            ];

            for (const status of allStatuses) {
                test(`should have resourceUri for ${status} status`, () => {
                    const file = createMockCommitFile(status, 'file.ts', status === 'renamed' ? 'old.ts' : undefined);
                    const item = new GitCommitFileItem(file);
                    assert.ok(item.resourceUri instanceof vscode.Uri);
                });
            }
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

        test('GitCommitFileItem should be instance of TreeItem', () => {
            const file: GitCommitFile = {
                path: 'src/file.ts',
                status: 'modified',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };
            const item = new GitCommitFileItem(file);
            assert.ok(item instanceof vscode.TreeItem);
        });

        test('GitCommitItem should be expandable to show files', () => {
            const commit: GitCommit = {
                hash: 'abc123',
                shortHash: 'abc',
                subject: 'Fix',
                authorName: 'John',
                authorEmail: 'john@test.com',
                date: '2024-01-15T10:30:00Z',
                relativeDate: '2h ago',
                parentHashes: 'parent123',
                refs: [],
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };
            const item = new GitCommitItem(commit);
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
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

        test('GitLogService should have getCommitFiles method', async () => {
            const { GitLogService } = await import('../../shortcuts/git/git-log-service');
            const service = new GitLogService();

            assert.ok(typeof service.getCommitFiles === 'function');

            service.dispose();
        });
    });

    // ============================================
    // Resource URI Tests (for file icons from icon theme)
    // ============================================
    suite('Resource URI for Icons', () => {
        const allStatuses: GitChangeStatus[] = [
            'modified', 'added', 'deleted', 'renamed',
            'copied', 'untracked', 'ignored', 'conflict'
        ];

        for (const status of allStatuses) {
            test(`should have resourceUri for ${status} status (staged)`, () => {
                const change: GitChange = {
                    path: '/repo/file.ts',
                    status,
                    stage: 'staged',
                    repositoryRoot: '/repo',
                    repositoryName: 'repo',
                    uri: vscode.Uri.file('/repo/file.ts')
                };
                const item = new GitChangeItem(change);
                // GitChangeItem uses resourceUri for file icons from icon theme
                // instead of setting iconPath directly
                assert.ok(item.resourceUri instanceof vscode.Uri);
                // Check that the path ends with the expected filename (platform-independent)
                assert.ok(item.resourceUri?.fsPath.endsWith('file.ts'));
            });

            test(`should have resourceUri for ${status} status (unstaged)`, () => {
                const change: GitChange = {
                    path: '/repo/file.ts',
                    status,
                    stage: 'unstaged',
                    repositoryRoot: '/repo',
                    repositoryName: 'repo',
                    uri: vscode.Uri.file('/repo/file.ts')
                };
                const item = new GitChangeItem(change);
                // GitChangeItem uses resourceUri for file icons from icon theme
                // instead of setting iconPath directly
                assert.ok(item.resourceUri instanceof vscode.Uri);
                // Check that the path ends with the expected filename (platform-independent)
                assert.ok(item.resourceUri?.fsPath.endsWith('file.ts'));
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

        test('should handle commit file with deep nested path', () => {
            const file: GitCommitFile = {
                path: 'src/components/ui/buttons/PrimaryButton.tsx',
                status: 'modified',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.label, 'PrimaryButton.tsx');
            assert.ok(item.description?.toString().includes('src/components/ui/buttons') ||
                item.description?.toString().includes('src\\components\\ui\\buttons'));
        });

        test('should handle commit file with copy status', () => {
            const file: GitCommitFile = {
                path: 'new-file.ts',
                originalPath: 'original-file.ts',
                status: 'copied',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };
            const item = new GitCommitFileItem(file);
            // GitCommitFileItem uses resourceUri for file icons from icon theme
            assert.ok(item.resourceUri instanceof vscode.Uri);
            // Description should include the status short code 'C' for copied
            assert.ok(item.description?.toString().includes('C'));
        });

        test('should handle commit file at root level', () => {
            const file: GitCommitFile = {
                path: 'README.md',
                status: 'modified',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.label, 'README.md');
        });

        test('should handle newly added file (status: added)', () => {
            const file: GitCommitFile = {
                path: 'src/new-feature.ts',
                status: 'added',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.label, 'new-feature.ts');
            // GitCommitFileItem uses resourceUri for file icons from icon theme
            assert.ok(item.resourceUri instanceof vscode.Uri);
            assert.ok(item.description?.toString().includes('A'));
        });

        test('should handle deleted file (status: deleted)', () => {
            const file: GitCommitFile = {
                path: 'src/removed-file.ts',
                status: 'deleted',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.label, 'removed-file.ts');
            // GitCommitFileItem uses resourceUri for file icons from icon theme
            assert.ok(item.resourceUri instanceof vscode.Uri);
            assert.ok(item.description?.toString().includes('D'));
        });

        test('should pass file object to command for added files', () => {
            const file: GitCommitFile = {
                path: 'src/new-file.ts',
                status: 'added',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.command?.command, 'gitView.openCommitFileDiff');
            assert.deepStrictEqual(item.command?.arguments, [file]);
            // Verify the file object contains the status for proper handling
            assert.strictEqual((item.command?.arguments?.[0] as GitCommitFile).status, 'added');
        });

        test('should pass file object to command for deleted files', () => {
            const file: GitCommitFile = {
                path: 'src/deleted-file.ts',
                status: 'deleted',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };
            const item = new GitCommitFileItem(file);
            assert.strictEqual(item.command?.command, 'gitView.openCommitFileDiff');
            assert.deepStrictEqual(item.command?.arguments, [file]);
            // Verify the file object contains the status for proper handling
            assert.strictEqual((item.command?.arguments?.[0] as GitCommitFile).status, 'deleted');
        });

        test('should include status in tooltip for added files', () => {
            const file: GitCommitFile = {
                path: 'src/new-file.ts',
                status: 'added',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };
            const item = new GitCommitFileItem(file);
            const tooltip = item.tooltip as vscode.MarkdownString;
            assert.ok(tooltip.value.includes('added'));
        });

        test('should include status in tooltip for deleted files', () => {
            const file: GitCommitFile = {
                path: 'src/deleted-file.ts',
                status: 'deleted',
                commitHash: 'abc123',
                parentHash: 'parent123',
                repositoryRoot: '/repo'
            };
            const item = new GitCommitFileItem(file);
            const tooltip = item.tooltip as vscode.MarkdownString;
            assert.ok(tooltip.value.includes('deleted'));
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

        test('should export GitCommitFileItem', async () => {
            const { GitCommitFileItem } = await import('../../shortcuts/git');
            assert.ok(GitCommitFileItem);
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

    // ============================================
    // Markdown Review Command Tests
    // ============================================
    suite('Markdown Review Command', () => {

        test('should detect markdown files by extension', () => {
            const mdFile = '/path/to/file.md';
            const txtFile = '/path/to/file.txt';
            const noExt = '/path/to/file';

            assert.strictEqual(mdFile.endsWith('.md'), true);
            assert.strictEqual(txtFile.endsWith('.md'), false);
            assert.strictEqual(noExt.endsWith('.md'), false);
        });

        test('should handle uppercase MD extension', () => {
            const upperMd = '/path/to/file.MD';
            const mixedMd = '/path/to/file.Md';

            // Case-insensitive check
            assert.strictEqual(upperMd.toLowerCase().endsWith('.md'), true);
            assert.strictEqual(mixedMd.toLowerCase().endsWith('.md'), true);
        });

        test('should handle markdown files in nested paths', () => {
            const nestedMd = '/project/docs/guides/README.md';
            assert.strictEqual(nestedMd.endsWith('.md'), true);
        });

        test('should handle markdown files with spaces in path', () => {
            const spacedPath = '/my project/my docs/readme.md';
            assert.strictEqual(spacedPath.endsWith('.md'), true);
        });

        test('should handle markdown files with special characters in name', () => {
            const specialChars = '/docs/file-name_v2.0.md';
            assert.strictEqual(specialChars.endsWith('.md'), true);
        });

        test('GitChangeItem should have resourceUri for markdown detection', () => {
            const isWin = process.platform === 'win32';
            const mdPath = isWin ? 'C:\\repo\\docs\\README.md' : '/repo/docs/README.md';
            const repoRootPath = isWin ? 'C:\\repo' : '/repo';

            const change: GitChange = {
                path: mdPath,
                status: 'modified',
                stage: 'unstaged',
                repositoryRoot: repoRootPath,
                repositoryName: 'repo',
                uri: vscode.Uri.file(mdPath)
            };

            const item = new GitChangeItem(change);
            assert.ok(item.resourceUri);
            // On Windows, vscode.Uri.file() normalizes drive letter to lowercase
            if (isWin) {
                assert.strictEqual(item.resourceUri?.fsPath.toLowerCase(), mdPath.toLowerCase());
            } else {
                assert.strictEqual(item.resourceUri?.fsPath, mdPath);
            }
            assert.strictEqual(item.resourceUri?.fsPath.endsWith('.md'), true);
        });

        test('GitChangeItem contextValue should match menu condition', () => {
            const stagedChange: GitChange = {
                path: '/repo/file.ts',
                status: 'modified',
                stage: 'staged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/file.ts')
            };

            const unstagedChange: GitChange = {
                path: '/repo/file.ts',
                status: 'modified',
                stage: 'unstaged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/file.ts')
            };

            const stagedItem = new GitChangeItem(stagedChange);
            const unstagedItem = new GitChangeItem(unstagedChange);

            // Context values should match the pattern /^gitChange_/
            assert.ok(stagedItem.contextValue?.startsWith('gitChange_'));
            assert.ok(unstagedItem.contextValue?.startsWith('gitChange_'));
            assert.strictEqual(stagedItem.contextValue, 'gitChange_staged');
            assert.strictEqual(unstagedItem.contextValue, 'gitChange_unstaged');
        });

        test('GitChangeItem contextValue should have _md suffix for markdown files', () => {
            const stagedMdChange: GitChange = {
                path: '/repo/file.md',
                status: 'modified',
                stage: 'staged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/file.md')
            };

            const unstagedMdChange: GitChange = {
                path: '/repo/file.md',
                status: 'modified',
                stage: 'unstaged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/file.md')
            };

            const stagedMdItem = new GitChangeItem(stagedMdChange);
            const unstagedMdItem = new GitChangeItem(unstagedMdChange);

            // Context values should have _md suffix for markdown files
            assert.strictEqual(stagedMdItem.contextValue, 'gitChange_staged_md');
            assert.strictEqual(unstagedMdItem.contextValue, 'gitChange_unstaged_md');
        });

        test('should extract file path from GitChangeItem change property', () => {
            const change: GitChange = {
                path: '/repo/docs/guide.md',
                status: 'added',
                stage: 'staged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/docs/guide.md')
            };

            const item = new GitChangeItem(change);

            // The command extracts path from item.change.path
            const filePath = item.change?.path;
            assert.strictEqual(filePath, '/repo/docs/guide.md');
            assert.strictEqual(filePath?.endsWith('.md'), true);
        });

        test('should handle non-markdown files gracefully', () => {
            const change: GitChange = {
                path: '/repo/src/main.ts',
                status: 'modified',
                stage: 'unstaged',
                repositoryRoot: '/repo',
                repositoryName: 'repo',
                uri: vscode.Uri.file('/repo/src/main.ts')
            };

            const item = new GitChangeItem(change);
            const filePath = item.change?.path;

            // Should not be a markdown file
            assert.strictEqual(filePath?.endsWith('.md'), false);
        });
    });

    // ============================================
    // Windows Compatibility Tests
    // ============================================
    suite('Windows Compatibility', () => {
        /**
         * These tests verify that git commands work correctly on Windows.
         * The main issue is that the caret (^) character is an escape character
         * in Windows cmd.exe, which can cause git commands like "git rev-parse HEAD^"
         * to fail or return incorrect results.
         * 
         * The fix uses ~1 instead of ^ for parent references:
         * - HEAD^ -> HEAD~1 (both refer to first parent)
         * - commit^ -> commit~1 (both refer to first parent)
         */

        test('should use tilde notation instead of caret for parent references', () => {
            // Verify that the git command syntax uses ~1 instead of ^
            // This is a documentation/contract test to ensure we don't regress

            // The problematic pattern: commitHash^
            // The safe pattern: commitHash~1

            // Both are equivalent for first parent:
            // HEAD^ = HEAD~1 = first parent of HEAD
            // abc123^ = abc123~1 = first parent of abc123

            const commitHash = 'abc123def456789';

            // The command we should be using (Windows-safe)
            const safeCommand = `git rev-parse ${commitHash}~1`;

            // Verify the command doesn't contain the problematic caret pattern
            // (caret followed by end of string or whitespace)
            const hasProblematicCaret = /\^($|\s)/.test(safeCommand);
            assert.strictEqual(hasProblematicCaret, false,
                'Command should not use caret (^) for parent reference');

            // Verify it uses the tilde notation
            assert.ok(safeCommand.includes('~1'),
                'Command should use ~1 for parent reference');
        });

        test('should not use caret in curly brace suffix for ref validation', () => {
            // The ^{commit} suffix is also problematic on Windows
            // We should use git cat-file -t instead to verify object type

            const ref = 'HEAD';

            // The problematic pattern: ref^{commit}
            const problematicPattern = `${ref}^{commit}`;

            // Verify this pattern contains caret (what we want to avoid)
            assert.ok(problematicPattern.includes('^'),
                'Problematic pattern should contain caret');

            // The safe alternative is to:
            // 1. git rev-parse --verify "ref" to get the hash
            // 2. git cat-file -t "hash" to verify it's a commit
            const safeCommand1 = `git rev-parse --verify "${ref}"`;
            const safeCommand2 = `git cat-file -t "hash"`;

            // Neither safe command should contain caret
            assert.strictEqual(safeCommand1.includes('^'), false,
                'Safe rev-parse command should not contain caret');
            assert.strictEqual(safeCommand2.includes('^'), false,
                'Safe cat-file command should not contain caret');
        });

        test('should handle Windows path separators in git commands', () => {
            // Git commands should use forward slashes even on Windows
            const windowsPath = 'src\\shortcuts\\git\\file.ts';
            const gitPath = windowsPath.replace(/\\/g, '/');

            assert.strictEqual(gitPath, 'src/shortcuts/git/file.ts');
            assert.strictEqual(gitPath.includes('\\'), false,
                'Git path should not contain backslashes');
        });

        test('GitCommitFile should have parentHash for diff comparison', () => {
            // Ensure the parentHash is properly set for committed files
            // This is used to compare old (parent) vs new (commit) content
            const file: GitCommitFile = {
                path: 'src/file.ts',
                status: 'modified',
                commitHash: 'abc123def456789',
                parentHash: 'parent123456789',
                repositoryRoot: '/repo'
            };

            assert.ok(file.parentHash, 'parentHash should be set');
            assert.ok(file.commitHash, 'commitHash should be set');
            assert.notStrictEqual(file.parentHash, file.commitHash,
                'parentHash and commitHash should be different');
        });

        test('should handle empty parentHash for initial commits', () => {
            // Initial commits have no parent, so we use the empty tree hash
            const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

            const file: GitCommitFile = {
                path: 'README.md',
                status: 'added',
                commitHash: 'initial123',
                parentHash: EMPTY_TREE_HASH,
                repositoryRoot: '/repo'
            };

            assert.strictEqual(file.parentHash, EMPTY_TREE_HASH,
                'Initial commit should use empty tree hash as parent');
        });

        test('tilde and caret should be equivalent for first parent', () => {
            // This is a documentation test explaining the equivalence
            // In git:
            // - HEAD^ means "first parent of HEAD"
            // - HEAD~1 means "first ancestor, going back 1 generation"
            // For non-merge commits, these are identical
            // For merge commits, ^ refers to first parent (main branch)

            // We use ~1 because:
            // 1. It's equivalent to ^ for first parent
            // 2. It works on Windows without escaping issues
            // 3. It's more explicit about the number of generations

            const commitRef = 'abc123';
            const caretNotation = `${commitRef}^`;    // Problematic on Windows
            const tildeNotation = `${commitRef}~1`;   // Safe on all platforms

            // Both notations refer to the same commit (first parent)
            // This test documents our choice to use tilde notation
            assert.ok(tildeNotation.endsWith('~1'),
                'Should use tilde notation for cross-platform compatibility');
        });
    });

    // ============================================
    // Stage Section Item Tests
    // ============================================
    suite('StageSectionItem', () => {
        test('should create staged section header', () => {
            const header = new StageSectionItem('staged', 5);
            assert.strictEqual(header.label, 'Staged Changes');
            assert.strictEqual(header.stageType, 'staged');
            assert.strictEqual(header.contextValue, 'gitStageSection_staged');
            assert.strictEqual(header.description, '5');
        });

        test('should create unstaged section header', () => {
            const header = new StageSectionItem('unstaged', 3);
            assert.strictEqual(header.label, 'Changes');
            assert.strictEqual(header.stageType, 'unstaged');
            assert.strictEqual(header.contextValue, 'gitStageSection_unstaged');
            assert.strictEqual(header.description, '3');
        });

        test('should create untracked section header', () => {
            const header = new StageSectionItem('untracked', 2);
            assert.strictEqual(header.label, 'Untracked Files');
            assert.strictEqual(header.stageType, 'untracked');
            assert.strictEqual(header.contextValue, 'gitStageSection_untracked');
            assert.strictEqual(header.description, '2');
        });

        test('should be expanded by default', () => {
            const header = new StageSectionItem('staged', 5);
            assert.strictEqual(header.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
        });

        test('should have green icon for staged section', () => {
            const header = new StageSectionItem('staged', 5);
            assert.ok(header.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((header.iconPath as vscode.ThemeIcon).id, 'check');
        });

        test('should have circle-filled icon for unstaged section', () => {
            const header = new StageSectionItem('unstaged', 3);
            assert.ok(header.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((header.iconPath as vscode.ThemeIcon).id, 'circle-filled');
        });

        test('should have question icon for untracked section', () => {
            const header = new StageSectionItem('untracked', 2);
            assert.ok(header.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((header.iconPath as vscode.ThemeIcon).id, 'question');
        });

        test('should have tooltip for staged section', () => {
            const header = new StageSectionItem('staged', 5);
            assert.ok(header.tooltip?.toString().includes('5'));
            assert.ok(header.tooltip?.toString().includes('staged'));
            assert.ok(header.tooltip?.toString().includes('commit'));
        });

        test('should have tooltip for unstaged section', () => {
            const header = new StageSectionItem('unstaged', 3);
            assert.ok(header.tooltip?.toString().includes('3'));
            assert.ok(header.tooltip?.toString().includes('modified'));
            assert.ok(header.tooltip?.toString().includes('not staged'));
        });

        test('should have tooltip for untracked section', () => {
            const header = new StageSectionItem('untracked', 2);
            assert.ok(header.tooltip?.toString().includes('2'));
            assert.ok(header.tooltip?.toString().includes('untracked'));
        });

        test('should handle singular count in tooltip', () => {
            const stagedHeader = new StageSectionItem('staged', 1);
            const unstagedHeader = new StageSectionItem('unstaged', 1);
            const untrackedHeader = new StageSectionItem('untracked', 1);

            assert.ok(stagedHeader.tooltip?.toString().includes('1 staged change '));
            assert.ok(unstagedHeader.tooltip?.toString().includes('1 modified file '));
            assert.ok(untrackedHeader.tooltip?.toString().includes('1 untracked file'));
        });

        test('should handle zero count', () => {
            const header = new StageSectionItem('staged', 0);
            assert.strictEqual(header.description, '0');
            assert.ok(header.tooltip?.toString().includes('0'));
        });
    });

    // ============================================
    // GitChangeItem Description Tests (Updated)
    // ============================================
    suite('GitChangeItem Description (Updated)', () => {
        // Platform-aware paths for cross-platform tests
        const isWindows = process.platform === 'win32';
        const repoRoot = isWindows ? 'C:\\repo' : '/repo';

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

        test('should show status short code M for modified files', () => {
            const filePath = isWindows ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChange('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);
            assert.ok(item.description?.toString().includes('M'));
        });

        test('should show status short code A for added files', () => {
            const filePath = isWindows ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChange('added', 'staged', filePath);
            const item = new GitChangeItem(change);
            assert.ok(item.description?.toString().includes('A'));
        });

        test('should show status short code D for deleted files', () => {
            const filePath = isWindows ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChange('deleted', 'staged', filePath);
            const item = new GitChangeItem(change);
            assert.ok(item.description?.toString().includes('D'));
        });

        test('should show status short code U for untracked files', () => {
            const filePath = isWindows ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChange('untracked', 'untracked', filePath);
            const item = new GitChangeItem(change);
            assert.ok(item.description?.toString().includes('U'));
        });

        test('should include relative path in description', () => {
            const filePath = isWindows ? 'C:\\repo\\src\\components\\file.ts' : '/repo/src/components/file.ts';
            const change = createMockChange('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);
            assert.ok(item.description?.toString().includes('src/components') ||
                item.description?.toString().includes('src\\components'));
        });

        test('should not include path for root level files', () => {
            const filePath = isWindows ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChange('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);
            // Should just have status code, no bullet point for path
            const desc = item.description?.toString() || '';
            assert.strictEqual(desc.includes('\u2022'), false);
        });
    });

    // ============================================
    // Stage/Unstage Context Value Tests
    // ============================================
    suite('Stage/Unstage Context Values', () => {
        const isWindows = process.platform === 'win32';
        const repoRoot = isWindows ? 'C:\\repo' : '/repo';

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

        test('staged file should have contextValue matching stage button regex', () => {
            const filePath = isWindows ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChange('modified', 'staged', filePath);
            const item = new GitChangeItem(change);

            // The unstage button appears for /^gitChange_staged/
            const regex = /^gitChange_staged/;
            assert.ok(regex.test(item.contextValue || ''),
                `contextValue "${item.contextValue}" should match /^gitChange_staged/`);
        });

        test('unstaged file should have contextValue matching unstage button regex', () => {
            const filePath = isWindows ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChange('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);

            // The stage button appears for /^gitChange_(unstaged|untracked)/
            const regex = /^gitChange_(unstaged|untracked)/;
            assert.ok(regex.test(item.contextValue || ''),
                `contextValue "${item.contextValue}" should match /^gitChange_(unstaged|untracked)/`);
        });

        test('untracked file should have contextValue matching stage button regex', () => {
            const filePath = isWindows ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChange('untracked', 'untracked', filePath);
            const item = new GitChangeItem(change);

            // The stage button appears for /^gitChange_(unstaged|untracked)/
            const regex = /^gitChange_(unstaged|untracked)/;
            assert.ok(regex.test(item.contextValue || ''),
                `contextValue "${item.contextValue}" should match /^gitChange_(unstaged|untracked)/`);
        });

        test('markdown files should have _md suffix in contextValue', () => {
            const filePath = isWindows ? 'C:\\repo\\README.md' : '/repo/README.md';
            const change = createMockChange('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);

            assert.ok(item.contextValue?.endsWith('_md'),
                `contextValue "${item.contextValue}" should end with _md`);
        });

        test('non-markdown files should not have _md suffix', () => {
            const filePath = isWindows ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChange('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);

            assert.ok(!item.contextValue?.endsWith('_md'),
                `contextValue "${item.contextValue}" should not end with _md`);
        });
    });

    // ============================================
    // GitService Stage/Unstage Tests
    // ============================================
    suite('GitService Stage/Unstage Methods', () => {
        test('GitService should have stageFile method', async () => {
            const { GitService } = await import('../../shortcuts/git/git-service');
            const service = new GitService();

            assert.ok(typeof service.stageFile === 'function');

            service.dispose();
        });

        test('GitService should have unstageFile method', async () => {
            const { GitService } = await import('../../shortcuts/git/git-service');
            const service = new GitService();

            assert.ok(typeof service.unstageFile === 'function');

            service.dispose();
        });

        test('stageFile should return false when not initialized', async () => {
            const { GitService } = await import('../../shortcuts/git/git-service');
            const service = new GitService();

            // Not initialized, should return false
            const result = await service.stageFile('/some/path/file.ts');
            assert.strictEqual(result, false);

            service.dispose();
        });

        test('unstageFile should return false when not initialized', async () => {
            const { GitService } = await import('../../shortcuts/git/git-service');
            const service = new GitService();

            // Not initialized, should return false
            const result = await service.unstageFile('/some/path/file.ts');
            assert.strictEqual(result, false);

            service.dispose();
        });
    });

    // ============================================
    // Stage/Unstage Inline Button Tests
    // ============================================
    suite('Stage/Unstage Inline Buttons', () => {
        const isWindowsBtn = process.platform === 'win32';
        const repoRootBtn = isWindowsBtn ? 'C:\\repo' : '/repo';

        const createMockChangeBtn = (
            status: GitChangeStatus,
            stage: GitChangeStage,
            filePath: string
        ): GitChange => ({
            path: filePath,
            status,
            stage,
            repositoryRoot: repoRootBtn,
            repositoryName: 'repo',
            uri: vscode.Uri.file(filePath)
        });

        test('loading state should add _loading suffix to contextValue', () => {
            const filePath = isWindowsBtn ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeBtn('modified', 'unstaged', filePath);
            
            // Without loading
            const itemNormal = new GitChangeItem(change, false);
            assert.strictEqual(itemNormal.contextValue, 'gitChange_unstaged');
            
            // With loading
            const itemLoading = new GitChangeItem(change, true);
            assert.strictEqual(itemLoading.contextValue, 'gitChange_unstaged_loading');
        });

        test('loading state should show spinner icon', () => {
            const filePath = isWindowsBtn ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeBtn('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, true);
            
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'loading~spin');
        });

        test('loading state should disable command', () => {
            const filePath = isWindowsBtn ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeBtn('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, true);
            
            assert.strictEqual(item.command, undefined);
        });

        test('non-loading state should have command', () => {
            const filePath = isWindowsBtn ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeBtn('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, false);
            
            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'gitDiffComments.openWithReview');
        });

        test('staged markdown file should have correct contextValue for inline button', () => {
            const filePath = isWindowsBtn ? 'C:\\repo\\README.md' : '/repo/README.md';
            const change = createMockChangeBtn('modified', 'staged', filePath);
            const item = new GitChangeItem(change);
            
            // Should match /^gitChange_staged/ for unstage button
            assert.strictEqual(item.contextValue, 'gitChange_staged_md');
            assert.ok(/^gitChange_staged/.test(item.contextValue));
        });

        test('unstaged markdown file should have correct contextValue for inline button', () => {
            const filePath = isWindowsBtn ? 'C:\\repo\\README.md' : '/repo/README.md';
            const change = createMockChangeBtn('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);
            
            // Should match /^gitChange_(unstaged|untracked)/ for stage button
            assert.strictEqual(item.contextValue, 'gitChange_unstaged_md');
            assert.ok(/^gitChange_(unstaged|untracked)/.test(item.contextValue));
        });

        test('loading markdown file should have _loading suffix', () => {
            const filePath = isWindowsBtn ? 'C:\\repo\\README.md' : '/repo/README.md';
            const change = createMockChangeBtn('modified', 'staged', filePath);
            const item = new GitChangeItem(change, true);
            
            assert.strictEqual(item.contextValue, 'gitChange_staged_md_loading');
        });

        test('all stage types should have correct contextValue pattern', () => {
            const filePath = isWindowsBtn ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            
            // Staged
            const stagedChange = createMockChangeBtn('modified', 'staged', filePath);
            const stagedItem = new GitChangeItem(stagedChange);
            assert.ok(/^gitChange_staged/.test(stagedItem.contextValue || ''));
            
            // Unstaged
            const unstagedChange = createMockChangeBtn('modified', 'unstaged', filePath);
            const unstagedItem = new GitChangeItem(unstagedChange);
            assert.ok(/^gitChange_(unstaged|untracked)/.test(unstagedItem.contextValue || ''));
            
            // Untracked
            const untrackedChange = createMockChangeBtn('untracked', 'untracked', filePath);
            const untrackedItem = new GitChangeItem(untrackedChange);
            assert.ok(/^gitChange_(unstaged|untracked)/.test(untrackedItem.contextValue || ''));
        });

        test('loading description should include loading indicator', () => {
            const filePath = isWindowsBtn ? 'C:\\repo\\src\\file.ts' : '/repo/src/file.ts';
            const change = createMockChangeBtn('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, true);
            
            // Description should contain loading indicator
            const description = typeof item.description === 'string' ? item.description : '';
            assert.ok(description.includes('⏳'), 
                `Description "${description}" should include loading indicator`);
        });

        test('non-loading description should not include loading indicator', () => {
            const filePath = isWindowsBtn ? 'C:\\repo\\src\\file.ts' : '/repo/src/file.ts';
            const change = createMockChangeBtn('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, false);
            
            // Description should not contain loading indicator
            const description = typeof item.description === 'string' ? item.description : '';
            assert.ok(!description.includes('⏳'), 
                `Description "${description}" should not include loading indicator`);
        });
    });

    // ============================================
    // GitService Discard/Delete Methods Tests
    // ============================================
    suite('GitService Discard/Delete Methods', () => {
        test('GitService should have discardChanges method', async () => {
            const { GitService } = await import('../../shortcuts/git/git-service');
            const service = new GitService();

            assert.ok(typeof service.discardChanges === 'function');

            service.dispose();
        });

        test('GitService should have deleteUntrackedFile method', async () => {
            const { GitService } = await import('../../shortcuts/git/git-service');
            const service = new GitService();

            assert.ok(typeof service.deleteUntrackedFile === 'function');

            service.dispose();
        });

        test('discardChanges should return false when not initialized', async () => {
            const { GitService } = await import('../../shortcuts/git/git-service');
            const service = new GitService();

            // Not initialized, should return false
            const result = await service.discardChanges('/some/path/file.ts');
            assert.strictEqual(result, false);

            service.dispose();
        });

        test('deleteUntrackedFile should return false when not initialized', async () => {
            const { GitService } = await import('../../shortcuts/git/git-service');
            const service = new GitService();

            // Not initialized, should return false
            const result = await service.deleteUntrackedFile('/some/path/file.ts');
            assert.strictEqual(result, false);

            service.dispose();
        });
    });

    // ============================================
    // Discard/Delete Inline Button Tests
    // ============================================
    suite('Discard/Delete Inline Buttons', () => {
        const isWindowsDiscard = process.platform === 'win32';
        const repoRootDiscard = isWindowsDiscard ? 'C:\\repo' : '/repo';

        const createMockChangeDiscard = (
            status: GitChangeStatus,
            stage: GitChangeStage,
            filePath: string
        ): GitChange => ({
            path: filePath,
            status,
            stage,
            repositoryRoot: repoRootDiscard,
            repositoryName: 'repo',
            uri: vscode.Uri.file(filePath)
        });

        test('unstaged file should have correct contextValue for discard button', () => {
            const filePath = isWindowsDiscard ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeDiscard('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);
            
            // Should match /^gitChange_unstaged/ for discard button
            assert.strictEqual(item.contextValue, 'gitChange_unstaged');
            assert.ok(/^gitChange_unstaged/.test(item.contextValue));
        });

        test('untracked file should have correct contextValue for delete button', () => {
            const filePath = isWindowsDiscard ? 'C:\\repo\\newfile.ts' : '/repo/newfile.ts';
            const change = createMockChangeDiscard('untracked', 'untracked', filePath);
            const item = new GitChangeItem(change);
            
            // Should match /^gitChange_untracked/ for delete button
            assert.strictEqual(item.contextValue, 'gitChange_untracked');
            assert.ok(/^gitChange_untracked/.test(item.contextValue));
        });

        test('staged file should NOT match discard button pattern', () => {
            const filePath = isWindowsDiscard ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeDiscard('modified', 'staged', filePath);
            const item = new GitChangeItem(change);
            
            // Should NOT match /^gitChange_unstaged/ for discard button
            assert.strictEqual(item.contextValue, 'gitChange_staged');
            assert.ok(!/^gitChange_unstaged/.test(item.contextValue));
        });

        test('unstaged file should NOT match delete button pattern', () => {
            const filePath = isWindowsDiscard ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeDiscard('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);
            
            // Should NOT match /^gitChange_untracked/ for delete button
            assert.strictEqual(item.contextValue, 'gitChange_unstaged');
            assert.ok(!/^gitChange_untracked/.test(item.contextValue));
        });

        test('unstaged markdown file should have correct contextValue for discard button', () => {
            const filePath = isWindowsDiscard ? 'C:\\repo\\README.md' : '/repo/README.md';
            const change = createMockChangeDiscard('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);
            
            // Should match /^gitChange_unstaged/ for discard button
            assert.strictEqual(item.contextValue, 'gitChange_unstaged_md');
            assert.ok(/^gitChange_unstaged/.test(item.contextValue));
        });

        test('untracked markdown file should have correct contextValue for delete button', () => {
            const filePath = isWindowsDiscard ? 'C:\\repo\\newfile.md' : '/repo/newfile.md';
            const change = createMockChangeDiscard('untracked', 'untracked', filePath);
            const item = new GitChangeItem(change);
            
            // Should match /^gitChange_untracked/ for delete button
            assert.strictEqual(item.contextValue, 'gitChange_untracked_md');
            assert.ok(/^gitChange_untracked/.test(item.contextValue));
        });

        test('loading unstaged file should still match discard button pattern', () => {
            const filePath = isWindowsDiscard ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeDiscard('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, true);
            
            // Should match /^gitChange_unstaged/ even with loading suffix
            assert.strictEqual(item.contextValue, 'gitChange_unstaged_loading');
            assert.ok(/^gitChange_unstaged/.test(item.contextValue));
        });

        test('loading untracked file should still match delete button pattern', () => {
            const filePath = isWindowsDiscard ? 'C:\\repo\\newfile.ts' : '/repo/newfile.ts';
            const change = createMockChangeDiscard('untracked', 'untracked', filePath);
            const item = new GitChangeItem(change, true);
            
            // Should match /^gitChange_untracked/ even with loading suffix
            assert.strictEqual(item.contextValue, 'gitChange_untracked_loading');
            assert.ok(/^gitChange_untracked/.test(item.contextValue));
        });
    });

    // ============================================
    // StageSectionItem Export Tests
    // ============================================
    suite('StageSectionItem Exports', () => {
        test('should export StageSectionItem from index', async () => {
            const { StageSectionItem } = await import('../../shortcuts/git');
            assert.ok(StageSectionItem);
        });

        test('StageSectionItem should be instance of TreeItem', () => {
            const header = new StageSectionItem('staged', 5);
            assert.ok(header instanceof vscode.TreeItem);
        });
    });

    // ============================================
    // GitDragDropController Tests
    // ============================================
    suite('GitDragDropController', () => {
        // Platform-aware paths for cross-platform tests
        const isWindowsDrag = process.platform === 'win32';
        const repoRootDrag = isWindowsDrag ? 'C:\\repo' : '/repo';
        const defaultFilePathDrag = isWindowsDrag ? 'C:\\repo\\src\\file.ts' : '/repo/src/file.ts';

        const createMockChangeDrag = (
            status: GitChangeStatus,
            stage: GitChangeStage,
            filePath: string = defaultFilePathDrag
        ): GitChange => ({
            path: filePath,
            status,
            stage,
            repositoryRoot: repoRootDrag,
            repositoryName: 'repo',
            uri: vscode.Uri.file(filePath)
        });

        test('should export GitDragDropController from index', async () => {
            const { GitDragDropController } = await import('../../shortcuts/git');
            assert.ok(GitDragDropController);
        });

        test('should have correct dragMimeTypes', async () => {
            const { GitDragDropController } = await import('../../shortcuts/git');
            const controller = new GitDragDropController();

            assert.ok(Array.isArray(controller.dragMimeTypes));
            assert.ok(controller.dragMimeTypes.includes('text/uri-list'),
                'Should include text/uri-list for Copilot Chat compatibility');
        });

        test('should have empty dropMimeTypes (read-only tree)', async () => {
            const { GitDragDropController } = await import('../../shortcuts/git');
            const controller = new GitDragDropController();

            assert.ok(Array.isArray(controller.dropMimeTypes));
            assert.strictEqual(controller.dropMimeTypes.length, 0,
                'Git tree should not accept drops');
        });

        test('handleDrag should populate dataTransfer with URIs from GitChangeItem', async () => {
            const { GitDragDropController } = await import('../../shortcuts/git');
            const controller = new GitDragDropController();

            const filePath = isWindowsDrag ? 'C:\\repo\\test-file.ts' : '/repo/test-file.ts';
            const change = createMockChangeDrag('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);

            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;

            await controller.handleDrag([item], dataTransfer, token);

            const uriListData = dataTransfer.get('text/uri-list');
            assert.ok(uriListData, 'Should set text/uri-list data');

            const uriListString = uriListData?.value;
            assert.ok(typeof uriListString === 'string', 'URI list should be a string');
            assert.ok(uriListString.includes('file://'), 'Should contain file URI');
        });

        test('handleDrag should handle multiple items', async () => {
            const { GitDragDropController } = await import('../../shortcuts/git');
            const controller = new GitDragDropController();

            const filePath1 = isWindowsDrag ? 'C:\\repo\\file1.ts' : '/repo/file1.ts';
            const filePath2 = isWindowsDrag ? 'C:\\repo\\file2.ts' : '/repo/file2.ts';
            const change1 = createMockChangeDrag('modified', 'unstaged', filePath1);
            const change2 = createMockChangeDrag('added', 'staged', filePath2);
            const item1 = new GitChangeItem(change1);
            const item2 = new GitChangeItem(change2);

            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;

            await controller.handleDrag([item1, item2], dataTransfer, token);

            const uriListData = dataTransfer.get('text/uri-list');
            assert.ok(uriListData, 'Should set text/uri-list data');

            const uriListString = uriListData?.value;
            // Multiple URIs should be separated by CRLF
            assert.ok(uriListString.includes('\r\n') || uriListString.split('file://').length > 2,
                'Should contain multiple URIs');
        });

        test('handleDrag should handle items without resourceUri gracefully', async () => {
            const { GitDragDropController } = await import('../../shortcuts/git');
            const controller = new GitDragDropController();

            // Create a mock tree item without resourceUri
            const mockItem = new vscode.TreeItem('Mock Item');

            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;

            // Should not throw
            await controller.handleDrag([mockItem], dataTransfer, token);

            // No URIs should be set for items without resourceUri
            const uriListData = dataTransfer.get('text/uri-list');
            assert.ok(!uriListData, 'Should not set URI list for items without resourceUri');
        });
    });

    // ============================================
    // GitChangeItem Loading State Tests
    // ============================================
    suite('GitChangeItem Loading State', () => {
        // Platform-aware paths for cross-platform tests
        const isWindowsLoading = process.platform === 'win32';
        const repoRootLoading = isWindowsLoading ? 'C:\\repo' : '/repo';
        const defaultFilePathLoading = isWindowsLoading ? 'C:\\repo\\src\\file.ts' : '/repo/src/file.ts';

        const createMockChangeLoading = (
            status: GitChangeStatus,
            stage: GitChangeStage,
            filePath: string = defaultFilePathLoading
        ): GitChange => ({
            path: filePath,
            status,
            stage,
            repositoryRoot: repoRootLoading,
            repositoryName: 'repo',
            uri: vscode.Uri.file(filePath)
        });

        test('should not be loading by default', () => {
            const filePath = isWindowsLoading ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeLoading('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change);

            assert.strictEqual(item.isLoading, false, 'Should not be loading by default');
        });

        test('should have loading state when isLoading is true', () => {
            const filePath = isWindowsLoading ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeLoading('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, true);

            assert.strictEqual(item.isLoading, true, 'Should be loading');
        });

        test('loading item should have spinner icon', () => {
            const filePath = isWindowsLoading ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeLoading('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, true);

            assert.ok(item.iconPath, 'Loading item should have an icon');
            assert.ok(item.iconPath instanceof vscode.ThemeIcon, 'Icon should be a ThemeIcon');
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'loading~spin',
                'Should use loading spinner icon');
        });

        test('loading item should have no command', () => {
            const filePath = isWindowsLoading ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeLoading('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, true);

            assert.strictEqual(item.command, undefined,
                'Loading item should not have a command (disabled)');
        });

        test('non-loading item should have command', () => {
            const filePath = isWindowsLoading ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeLoading('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, false);

            assert.ok(item.command, 'Non-loading item should have a command');
            assert.strictEqual(item.command?.command, 'gitDiffComments.openWithReview');
        });

        test('loading item contextValue should have _loading suffix', () => {
            const filePath = isWindowsLoading ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeLoading('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, true);

            assert.ok(item.contextValue?.endsWith('_loading'),
                `contextValue "${item.contextValue}" should end with _loading`);
        });

        test('loading item description should have loading indicator', () => {
            const filePath = isWindowsLoading ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeLoading('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, true);

            assert.ok((item.description as string)?.includes('⏳'),
                `description "${item.description}" should contain loading indicator`);
        });

        test('non-loading item description should not have loading indicator', () => {
            const filePath = isWindowsLoading ? 'C:\\repo\\file.ts' : '/repo/file.ts';
            const change = createMockChangeLoading('modified', 'unstaged', filePath);
            const item = new GitChangeItem(change, false);

            assert.ok(!(item.description as string)?.includes('⏳'),
                `description "${item.description}" should not contain loading indicator`);
        });
    });

    // ============================================
    // GitTreeDataProvider Loading State Tests
    // ============================================
    suite('GitTreeDataProvider Loading State Methods', () => {
        test('should export loading state methods', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            assert.ok(typeof provider.setFileLoading === 'function',
                'Should have setFileLoading method');
            assert.ok(typeof provider.clearFileLoading === 'function',
                'Should have clearFileLoading method');
            assert.ok(typeof provider.isFileLoading === 'function',
                'Should have isFileLoading method');
            assert.ok(typeof provider.clearAllLoading === 'function',
                'Should have clearAllLoading method');

            provider.dispose();
        });

        test('setFileLoading should mark file as loading', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const filePath = '/repo/test-file.ts';

            assert.strictEqual(provider.isFileLoading(filePath), false,
                'File should not be loading initially');

            provider.setFileLoading(filePath);

            assert.strictEqual(provider.isFileLoading(filePath), true,
                'File should be loading after setFileLoading');

            provider.dispose();
        });

        test('clearFileLoading should clear loading state', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const filePath = '/repo/test-file.ts';

            provider.setFileLoading(filePath);
            assert.strictEqual(provider.isFileLoading(filePath), true);

            provider.clearFileLoading(filePath);
            assert.strictEqual(provider.isFileLoading(filePath), false,
                'File should not be loading after clearFileLoading');

            provider.dispose();
        });

        test('clearAllLoading should clear all loading states', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const filePath1 = '/repo/file1.ts';
            const filePath2 = '/repo/file2.ts';

            provider.setFileLoading(filePath1);
            provider.setFileLoading(filePath2);

            assert.strictEqual(provider.isFileLoading(filePath1), true);
            assert.strictEqual(provider.isFileLoading(filePath2), true);

            provider.clearAllLoading();

            assert.strictEqual(provider.isFileLoading(filePath1), false,
                'File1 should not be loading after clearAllLoading');
            assert.strictEqual(provider.isFileLoading(filePath2), false,
                'File2 should not be loading after clearAllLoading');

            provider.dispose();
        });

        test('multiple files can be loading simultaneously', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const filePath1 = '/repo/file1.ts';
            const filePath2 = '/repo/file2.ts';
            const filePath3 = '/repo/file3.ts';

            provider.setFileLoading(filePath1);
            provider.setFileLoading(filePath2);

            assert.strictEqual(provider.isFileLoading(filePath1), true);
            assert.strictEqual(provider.isFileLoading(filePath2), true);
            assert.strictEqual(provider.isFileLoading(filePath3), false,
                'File3 should not be loading');

            provider.dispose();
        });
    });

    // ============================================
    // GitTreeDataProvider Commit Count Preservation Tests
    // ============================================
    suite('GitTreeDataProvider Commit Count Preservation', () => {
        test('should have getCommitCount method', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            assert.ok(typeof provider.getCommitCount === 'function',
                'Should have getCommitCount method');

            provider.dispose();
        });

        test('should have getHasMoreCommits method', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            assert.ok(typeof provider.getHasMoreCommits === 'function',
                'Should have getHasMoreCommits method');

            provider.dispose();
        });

        test('should return 0 commit count when not initialized', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            assert.strictEqual(provider.getCommitCount(), 0,
                'Should return 0 commits when not initialized');

            provider.dispose();
        });

        test('should return false for hasMoreCommits when not initialized', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            assert.strictEqual(provider.getHasMoreCommits(), false,
                'Should return false for hasMoreCommits when not initialized');

            provider.dispose();
        });

        test('getViewCounts should include commitCount and hasMoreCommits', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const counts = provider.getViewCounts();

            assert.ok('commitCount' in counts, 'Should have commitCount property');
            assert.ok('hasMoreCommits' in counts, 'Should have hasMoreCommits property');
            assert.strictEqual(typeof counts.commitCount, 'number', 'commitCount should be a number');
            assert.strictEqual(typeof counts.hasMoreCommits, 'boolean', 'hasMoreCommits should be a boolean');

            provider.dispose();
        });
    });

    // ============================================
    // Looked-Up Commits List Tests
    // ============================================
    suite('Looked-Up Commits List', () => {
        // Helper function to create a mock commit
        function createMockCommit(hash: string, subject: string): GitCommit {
            return {
                hash,
                shortHash: hash.substring(0, 7),
                subject,
                authorName: 'Test Author',
                authorEmail: 'test@example.com',
                date: '2024-01-15T10:30:00Z',
                relativeDate: '2 hours ago',
                parentHashes: 'parent123',
                refs: [],
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };
        }

        test('should initialize with empty looked-up commits list', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commits = provider.getLookedUpCommits();
            assert.deepStrictEqual(commits, [], 'Should start with empty list');
            assert.strictEqual(provider.getLookedUpCommit(), null, 'getLookedUpCommit should return null when empty');

            provider.dispose();
        });

        test('should add looked-up commits to the list', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commit1 = createMockCommit('abc123def456789', 'First commit');
            const commit2 = createMockCommit('def456ghi789012', 'Second commit');

            provider.addLookedUpCommit(commit1);
            assert.strictEqual(provider.getLookedUpCommits().length, 1, 'Should have 1 commit');
            assert.strictEqual(provider.getLookedUpCommits()[0].hash, commit1.hash);

            provider.addLookedUpCommit(commit2);
            assert.strictEqual(provider.getLookedUpCommits().length, 2, 'Should have 2 commits');
            // Newest first
            assert.strictEqual(provider.getLookedUpCommits()[0].hash, commit2.hash, 'Most recent should be first');
            assert.strictEqual(provider.getLookedUpCommits()[1].hash, commit1.hash);

            provider.dispose();
        });

        test('should move duplicate commit to front of list', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commit1 = createMockCommit('abc123def456789', 'First commit');
            const commit2 = createMockCommit('def456ghi789012', 'Second commit');
            const commit3 = createMockCommit('ghi789jkl012345', 'Third commit');

            provider.addLookedUpCommit(commit1);
            provider.addLookedUpCommit(commit2);
            provider.addLookedUpCommit(commit3);

            // Re-add commit1 - should move to front
            provider.addLookedUpCommit(commit1);

            const commits = provider.getLookedUpCommits();
            assert.strictEqual(commits.length, 3, 'Should still have 3 commits (no duplicate)');
            assert.strictEqual(commits[0].hash, commit1.hash, 'Re-added commit should be first');
            assert.strictEqual(commits[1].hash, commit3.hash);
            assert.strictEqual(commits[2].hash, commit2.hash);

            provider.dispose();
        });

        test('should clear specific commit by index', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commit1 = createMockCommit('abc123def456789', 'First commit');
            const commit2 = createMockCommit('def456ghi789012', 'Second commit');
            const commit3 = createMockCommit('ghi789jkl012345', 'Third commit');

            provider.addLookedUpCommit(commit1);
            provider.addLookedUpCommit(commit2);
            provider.addLookedUpCommit(commit3);

            // Clear the middle one (index 1, which is commit2)
            provider.clearLookedUpCommitByIndex(1);

            const commits = provider.getLookedUpCommits();
            assert.strictEqual(commits.length, 2, 'Should have 2 commits after clearing one');
            assert.strictEqual(commits[0].hash, commit3.hash, 'First should be commit3');
            assert.strictEqual(commits[1].hash, commit1.hash, 'Second should be commit1');

            provider.dispose();
        });

        test('should clear specific commit by hash', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commit1 = createMockCommit('abc123def456789', 'First commit');
            const commit2 = createMockCommit('def456ghi789012', 'Second commit');

            provider.addLookedUpCommit(commit1);
            provider.addLookedUpCommit(commit2);

            provider.clearLookedUpCommitByHash(commit1.hash);

            const commits = provider.getLookedUpCommits();
            assert.strictEqual(commits.length, 1, 'Should have 1 commit after clearing one');
            assert.strictEqual(commits[0].hash, commit2.hash);

            provider.dispose();
        });

        test('should clear all looked-up commits', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commit1 = createMockCommit('abc123def456789', 'First commit');
            const commit2 = createMockCommit('def456ghi789012', 'Second commit');

            provider.addLookedUpCommit(commit1);
            provider.addLookedUpCommit(commit2);

            provider.clearAllLookedUpCommits();

            assert.deepStrictEqual(provider.getLookedUpCommits(), [], 'Should have empty list after clearing all');

            provider.dispose();
        });

        test('clearLookedUpCommit should clear all (backwards compatibility)', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commit1 = createMockCommit('abc123def456789', 'First commit');
            const commit2 = createMockCommit('def456ghi789012', 'Second commit');

            provider.addLookedUpCommit(commit1);
            provider.addLookedUpCommit(commit2);

            provider.clearLookedUpCommit();

            assert.deepStrictEqual(provider.getLookedUpCommits(), [], 'Should have empty list');

            provider.dispose();
        });

        test('setLookedUpCommit should add to list (backwards compatibility)', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commit1 = createMockCommit('abc123def456789', 'First commit');

            provider.setLookedUpCommit(commit1);

            assert.strictEqual(provider.getLookedUpCommits().length, 1);
            assert.strictEqual(provider.getLookedUpCommit()?.hash, commit1.hash);

            provider.dispose();
        });

        test('setLookedUpCommit with null should clear all (backwards compatibility)', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commit1 = createMockCommit('abc123def456789', 'First commit');
            provider.addLookedUpCommit(commit1);

            provider.setLookedUpCommit(null);

            assert.deepStrictEqual(provider.getLookedUpCommits(), []);

            provider.dispose();
        });

        test('clearLookedUpCommitByIndex should handle out of bounds gracefully', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commit1 = createMockCommit('abc123def456789', 'First commit');
            provider.addLookedUpCommit(commit1);

            // Should not throw for out of bounds
            provider.clearLookedUpCommitByIndex(-1);
            provider.clearLookedUpCommitByIndex(100);

            assert.strictEqual(provider.getLookedUpCommits().length, 1, 'Should still have 1 commit');

            provider.dispose();
        });

        test('clearLookedUpCommitByHash should handle non-existent hash gracefully', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commit1 = createMockCommit('abc123def456789', 'First commit');
            provider.addLookedUpCommit(commit1);

            // Should not throw for non-existent hash
            provider.clearLookedUpCommitByHash('nonexistenthash');

            assert.strictEqual(provider.getLookedUpCommits().length, 1, 'Should still have 1 commit');

            provider.dispose();
        });

        test('getLookedUpCommits should return a copy of the list', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git');
            const provider = new GitTreeDataProvider();

            const commit1 = createMockCommit('abc123def456789', 'First commit');
            provider.addLookedUpCommit(commit1);

            const commits1 = provider.getLookedUpCommits();
            const commits2 = provider.getLookedUpCommits();

            // Should be different array instances
            assert.notStrictEqual(commits1, commits2, 'Should return new array each time');
            assert.deepStrictEqual(commits1, commits2, 'But with same contents');

            provider.dispose();
        });
    });

    // ============================================
    // LookedUpCommitItem Tests
    // ============================================
    suite('LookedUpCommitItem', () => {
        test('should create item with index in contextValue', async () => {
            const { LookedUpCommitItem } = await import('../../shortcuts/git');
            
            const commit: GitCommit = {
                hash: 'abc123def456789',
                shortHash: 'abc123d',
                subject: 'Test commit',
                authorName: 'Test Author',
                authorEmail: 'test@example.com',
                date: '2024-01-15T10:30:00Z',
                relativeDate: '2 hours ago',
                parentHashes: 'parent123',
                refs: [],
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };

            const item0 = new LookedUpCommitItem(commit, 0);
            const item5 = new LookedUpCommitItem(commit, 5);

            assert.strictEqual(item0.contextValue, 'lookedUpCommit_0');
            assert.strictEqual(item5.contextValue, 'lookedUpCommit_5');
            assert.strictEqual(item0.index, 0);
            assert.strictEqual(item5.index, 5);
        });

        test('should default to index 0 if not specified', async () => {
            const { LookedUpCommitItem } = await import('../../shortcuts/git');
            
            const commit: GitCommit = {
                hash: 'abc123def456789',
                shortHash: 'abc123d',
                subject: 'Test commit',
                authorName: 'Test Author',
                authorEmail: 'test@example.com',
                date: '2024-01-15T10:30:00Z',
                relativeDate: '2 hours ago',
                parentHashes: 'parent123',
                refs: [],
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };

            const item = new LookedUpCommitItem(commit);
            assert.strictEqual(item.contextValue, 'lookedUpCommit_0');
            assert.strictEqual(item.index, 0);
        });

        test('should store commit reference correctly', async () => {
            const { LookedUpCommitItem } = await import('../../shortcuts/git');
            
            const commit: GitCommit = {
                hash: 'abc123def456789',
                shortHash: 'abc123d',
                subject: 'Test commit',
                authorName: 'Test Author',
                authorEmail: 'test@example.com',
                date: '2024-01-15T10:30:00Z',
                relativeDate: '2 hours ago',
                parentHashes: 'parent123',
                refs: ['main'],
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };

            const item = new LookedUpCommitItem(commit, 3);
            
            assert.strictEqual(item.commit.hash, commit.hash);
            assert.strictEqual(item.commit.subject, commit.subject);
            assert.deepStrictEqual(item.commit.refs, commit.refs);
        });
    });
});

