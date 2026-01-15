/**
 * Tests for Git Branch functionality
 * Covers: BranchItem, BranchService, branch operations
 */

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { BranchItem, BranchStatus } from '../../shortcuts/git/branch-item';
import { BranchService, GitBranch } from '../../shortcuts/git/branch-service';

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
});
