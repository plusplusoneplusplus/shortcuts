/**
 * Tests for Git Branch functionality
 * Covers: BranchItem, BranchService, branch operations
 */

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { BranchItem, BranchStatus } from '../../shortcuts/git/branch-item';
import { BranchService, GitBranch, BranchListOptions, PaginatedBranchResult } from '../../shortcuts/git/branch-service';

suite('Git Branch Tests', () => {

    // ============================================
    // BranchStatus Type Tests
    // ============================================
    suite('BranchStatus Type', () => {
        test('should have correct structure for normal branch', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                trackingBranch: 'origin/main',
                hasUncommittedChanges: false
            };
            assert.strictEqual(status.name, 'main');
            assert.strictEqual(status.isDetached, false);
            assert.strictEqual(status.ahead, 0);
            assert.strictEqual(status.behind, 0);
            assert.strictEqual(status.trackingBranch, 'origin/main');
            assert.strictEqual(status.hasUncommittedChanges, false);
        });

        test('should have correct structure for detached HEAD', () => {
            const status: BranchStatus = {
                name: '',
                isDetached: true,
                detachedHash: 'abc1234567890',
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            assert.strictEqual(status.name, '');
            assert.strictEqual(status.isDetached, true);
            assert.strictEqual(status.detachedHash, 'abc1234567890');
        });

        test('should have correct structure for branch ahead/behind', () => {
            const status: BranchStatus = {
                name: 'feature/test',
                isDetached: false,
                ahead: 3,
                behind: 2,
                trackingBranch: 'origin/feature/test',
                hasUncommittedChanges: true
            };
            assert.strictEqual(status.ahead, 3);
            assert.strictEqual(status.behind, 2);
            assert.strictEqual(status.hasUncommittedChanges, true);
        });

        test('should handle branch without tracking branch', () => {
            const status: BranchStatus = {
                name: 'local-only',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            assert.strictEqual(status.trackingBranch, undefined);
        });
    });

    // ============================================
    // GitBranch Type Tests
    // ============================================
    suite('GitBranch Type', () => {
        test('should have correct structure for local branch', () => {
            const branch: GitBranch = {
                name: 'feature/test',
                isCurrent: false,
                isRemote: false,
                lastCommitSubject: 'Add feature',
                lastCommitDate: '2 hours ago'
            };
            assert.strictEqual(branch.name, 'feature/test');
            assert.strictEqual(branch.isCurrent, false);
            assert.strictEqual(branch.isRemote, false);
            assert.strictEqual(branch.remoteName, undefined);
        });

        test('should have correct structure for current branch', () => {
            const branch: GitBranch = {
                name: 'main',
                isCurrent: true,
                isRemote: false,
                lastCommitSubject: 'Latest commit',
                lastCommitDate: '1 day ago'
            };
            assert.strictEqual(branch.isCurrent, true);
        });

        test('should have correct structure for remote branch', () => {
            const branch: GitBranch = {
                name: 'origin/develop',
                isCurrent: false,
                isRemote: true,
                remoteName: 'origin',
                lastCommitSubject: 'Remote commit',
                lastCommitDate: '3 days ago'
            };
            assert.strictEqual(branch.isRemote, true);
            assert.strictEqual(branch.remoteName, 'origin');
        });
    });

    // ============================================
    // BranchItem Tests
    // ============================================
    suite('BranchItem', () => {
        test('should create item for normal branch', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                trackingBranch: 'origin/main',
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            
            assert.strictEqual(item.label, 'main');
            assert.strictEqual(item.contextValue, 'gitBranch');
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
            assert.strictEqual(item.description, ''); // No ahead/behind
        });

        test('should display ahead count', () => {
            const status: BranchStatus = {
                name: 'feature',
                isDetached: false,
                ahead: 3,
                behind: 0,
                trackingBranch: 'origin/feature',
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            
            assert.strictEqual(item.description, '↑3');
        });

        test('should display behind count', () => {
            const status: BranchStatus = {
                name: 'feature',
                isDetached: false,
                ahead: 0,
                behind: 2,
                trackingBranch: 'origin/feature',
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            
            assert.strictEqual(item.description, '↓2');
        });

        test('should display both ahead and behind counts', () => {
            const status: BranchStatus = {
                name: 'feature',
                isDetached: false,
                ahead: 3,
                behind: 2,
                trackingBranch: 'origin/feature',
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            
            assert.strictEqual(item.description, '↑3 ↓2');
        });

        test('should create item for detached HEAD', () => {
            const status: BranchStatus = {
                name: '',
                isDetached: true,
                detachedHash: 'abc1234567890def',
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            
            // Should show shortened hash
            assert.strictEqual(item.label, '(detached) abc1234');
        });

        test('should have click command for branch switching', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            
            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'gitView.switchBranch');
        });

        test('should have icon', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            
            assert.ok(item.iconPath);
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'git-branch');
        });

        test('should have different icon color for uncommitted changes', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: true
            };
            const item = new BranchItem(status);
            
            assert.ok(item.iconPath);
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            // Icon should have a color for uncommitted changes
            assert.ok((item.iconPath as vscode.ThemeIcon).color);
        });

        test('should have markdown tooltip', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                trackingBranch: 'origin/main',
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            
            assert.ok(item.tooltip);
            assert.ok(item.tooltip instanceof vscode.MarkdownString);
        });

        test('should store status in item', () => {
            const status: BranchStatus = {
                name: 'feature/test',
                isDetached: false,
                ahead: 1,
                behind: 2,
                trackingBranch: 'origin/feature/test',
                hasUncommittedChanges: true
            };
            const item = new BranchItem(status);
            
            assert.deepStrictEqual(item.status, status);
        });
    });

    // ============================================
    // BranchService Unit Tests
    // ============================================
    suite('BranchService', () => {
        let branchService: BranchService;

        setup(() => {
            branchService = new BranchService();
        });

        teardown(() => {
            branchService.dispose();
        });

        test('should be instantiable', () => {
            assert.ok(branchService);
        });

        test('should have dispose method', () => {
            assert.ok(typeof branchService.dispose === 'function');
        });

        // Note: The following tests require a real git repository and are integration tests
        // They are included here but may be skipped in environments without git

        suite('Integration Tests (require git repository)', () => {
            // These tests are marked as integration tests
            // They will only pass when run in a real git repository

            test('getBranchStatus returns null for non-existent path', () => {
                const result = branchService.getBranchStatus('/non/existent/path', false);
                assert.strictEqual(result, null);
            });

            test('getLocalBranches returns empty array for non-existent path', () => {
                const result = branchService.getLocalBranches('/non/existent/path');
                assert.deepStrictEqual(result, []);
            });

            test('getRemoteBranches returns empty array for non-existent path', () => {
                const result = branchService.getRemoteBranches('/non/existent/path');
                assert.deepStrictEqual(result, []);
            });

            test('getAllBranches returns empty arrays for non-existent path', () => {
                const result = branchService.getAllBranches('/non/existent/path');
                assert.deepStrictEqual(result.local, []);
                assert.deepStrictEqual(result.remote, []);
            });

            test('hasUncommittedChanges returns false for non-existent path', () => {
                const result = branchService.hasUncommittedChanges('/non/existent/path');
                assert.strictEqual(result, false);
            });

            test('switchBranch returns error for non-existent path', async () => {
                const result = await branchService.switchBranch('/non/existent/path', 'main');
                assert.strictEqual(result.success, false);
                assert.ok(result.error);
            });

            test('createBranch returns error for non-existent path', async () => {
                const result = await branchService.createBranch('/non/existent/path', 'test-branch');
                assert.strictEqual(result.success, false);
                assert.ok(result.error);
            });

            test('deleteBranch returns error for non-existent path', async () => {
                const result = await branchService.deleteBranch('/non/existent/path', 'test-branch');
                assert.strictEqual(result.success, false);
                assert.ok(result.error);
            });

            test('stashChanges returns error for non-existent path', async () => {
                const result = await branchService.stashChanges('/non/existent/path');
                assert.strictEqual(result.success, false);
                assert.ok(result.error);
            });

            test('popStash returns error for non-existent path', async () => {
                const result = await branchService.popStash('/non/existent/path');
                assert.strictEqual(result.success, false);
                assert.ok(result.error);
            });

            test('fetch returns error for non-existent path', async () => {
                const result = await branchService.fetch('/non/existent/path');
                assert.strictEqual(result.success, false);
                assert.ok(result.error);
            });

            test('pull returns error for non-existent path', async () => {
                const result = await branchService.pull('/non/existent/path');
                assert.strictEqual(result.success, false);
                assert.ok(result.error);
            });

            test('pull with rebase returns error for non-existent path', async () => {
                const result = await branchService.pull('/non/existent/path', true);
                assert.strictEqual(result.success, false);
                assert.ok(result.error);
            });

            test('push returns error for non-existent path', async () => {
                const result = await branchService.push('/non/existent/path');
                assert.strictEqual(result.success, false);
                assert.ok(result.error);
            });

            test('renameBranch returns error for non-existent path', async () => {
                const result = await branchService.renameBranch('/non/existent/path', 'old', 'new');
                assert.strictEqual(result.success, false);
                assert.ok(result.error);
            });

            test('mergeBranch returns error for non-existent path', async () => {
                const result = await branchService.mergeBranch('/non/existent/path', 'feature');
                assert.strictEqual(result.success, false);
                assert.ok(result.error);
            });
        });
    });

    // ============================================
    // Cross-Platform Path Tests
    // ============================================
    suite('Cross-Platform Compatibility', () => {
        test('BranchStatus should handle paths with spaces', () => {
            const status: BranchStatus = {
                name: 'feature/path with spaces',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            assert.strictEqual(item.label, 'feature/path with spaces');
        });

        test('BranchStatus should handle unicode branch names', () => {
            const status: BranchStatus = {
                name: 'feature/日本語',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            assert.strictEqual(item.label, 'feature/日本語');
        });

        test('GitBranch should handle long branch names', () => {
            const longName = 'feature/' + 'a'.repeat(200);
            const branch: GitBranch = {
                name: longName,
                isCurrent: false,
                isRemote: false
            };
            assert.strictEqual(branch.name.length, 208);
        });

        test('BranchItem handles hash truncation correctly', () => {
            // Test various hash lengths
            const shortHash = 'abc';
            const status: BranchStatus = {
                name: '',
                isDetached: true,
                detachedHash: shortHash,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            // Short hash should be used as-is (truncation to 7 chars)
            const labelStr = typeof item.label === 'string' ? item.label : item.label?.label || '';
            assert.ok(labelStr.includes(shortHash));
        });
    });

    // ============================================
    // Edge Cases
    // ============================================
    suite('Edge Cases', () => {
        test('BranchItem with empty branch name (for detached)', () => {
            const status: BranchStatus = {
                name: '',
                isDetached: true,
                detachedHash: 'abc1234',
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            assert.ok(item.label);
            const labelStr = typeof item.label === 'string' ? item.label : item.label?.label || '';
            assert.ok(labelStr.includes('detached'));
        });

        test('BranchItem with zero ahead and behind', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            assert.strictEqual(item.description, '');
        });

        test('BranchItem with large ahead/behind counts', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 999,
                behind: 888,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            assert.strictEqual(item.description, '↑999 ↓888');
        });

        test('GitBranch with empty commit info', () => {
            const branch: GitBranch = {
                name: 'empty-branch',
                isCurrent: false,
                isRemote: false,
                lastCommitSubject: '',
                lastCommitDate: ''
            };
            assert.strictEqual(branch.lastCommitSubject, '');
            assert.strictEqual(branch.lastCommitDate, '');
        });
    });

    // ============================================
    // Tooltip Tests
    // ============================================
    suite('BranchItem Tooltip', () => {
        test('should mention branch name in tooltip', () => {
            const status: BranchStatus = {
                name: 'feature/test',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            const tooltip = item.tooltip as vscode.MarkdownString;
            
            assert.ok(tooltip.value.includes('feature/test'));
        });

        test('should mention tracking branch in tooltip', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                trackingBranch: 'origin/main',
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            const tooltip = item.tooltip as vscode.MarkdownString;
            
            assert.ok(tooltip.value.includes('origin/main'));
        });

        test('should mention uncommitted changes in tooltip', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: true
            };
            const item = new BranchItem(status);
            const tooltip = item.tooltip as vscode.MarkdownString;
            
            assert.ok(tooltip.value.toLowerCase().includes('uncommitted'));
        });

        test('should mention detached HEAD in tooltip', () => {
            const status: BranchStatus = {
                name: '',
                isDetached: true,
                detachedHash: 'abc1234',
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            const tooltip = item.tooltip as vscode.MarkdownString;
            
            assert.ok(tooltip.value.toLowerCase().includes('detached'));
        });

        test('should mention ahead/behind counts in tooltip', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 3,
                behind: 2,
                trackingBranch: 'origin/main',
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            const tooltip = item.tooltip as vscode.MarkdownString;
            
            assert.ok(tooltip.value.includes('3'));
            assert.ok(tooltip.value.includes('2'));
        });
    });

    // ============================================
    // Icon Color Tests
    // ============================================
    suite('BranchItem Icon Colors', () => {
        test('normal branch has default icon', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            const icon = item.iconPath as vscode.ThemeIcon;

            // No special color for normal branch
            assert.strictEqual(icon.color, undefined);
        });

        test('branch with uncommitted changes has warning color', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: true
            };
            const item = new BranchItem(status);
            const icon = item.iconPath as vscode.ThemeIcon;

            // Should have modified color
            assert.ok(icon.color);
        });

        test('branch ahead/behind has different color', () => {
            const status: BranchStatus = {
                name: 'main',
                isDetached: false,
                ahead: 1,
                behind: 0,
                hasUncommittedChanges: false
            };
            const item = new BranchItem(status);
            const icon = item.iconPath as vscode.ThemeIcon;

            // Should have added color
            assert.ok(icon.color);
        });
    });

    // ============================================
    // Pagination Types Tests
    // ============================================
    suite('Branch Pagination Types', () => {
        test('BranchListOptions should have correct structure', () => {
            const options: BranchListOptions = {
                limit: 100,
                offset: 0,
                searchPattern: 'feature'
            };
            assert.strictEqual(options.limit, 100);
            assert.strictEqual(options.offset, 0);
            assert.strictEqual(options.searchPattern, 'feature');
        });

        test('BranchListOptions should allow partial options', () => {
            const options: BranchListOptions = {
                limit: 50
            };
            assert.strictEqual(options.limit, 50);
            assert.strictEqual(options.offset, undefined);
            assert.strictEqual(options.searchPattern, undefined);
        });

        test('BranchListOptions should allow empty options', () => {
            const options: BranchListOptions = {};
            assert.strictEqual(options.limit, undefined);
            assert.strictEqual(options.offset, undefined);
            assert.strictEqual(options.searchPattern, undefined);
        });

        test('PaginatedBranchResult should have correct structure', () => {
            const result: PaginatedBranchResult = {
                branches: [
                    { name: 'main', isCurrent: true, isRemote: false },
                    { name: 'develop', isCurrent: false, isRemote: false }
                ],
                totalCount: 100,
                hasMore: true
            };
            assert.strictEqual(result.branches.length, 2);
            assert.strictEqual(result.totalCount, 100);
            assert.strictEqual(result.hasMore, true);
        });

        test('PaginatedBranchResult should handle empty results', () => {
            const result: PaginatedBranchResult = {
                branches: [],
                totalCount: 0,
                hasMore: false
            };
            assert.strictEqual(result.branches.length, 0);
            assert.strictEqual(result.totalCount, 0);
            assert.strictEqual(result.hasMore, false);
        });

        test('PaginatedBranchResult should handle last page', () => {
            const result: PaginatedBranchResult = {
                branches: [
                    { name: 'feature-1', isCurrent: false, isRemote: false }
                ],
                totalCount: 101,
                hasMore: false
            };
            assert.strictEqual(result.branches.length, 1);
            assert.strictEqual(result.totalCount, 101);
            assert.strictEqual(result.hasMore, false);
        });
    });

    // ============================================
    // Paginated Branch Service Tests
    // ============================================
    suite('BranchService Pagination', () => {
        let branchService: BranchService;

        setup(() => {
            branchService = new BranchService();
        });

        teardown(() => {
            branchService.dispose();
        });

        test('getLocalBranchCount returns 0 for non-existent path', () => {
            const result = branchService.getLocalBranchCount('/non/existent/path');
            assert.strictEqual(result, 0);
        });

        test('getLocalBranchCount with search pattern returns 0 for non-existent path', () => {
            const result = branchService.getLocalBranchCount('/non/existent/path', 'feature');
            assert.strictEqual(result, 0);
        });

        test('getRemoteBranchCount returns 0 for non-existent path', () => {
            const result = branchService.getRemoteBranchCount('/non/existent/path');
            assert.strictEqual(result, 0);
        });

        test('getRemoteBranchCount with search pattern returns 0 for non-existent path', () => {
            const result = branchService.getRemoteBranchCount('/non/existent/path', 'origin');
            assert.strictEqual(result, 0);
        });

        test('getLocalBranchesPaginated returns empty result for non-existent path', () => {
            const result = branchService.getLocalBranchesPaginated('/non/existent/path');
            assert.deepStrictEqual(result.branches, []);
            assert.strictEqual(result.totalCount, 0);
            assert.strictEqual(result.hasMore, false);
        });

        test('getLocalBranchesPaginated with options returns empty result for non-existent path', () => {
            const result = branchService.getLocalBranchesPaginated('/non/existent/path', {
                limit: 50,
                offset: 10,
                searchPattern: 'feature'
            });
            assert.deepStrictEqual(result.branches, []);
            assert.strictEqual(result.totalCount, 0);
            assert.strictEqual(result.hasMore, false);
        });

        test('getRemoteBranchesPaginated returns empty result for non-existent path', () => {
            const result = branchService.getRemoteBranchesPaginated('/non/existent/path');
            assert.deepStrictEqual(result.branches, []);
            assert.strictEqual(result.totalCount, 0);
            assert.strictEqual(result.hasMore, false);
        });

        test('getRemoteBranchesPaginated with options returns empty result for non-existent path', () => {
            const result = branchService.getRemoteBranchesPaginated('/non/existent/path', {
                limit: 50,
                offset: 10,
                searchPattern: 'origin'
            });
            assert.deepStrictEqual(result.branches, []);
            assert.strictEqual(result.totalCount, 0);
            assert.strictEqual(result.hasMore, false);
        });

        test('searchBranches returns empty results for non-existent path', () => {
            const result = branchService.searchBranches('/non/existent/path', 'feature');
            assert.deepStrictEqual(result.local, []);
            assert.deepStrictEqual(result.remote, []);
        });

        test('searchBranches with limit returns empty results for non-existent path', () => {
            const result = branchService.searchBranches('/non/existent/path', 'feature', 10);
            assert.deepStrictEqual(result.local, []);
            assert.deepStrictEqual(result.remote, []);
        });
    });

    // ============================================
    // Pagination Integration Tests
    // ============================================
    suite('BranchService Pagination Integration (require git repository)', () => {
        let branchService: BranchService;
        const testRepoPath = process.cwd(); // Use current directory as test repo

        setup(() => {
            branchService = new BranchService();
        });

        teardown(() => {
            branchService.dispose();
        });

        test('getLocalBranchCount returns a number for valid repo', () => {
            const result = branchService.getLocalBranchCount(testRepoPath);
            assert.ok(typeof result === 'number');
            assert.ok(result >= 0);
        });

        test('getRemoteBranchCount returns a number for valid repo', () => {
            const result = branchService.getRemoteBranchCount(testRepoPath);
            assert.ok(typeof result === 'number');
            assert.ok(result >= 0);
        });

        test('getLocalBranchesPaginated returns valid structure for valid repo', () => {
            const result = branchService.getLocalBranchesPaginated(testRepoPath);
            assert.ok(Array.isArray(result.branches));
            assert.ok(typeof result.totalCount === 'number');
            assert.ok(typeof result.hasMore === 'boolean');
        });

        test('getLocalBranchesPaginated respects limit option', () => {
            const result = branchService.getLocalBranchesPaginated(testRepoPath, { limit: 1 });
            assert.ok(result.branches.length <= 1);
        });

        test('getLocalBranchesPaginated with search filters results', () => {
            // Search for a pattern that likely doesn't exist
            const result = branchService.getLocalBranchesPaginated(testRepoPath, {
                searchPattern: 'zzzzznonexistent12345'
            });
            assert.strictEqual(result.branches.length, 0);
        });

        test('getRemoteBranchesPaginated returns valid structure for valid repo', () => {
            const result = branchService.getRemoteBranchesPaginated(testRepoPath);
            assert.ok(Array.isArray(result.branches));
            assert.ok(typeof result.totalCount === 'number');
            assert.ok(typeof result.hasMore === 'boolean');
        });

        test('getRemoteBranchesPaginated respects limit option', () => {
            const result = branchService.getRemoteBranchesPaginated(testRepoPath, { limit: 1 });
            assert.ok(result.branches.length <= 1);
        });

        test('searchBranches returns valid structure for valid repo', () => {
            const result = branchService.searchBranches(testRepoPath, 'main');
            assert.ok(Array.isArray(result.local));
            assert.ok(Array.isArray(result.remote));
        });

        test('hasMore is false when branches count equals total', () => {
            const result = branchService.getLocalBranchesPaginated(testRepoPath, { limit: 1000 });
            if (result.branches.length === result.totalCount) {
                assert.strictEqual(result.hasMore, false);
            }
        });

        test('paginated branches have expected properties', () => {
            const result = branchService.getLocalBranchesPaginated(testRepoPath, { limit: 5 });
            for (const branch of result.branches) {
                assert.ok(typeof branch.name === 'string');
                assert.ok(typeof branch.isCurrent === 'boolean');
                assert.ok(typeof branch.isRemote === 'boolean');
            }
        });

        test('remote paginated branches have expected structure', () => {
            const result = branchService.getRemoteBranchesPaginated(testRepoPath, { limit: 5 });
            for (const branch of result.branches) {
                // Remote branches should be marked as remote
                assert.ok(branch.isRemote, `Branch ${branch.name} should be marked as remote`);
                // Branch should have a name
                assert.ok(typeof branch.name === 'string', 'Branch should have a string name');
            }
        });
    });

    // ============================================
    // Search Pattern Edge Cases
    // ============================================
    suite('Search Pattern Edge Cases', () => {
        let branchService: BranchService;

        setup(() => {
            branchService = new BranchService();
        });

        teardown(() => {
            branchService.dispose();
        });

        test('search with empty pattern returns all branches', () => {
            const allResult = branchService.getLocalBranchesPaginated(process.cwd());
            const emptySearchResult = branchService.getLocalBranchesPaginated(process.cwd(), {
                searchPattern: ''
            });
            assert.strictEqual(allResult.totalCount, emptySearchResult.totalCount);
        });

        test('search is case-insensitive', () => {
            // First check if there's a 'main' branch
            const allBranches = branchService.getLocalBranchesPaginated(process.cwd());
            const hasMainBranch = allBranches.branches.some(b =>
                b.name.toLowerCase().includes('main')
            );

            if (hasMainBranch) {
                const upperResult = branchService.getLocalBranchesPaginated(process.cwd(), {
                    searchPattern: 'MAIN'
                });
                const lowerResult = branchService.getLocalBranchesPaginated(process.cwd(), {
                    searchPattern: 'main'
                });
                // Both should find the same branches (case-insensitive)
                assert.strictEqual(upperResult.totalCount, lowerResult.totalCount,
                    'Case-insensitive search should return same count for MAIN and main');
            }
            // Test passes if no main branch (nothing to compare)
        });

        test('search handles special regex characters safely', () => {
            // These should not throw errors
            const patterns = ['feature.*', 'test[1]', 'branch(1)', 'path/to/branch'];
            for (const pattern of patterns) {
                const result = branchService.getLocalBranchesPaginated(process.cwd(), {
                    searchPattern: pattern
                });
                assert.ok(typeof result.totalCount === 'number');
            }
        });
    });
});
