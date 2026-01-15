/**
 * Tests for Git Commit Range feature
 * Covers: GitRangeService, GitCommitRangeItem, GitRangeFileItem, BranchChangesSectionItem
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { BranchChangesSectionItem } from '../../shortcuts/git/branch-changes-section-item';
import { GitCommitRangeItem } from '../../shortcuts/git/git-commit-range-item';
import { GitRangeFileItem } from '../../shortcuts/git/git-range-file-item';
import { GitRangeService } from '../../shortcuts/git/git-range-service';
import {
    GitChangeStatus,
    GitCommitRange,
    GitCommitRangeFile
} from '../../shortcuts/git/types';

suite('Git Commit Range Tests', () => {

    // ============================================
    // Type Tests
    // ============================================
    suite('Git Commit Range Types', () => {
        test('should have correct GitCommitRange structure', () => {
            const range: GitCommitRange = {
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 5,
                files: [],
                additions: 100,
                deletions: 50,
                mergeBase: 'abc123def456789',
                branchName: 'feature/test',
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };
            assert.strictEqual(range.baseRef, 'origin/main');
            assert.strictEqual(range.headRef, 'HEAD');
            assert.strictEqual(range.commitCount, 5);
            assert.strictEqual(range.additions, 100);
            assert.strictEqual(range.deletions, 50);
            assert.strictEqual(range.branchName, 'feature/test');
        });

        test('should have correct GitCommitRangeFile structure', () => {
            const file: GitCommitRangeFile = {
                path: 'src/test.ts',
                status: 'modified',
                additions: 10,
                deletions: 5,
                repositoryRoot: '/repo'
            };
            assert.strictEqual(file.path, 'src/test.ts');
            assert.strictEqual(file.status, 'modified');
            assert.strictEqual(file.additions, 10);
            assert.strictEqual(file.deletions, 5);
        });

        test('should support renamed files with oldPath', () => {
            const file: GitCommitRangeFile = {
                path: 'src/new-name.ts',
                status: 'renamed',
                additions: 0,
                deletions: 0,
                oldPath: 'src/old-name.ts',
                repositoryRoot: '/repo'
            };
            assert.strictEqual(file.oldPath, 'src/old-name.ts');
            assert.strictEqual(file.status, 'renamed');
        });

        test('should support all change status types', () => {
            const statuses: GitChangeStatus[] = [
                'modified', 'added', 'deleted', 'renamed',
                'copied', 'untracked', 'ignored', 'conflict'
            ];
            statuses.forEach(status => {
                const file: GitCommitRangeFile = {
                    path: 'test.ts',
                    status,
                    additions: 0,
                    deletions: 0,
                    repositoryRoot: '/repo'
                };
                assert.strictEqual(file.status, status);
            });
        });
    });

    // ============================================
    // BranchChangesSectionItem Tests
    // ============================================
    suite('BranchChangesSectionItem', () => {
        test('should create section with correct label', () => {
            const item = new BranchChangesSectionItem(1);
            assert.strictEqual(item.label, 'Branch Changes');
        });

        test('should have correct context value', () => {
            const item = new BranchChangesSectionItem(1);
            assert.strictEqual(item.contextValue, 'gitSection_branchChanges');
        });

        test('should show count in description', () => {
            const item = new BranchChangesSectionItem(1);
            assert.strictEqual(item.description, '1');
        });

        test('should be expanded by default', () => {
            const item = new BranchChangesSectionItem(1);
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
        });

        test('should have git-branch icon', () => {
            const item = new BranchChangesSectionItem(1);
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'git-branch');
        });

        test('should have appropriate tooltip for single range', () => {
            const item = new BranchChangesSectionItem(1);
            assert.strictEqual(item.tooltip, 'Changes on current branch compared to remote default branch');
        });

        test('should have appropriate tooltip for multiple ranges', () => {
            const item = new BranchChangesSectionItem(3);
            assert.strictEqual(item.tooltip, '3 commit ranges');
        });
    });

    // ============================================
    // GitCommitRangeItem Tests
    // ============================================
    suite('GitCommitRangeItem', () => {
        const createTestRange = (overrides?: Partial<GitCommitRange>): GitCommitRange => ({
            baseRef: 'origin/main',
            headRef: 'HEAD',
            commitCount: 5,
            files: [
                { path: 'src/test.ts', status: 'modified', additions: 10, deletions: 5, repositoryRoot: '/repo' },
                { path: 'src/new.ts', status: 'added', additions: 50, deletions: 0, repositoryRoot: '/repo' }
            ],
            additions: 60,
            deletions: 5,
            mergeBase: 'abc123def456789',
            branchName: 'feature/test',
            repositoryRoot: '/repo',
            repositoryName: 'repo',
            ...overrides
        });

        test('should create item with correct label for feature branch', () => {
            const range = createTestRange();
            const item = new GitCommitRangeItem(range);
            assert.strictEqual(item.label, 'feature/test: 5 commits ahead of origin/main');
        });

        test('should use HEAD when no branch name', () => {
            const range = createTestRange({ branchName: undefined });
            const item = new GitCommitRangeItem(range);
            assert.strictEqual(item.label, 'HEAD: 5 commits ahead of origin/main');
        });

        test('should handle singular commit correctly', () => {
            const range = createTestRange({ commitCount: 1 });
            const item = new GitCommitRangeItem(range);
            assert.ok((item.label as string).includes('1 commit ahead'));
        });

        test('should have correct context value', () => {
            const range = createTestRange();
            const item = new GitCommitRangeItem(range);
            assert.strictEqual(item.contextValue, 'gitCommitRange');
        });

        test('should show file count and stats in description', () => {
            const range = createTestRange();
            const item = new GitCommitRangeItem(range);
            const desc = item.description as string;
            assert.ok(desc.includes('2 files changed'));
            assert.ok(desc.includes('+60/-5'));
        });

        test('should handle single file correctly', () => {
            const range = createTestRange({
                files: [{ path: 'test.ts', status: 'modified', additions: 10, deletions: 5, repositoryRoot: '/repo' }]
            });
            const item = new GitCommitRangeItem(range);
            const desc = item.description as string;
            assert.ok(desc.includes('1 file changed'));
        });

        test('should be collapsed by default', () => {
            const range = createTestRange();
            const item = new GitCommitRangeItem(range);
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });

        test('should have package icon', () => {
            const range = createTestRange();
            const item = new GitCommitRangeItem(range);
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'package');
        });

        test('should store range reference', () => {
            const range = createTestRange();
            const item = new GitCommitRangeItem(range);
            assert.strictEqual(item.range, range);
        });

        test('should have markdown tooltip', () => {
            const range = createTestRange();
            const item = new GitCommitRangeItem(range);
            assert.ok(item.tooltip instanceof vscode.MarkdownString);
            const tooltip = item.tooltip as vscode.MarkdownString;
            assert.ok(tooltip.value.includes('feature/test'));
            assert.ok(tooltip.value.includes('5 ahead'));
            assert.ok(tooltip.value.includes('2'));  // Files changed
            assert.ok(tooltip.value.includes('+60'));
            assert.ok(tooltip.value.includes('-5'));
        });

        test('should handle zero deletions', () => {
            const range = createTestRange({ deletions: 0 });
            const item = new GitCommitRangeItem(range);
            const desc = item.description as string;
            assert.ok(desc.includes('+60'));
        });

        test('should handle zero additions', () => {
            const range = createTestRange({ additions: 0, deletions: 50 });
            const item = new GitCommitRangeItem(range);
            const desc = item.description as string;
            assert.ok(desc.includes('-50'));
        });

        test('should handle no changes', () => {
            const range = createTestRange({ additions: 0, deletions: 0, files: [] });
            const item = new GitCommitRangeItem(range);
            const desc = item.description as string;
            assert.ok(desc.includes('0 files changed'));
            assert.ok(desc.includes('0'));
        });
    });

    // ============================================
    // GitRangeFileItem Tests
    // ============================================
    suite('GitRangeFileItem', () => {
        const createTestRange = (): GitCommitRange => ({
            baseRef: 'origin/main',
            headRef: 'HEAD',
            commitCount: 5,
            files: [],
            additions: 100,
            deletions: 50,
            mergeBase: 'abc123def456789',
            branchName: 'feature/test',
            repositoryRoot: '/repo',
            repositoryName: 'repo'
        });

        const createTestFile = (overrides?: Partial<GitCommitRangeFile>): GitCommitRangeFile => ({
            path: 'src/components/Button.tsx',
            status: 'modified',
            additions: 25,
            deletions: 10,
            repositoryRoot: '/repo',
            ...overrides
        });

        test('should create item with filename as label', () => {
            const file = createTestFile();
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            assert.strictEqual(item.label, 'Button.tsx');
        });

        test('should have correct context value for regular file', () => {
            const file = createTestFile();
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            assert.strictEqual(item.contextValue, 'gitRangeFile');
        });

        test('should have _md suffix for markdown files', () => {
            const file = createTestFile({ path: 'docs/README.md' });
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            assert.strictEqual(item.contextValue, 'gitRangeFile_md');
        });

        test('should show status in description', () => {
            const file = createTestFile({ status: 'modified' });
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            const desc = item.description as string;
            assert.ok(desc.includes('M'));
        });

        test('should show directory path in description', () => {
            const file = createTestFile({ path: 'src/components/Button.tsx' });
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            const desc = item.description as string;
            assert.ok(desc.includes('src/components'));
        });

        test('should show original path for renames', () => {
            const file = createTestFile({
                path: 'src/new-name.ts',
                status: 'renamed',
                oldPath: 'src/old-name.ts'
            });
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            const desc = item.description as string;
            assert.ok(desc.includes('old-name.ts'));
            assert.ok(desc.includes('\u2190')); // left arrow
        });

        test('should show line changes in description', () => {
            const file = createTestFile({ additions: 25, deletions: 10 });
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            const desc = item.description as string;
            assert.ok(desc.includes('+25'));
            assert.ok(desc.includes('-10'));
        });

        test('should not be collapsible', () => {
            const file = createTestFile();
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
        });

        test('should have resourceUri for file icon', () => {
            const file = createTestFile({ path: 'src/test.ts' });
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            assert.ok(item.resourceUri);
            assert.ok(item.resourceUri?.fsPath.endsWith('test.ts'));
        });

        test('should have command to open diff review', () => {
            const file = createTestFile();
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            assert.ok(item.command);
            assert.strictEqual(item.command?.command, 'gitDiffComments.openWithReview');
        });

        test('should have markdown tooltip', () => {
            const file = createTestFile();
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            assert.ok(item.tooltip instanceof vscode.MarkdownString);
            const tooltip = item.tooltip as vscode.MarkdownString;
            assert.ok(tooltip.value.includes('Button.tsx'));
            assert.ok(tooltip.value.includes('modified'));
            assert.ok(tooltip.value.includes('+25'));
            assert.ok(tooltip.value.includes('-10'));
        });

        test('should store file and range references', () => {
            const file = createTestFile();
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            assert.strictEqual(item.file, file);
            assert.strictEqual(item.range, range);
        });

        test('should provide commitFile for diff review compatibility', () => {
            const file = createTestFile();
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            const commitFile = item.commitFile;
            
            assert.strictEqual(commitFile.path, file.path);
            assert.strictEqual(commitFile.status, file.status);
            assert.strictEqual(commitFile.commitHash, range.headRef);
            assert.strictEqual(commitFile.parentHash, range.baseRef);
            assert.strictEqual(commitFile.isRangeFile, true);
            assert.strictEqual(commitFile.range, range);
        });

        test('should handle files in root directory', () => {
            const file = createTestFile({ path: 'README.md' });
            const range = createTestRange();
            const item = new GitRangeFileItem(file, range);
            const desc = item.description as string;
            // Should not include directory path separator
            assert.ok(!desc.includes('\u2022 .'));
        });

        test('should handle all status types', () => {
            const statuses: Array<{ status: GitChangeStatus; short: string }> = [
                { status: 'modified', short: 'M' },
                { status: 'added', short: 'A' },
                { status: 'deleted', short: 'D' },
                { status: 'renamed', short: 'R' },
                { status: 'copied', short: 'C' }
            ];

            statuses.forEach(({ status, short }) => {
                const file = createTestFile({ status });
                const range = createTestRange();
                const item = new GitRangeFileItem(file, range);
                const desc = item.description as string;
                assert.ok(desc.includes(short), `Status ${status} should show ${short}`);
            });
        });
    });

    // ============================================
    // GitRangeService Tests (Unit Tests)
    // ============================================
    suite('GitRangeService', () => {
        let service: GitRangeService;

        setup(() => {
            service = new GitRangeService();
        });

        teardown(() => {
            service.dispose();
        });

        test('should create service instance', () => {
            assert.ok(service);
        });

        test('should dispose without error', () => {
            assert.doesNotThrow(() => {
                service.dispose();
            });
        });

        test('should invalidate cache without error', () => {
            assert.doesNotThrow(() => {
                service.invalidateCache();
            });
        });

        test('should invalidate specific repo cache without error', () => {
            assert.doesNotThrow(() => {
                service.invalidateCache('/some/repo');
            });
        });

        // Note: The following tests require a real git repository
        // They are skipped in CI but can be run locally
        suite('Git Repository Operations (requires git repo)', function() {
            // These tests require a real git repository
            // They will be skipped if not in a git repo

            test('should handle non-existent repository gracefully', () => {
                const branch = service.getCurrentBranch('/non/existent/path');
                // Should return 'HEAD' as fallback
                assert.strictEqual(branch, 'HEAD');
            });

            test('should return null for non-existent repo default branch', () => {
                const defaultBranch = service.getDefaultRemoteBranch('/non/existent/path');
                assert.strictEqual(defaultBranch, null);
            });

            test('should return null for non-existent repo merge base', () => {
                const mergeBase = service.getMergeBase('/non/existent/path', 'HEAD', 'origin/main');
                assert.strictEqual(mergeBase, null);
            });

            test('should return 0 for non-existent repo commit count', () => {
                const count = service.countCommitsAhead('/non/existent/path', 'origin/main', 'HEAD');
                assert.strictEqual(count, 0);
            });

            test('should return empty array for non-existent repo changed files', () => {
                const files = service.getChangedFiles('/non/existent/path', 'origin/main', 'HEAD');
                assert.deepStrictEqual(files, []);
            });

            test('should return zero stats for non-existent repo', () => {
                const stats = service.getDiffStats('/non/existent/path', 'origin/main', 'HEAD');
                assert.strictEqual(stats.additions, 0);
                assert.strictEqual(stats.deletions, 0);
            });

            test('should return null for non-existent repo commit range', () => {
                const range = service.detectCommitRange('/non/existent/path');
                assert.strictEqual(range, null);
            });

            test('should return empty string for non-existent repo file diff', () => {
                const diff = service.getFileDiff('/non/existent/path', 'origin/main', 'HEAD', 'test.ts');
                assert.strictEqual(diff, '');
            });

            test('should return empty string for non-existent repo file at ref', () => {
                const content = service.getFileAtRef('/non/existent/path', 'HEAD', 'test.ts');
                assert.strictEqual(content, '');
            });

            test('should return empty string for non-existent repo range diff', () => {
                const diff = service.getRangeDiff('/non/existent/path', 'origin/main', 'HEAD');
                assert.strictEqual(diff, '');
            });
        });
    });

    // ============================================
    // Integration Tests
    // ============================================
    suite('Integration Tests', () => {
        test('should create range item from range and expand to file items', () => {
            const range: GitCommitRange = {
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 3,
                files: [
                    { path: 'src/a.ts', status: 'modified', additions: 10, deletions: 5, repositoryRoot: '/repo' },
                    { path: 'src/b.ts', status: 'added', additions: 50, deletions: 0, repositoryRoot: '/repo' },
                    { path: 'src/c.ts', status: 'deleted', additions: 0, deletions: 30, repositoryRoot: '/repo' }
                ],
                additions: 60,
                deletions: 35,
                mergeBase: 'abc123',
                branchName: 'feature/test',
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };

            const rangeItem = new GitCommitRangeItem(range);
            assert.ok(rangeItem.label?.toString().includes('3 commits'));

            // Create file items from range
            const fileItems = range.files.map(f => new GitRangeFileItem(f, range));
            assert.strictEqual(fileItems.length, 3);
            
            // Verify each file item
            assert.strictEqual(fileItems[0].label, 'a.ts');
            assert.ok((fileItems[0].description as string).includes('M'));
            
            assert.strictEqual(fileItems[1].label, 'b.ts');
            assert.ok((fileItems[1].description as string).includes('A'));
            
            assert.strictEqual(fileItems[2].label, 'c.ts');
            assert.ok((fileItems[2].description as string).includes('D'));
        });

        test('should create section with range item hierarchy', () => {
            const section = new BranchChangesSectionItem(1);
            const range: GitCommitRange = {
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 5,
                files: [
                    { path: 'test.ts', status: 'modified', additions: 10, deletions: 5, repositoryRoot: '/repo' }
                ],
                additions: 10,
                deletions: 5,
                mergeBase: 'abc123',
                branchName: 'feature/test',
                repositoryRoot: '/repo',
                repositoryName: 'repo'
            };
            const rangeItem = new GitCommitRangeItem(range);
            const fileItem = new GitRangeFileItem(range.files[0], range);

            // Verify hierarchy structure
            assert.strictEqual(section.label, 'Branch Changes');
            assert.strictEqual(section.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
            
            assert.ok(rangeItem.label?.toString().includes('feature/test'));
            assert.strictEqual(rangeItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            
            assert.strictEqual(fileItem.label, 'test.ts');
            assert.strictEqual(fileItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
        });
    });
});
