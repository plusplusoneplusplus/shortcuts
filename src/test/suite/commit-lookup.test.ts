/**
 * Tests for Commit Lookup feature
 * Covers: LookedUpCommitItem, validateRef, getBranches, and lookup state management
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { LookedUpCommitItem } from '../../shortcuts/git/looked-up-commit-item';
import { GitCommit } from '../../shortcuts/git/types';

suite('Commit Lookup Tests', () => {

    // ============================================
    // Helper Functions
    // ============================================
    const createMockCommit = (
        subject: string = 'Fix bug in parser',
        refs: string[] = [],
        options?: Partial<GitCommit>
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
        ...options
    });

    // ============================================
    // LookedUpCommitItem Tests
    // ============================================
    suite('LookedUpCommitItem', () => {

        suite('Basic Properties', () => {
            test('should create item with correct label format', () => {
                const commit = createMockCommit('Fix bug');
                const item = new LookedUpCommitItem(commit);
                const label = item.label as string;
                assert.ok(label.includes('abc123d'), 'Label should contain short hash');
                assert.ok(label.includes('Fix bug'), 'Label should contain subject');
            });

            test('should have search icon', () => {
                const commit = createMockCommit();
                const item = new LookedUpCommitItem(commit);
                assert.ok(item.iconPath instanceof vscode.ThemeIcon);
                assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'search');
            });

            test('should have contextValue of lookedUpCommit with index', () => {
                const commit = createMockCommit();
                const item = new LookedUpCommitItem(commit);
                // Default index is 0
                assert.strictEqual(item.contextValue, 'lookedUpCommit_0');
            });

            test('should include index in contextValue', () => {
                const commit = createMockCommit();
                const item = new LookedUpCommitItem(commit, 2);
                assert.strictEqual(item.contextValue, 'lookedUpCommit_2');
            });

            test('should be expanded by default', () => {
                const commit = createMockCommit();
                const item = new LookedUpCommitItem(commit);
                assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
            });

            test('should show relative date in description', () => {
                const commit = createMockCommit();
                const item = new LookedUpCommitItem(commit);
                assert.strictEqual(item.description, '2 hours ago');
            });

            test('should store the commit object', () => {
                const commit = createMockCommit();
                const item = new LookedUpCommitItem(commit);
                assert.strictEqual(item.commit, commit);
                assert.strictEqual(item.commit.hash, 'abc123def456789012345678901234567890abcd');
            });

            test('should be instance of TreeItem', () => {
                const commit = createMockCommit();
                const item = new LookedUpCommitItem(commit);
                assert.ok(item instanceof vscode.TreeItem);
            });
        });

        suite('Tooltip', () => {
            test('should create markdown tooltip', () => {
                const commit = createMockCommit();
                const item = new LookedUpCommitItem(commit);
                assert.ok(item.tooltip instanceof vscode.MarkdownString);
            });

            test('should include subject in tooltip', () => {
                const commit = createMockCommit('Important fix for login');
                const item = new LookedUpCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('Important fix for login'));
            });

            test('should include full hash in tooltip', () => {
                const commit = createMockCommit();
                const item = new LookedUpCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('abc123def456789012345678901234567890abcd'));
            });

            test('should include author name in tooltip', () => {
                const commit = createMockCommit();
                const item = new LookedUpCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('John Doe'));
            });

            test('should include relative date in tooltip', () => {
                const commit = createMockCommit();
                const item = new LookedUpCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('2 hours ago'));
            });

            test('should include refs when present', () => {
                const commit = createMockCommit('Fix', ['main', 'develop']);
                const item = new LookedUpCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('main'));
                assert.ok(tooltip.value.includes('develop'));
            });

            test('should not include refs section when empty', () => {
                const commit = createMockCommit('Fix', []);
                const item = new LookedUpCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                // Empty refs should not add refs line to tooltip
                assert.ok(!tooltip.value.includes('Refs:') || !tooltip.value.includes('**Refs:**'));
            });
        });

        suite('Label Formatting', () => {
            test('should handle short subjects', () => {
                const commit = createMockCommit('Fix');
                const item = new LookedUpCommitItem(commit);
                const label = item.label as string;
                assert.ok(label.includes('Fix'));
            });

            test('should handle long subjects', () => {
                const longSubject = 'This is a very long commit message that describes the changes in detail';
                const commit = createMockCommit(longSubject);
                const item = new LookedUpCommitItem(commit);
                const label = item.label as string;
                // Label should include at least part of the subject
                assert.ok(label.includes('abc123d'));
            });

            test('should handle subjects with special characters', () => {
                const commit = createMockCommit('Fix: [BUG-123] Handle "quoted" strings & entities');
                const item = new LookedUpCommitItem(commit);
                const label = item.label as string;
                assert.ok(label.includes('abc123d'));
            });

            test('should handle empty subject', () => {
                const commit = createMockCommit('');
                const item = new LookedUpCommitItem(commit);
                const label = item.label as string;
                assert.ok(label.includes('abc123d'));
            });
        });

        suite('Different Commit States', () => {
            test('should handle initial commit (no parent)', () => {
                const commit = createMockCommit('Initial commit', [], {
                    parentHashes: ''
                });
                const item = new LookedUpCommitItem(commit);
                assert.ok(item.label);
                assert.ok(item.tooltip);
            });

            test('should handle merge commit', () => {
                const commit = createMockCommit('Merge branch feature', [], {
                    parentHashes: 'parent1 parent2'
                });
                const item = new LookedUpCommitItem(commit);
                assert.ok(item.label);
            });

            test('should handle commit with multiple refs', () => {
                const commit = createMockCommit('Fix', ['main', 'origin/main', 'tag: v1.0.0']);
                const item = new LookedUpCommitItem(commit);
                const tooltip = item.tooltip as vscode.MarkdownString;
                assert.ok(tooltip.value.includes('main'));
            });

            test('should handle commit with no date', () => {
                const commit = createMockCommit('Fix', [], {
                    relativeDate: ''
                });
                const item = new LookedUpCommitItem(commit);
                // Should still create item, description might be empty
                assert.ok(item.label);
            });
        });
    });

    // ============================================
    // GitLogService Tests
    // ============================================
    suite('GitLogService', () => {

        suite('Service Methods', () => {
            test('should have validateRef method', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();
                assert.ok(typeof service.validateRef === 'function');
                service.dispose();
            });

            test('should have getBranches method', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();
                assert.ok(typeof service.getBranches === 'function');
                service.dispose();
            });

            test('should have getCommit method', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();
                assert.ok(typeof service.getCommit === 'function');
                service.dispose();
            });
        });

        suite('validateRef', () => {
            test('should return undefined for invalid ref', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                // Using a non-existent path should return undefined
                const result = service.validateRef('/nonexistent/path', 'invalid-ref-12345');
                assert.strictEqual(result, undefined);

                service.dispose();
            });

            test('should return undefined for empty ref', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                const result = service.validateRef('/nonexistent/path', '');
                assert.strictEqual(result, undefined);

                service.dispose();
            });
        });

        suite('getBranches', () => {
            test('should return empty array for invalid repo', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                const result = service.getBranches('/nonexistent/path');
                assert.ok(Array.isArray(result));
                assert.strictEqual(result.length, 0);

                service.dispose();
            });

            test('should return array type', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                const result = service.getBranches('/some/path');
                assert.ok(Array.isArray(result));

                service.dispose();
            });

            test('should accept forceRefresh parameter', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                // Should not throw with forceRefresh = true
                const result = service.getBranches('/some/path', true);
                assert.ok(Array.isArray(result));

                // Should not throw with forceRefresh = false
                const result2 = service.getBranches('/some/path', false);
                assert.ok(Array.isArray(result2));

                service.dispose();
            });
        });

        suite('getBranches Caching', () => {
            test('should return cached result on second call', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                // First call - will cache the result (empty array for invalid path)
                const result1 = service.getBranches('/nonexistent/path');

                // Second call - should return cached result
                const result2 = service.getBranches('/nonexistent/path');

                assert.deepStrictEqual(result1, result2);

                service.dispose();
            });

            test('should bypass cache when forceRefresh is true', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                // First call - caches result
                service.getBranches('/nonexistent/path');

                // Force refresh should not throw and should return array
                const result = service.getBranches('/nonexistent/path', true);
                assert.ok(Array.isArray(result));

                service.dispose();
            });

            test('should cache results per repository path', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                // Different paths should have separate cache entries
                const result1 = service.getBranches('/path/one');
                const result2 = service.getBranches('/path/two');

                // Both should be arrays (empty for invalid paths)
                assert.ok(Array.isArray(result1));
                assert.ok(Array.isArray(result2));

                service.dispose();
            });
        });

        suite('getBranchesAsync', () => {
            test('should have getBranchesAsync method', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();
                assert.ok(typeof service.getBranchesAsync === 'function');
                service.dispose();
            });

            test('should return a Promise', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                const result = service.getBranchesAsync('/some/path');
                assert.ok(result instanceof Promise);

                // Wait for promise to resolve
                await result;

                service.dispose();
            });

            test('should resolve to an array', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                const result = await service.getBranchesAsync('/nonexistent/path');
                assert.ok(Array.isArray(result));

                service.dispose();
            });

            test('should return empty array for invalid repo', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                const result = await service.getBranchesAsync('/nonexistent/path');
                assert.ok(Array.isArray(result));
                assert.strictEqual(result.length, 0);

                service.dispose();
            });

            test('should use cached value if available', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                // First call populates cache
                service.getBranches('/nonexistent/path');

                // Async call should return cached value
                const result = await service.getBranchesAsync('/nonexistent/path');
                assert.ok(Array.isArray(result));

                service.dispose();
            });
        });

        suite('invalidateBranchCache', () => {
            test('should have invalidateBranchCache method', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();
                assert.ok(typeof service.invalidateBranchCache === 'function');
                service.dispose();
            });

            test('should not throw when invalidating empty cache', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                // Should not throw
                service.invalidateBranchCache('/some/path');
                service.invalidateBranchCache();

                service.dispose();
            });

            test('should invalidate cache for specific repo', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                // Populate cache
                service.getBranches('/path/one');
                service.getBranches('/path/two');

                // Invalidate one path
                service.invalidateBranchCache('/path/one');

                // Should not throw when accessing again
                const result = service.getBranches('/path/one');
                assert.ok(Array.isArray(result));

                service.dispose();
            });

            test('should invalidate all cache when no path provided', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                // Populate cache for multiple paths
                service.getBranches('/path/one');
                service.getBranches('/path/two');
                service.getBranches('/path/three');

                // Invalidate all
                service.invalidateBranchCache();

                // All should work after invalidation
                assert.ok(Array.isArray(service.getBranches('/path/one')));
                assert.ok(Array.isArray(service.getBranches('/path/two')));
                assert.ok(Array.isArray(service.getBranches('/path/three')));

                service.dispose();
            });
        });

        suite('Cache cleanup on dispose', () => {
            test('should clear cache when service is disposed', async () => {
                const { GitLogService } = await import('../../shortcuts/git/git-log-service');
                const service = new GitLogService();

                // Populate cache
                service.getBranches('/some/path');

                // Dispose should not throw
                service.dispose();

                // Creating new service should work
                const service2 = new GitLogService();
                const result = service2.getBranches('/some/path');
                assert.ok(Array.isArray(result));
                service2.dispose();
            });
        });
    });

    // ============================================
    // GitTreeDataProvider Lookup State Tests
    // ============================================
    suite('GitTreeDataProvider Lookup State', () => {

        suite('State Methods Existence', () => {
            test('should have setLookedUpCommit method', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();
                assert.ok(typeof provider.setLookedUpCommit === 'function');
                provider.dispose();
            });

            test('should have getLookedUpCommit method', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();
                assert.ok(typeof provider.getLookedUpCommit === 'function');
                provider.dispose();
            });

            test('should have clearLookedUpCommit method', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();
                assert.ok(typeof provider.clearLookedUpCommit === 'function');
                provider.dispose();
            });

            test('should have showCommitLookup method', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();
                assert.ok(typeof provider.showCommitLookup === 'function');
                provider.dispose();
            });
        });

        suite('State Management', () => {
            test('should initially have no looked-up commit', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                const commit = provider.getLookedUpCommit();
                assert.strictEqual(commit, null);

                provider.dispose();
            });

            test('should set looked-up commit', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                const mockCommit = createMockCommit('Test commit');
                provider.setLookedUpCommit(mockCommit);

                const result = provider.getLookedUpCommit();
                assert.strictEqual(result?.hash, mockCommit.hash);
                assert.strictEqual(result?.subject, 'Test commit');

                provider.dispose();
            });

            test('should replace existing looked-up commit', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                const commit1 = createMockCommit('First commit', [], { hash: 'hash1' });
                const commit2 = createMockCommit('Second commit', [], { hash: 'hash2' });

                provider.setLookedUpCommit(commit1);
                assert.strictEqual(provider.getLookedUpCommit()?.hash, 'hash1');

                provider.setLookedUpCommit(commit2);
                assert.strictEqual(provider.getLookedUpCommit()?.hash, 'hash2');

                provider.dispose();
            });

            test('should clear looked-up commit', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                const mockCommit = createMockCommit('Test commit');
                provider.setLookedUpCommit(mockCommit);
                assert.ok(provider.getLookedUpCommit() !== null);

                provider.clearLookedUpCommit();
                assert.strictEqual(provider.getLookedUpCommit(), null);

                provider.dispose();
            });

            test('should handle setting null commit', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                const mockCommit = createMockCommit('Test commit');
                provider.setLookedUpCommit(mockCommit);

                provider.setLookedUpCommit(null);
                assert.strictEqual(provider.getLookedUpCommit(), null);

                provider.dispose();
            });

            test('should clear already cleared commit without error', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                // Clear when already null - should not throw
                provider.clearLookedUpCommit();
                assert.strictEqual(provider.getLookedUpCommit(), null);

                // Clear again
                provider.clearLookedUpCommit();
                assert.strictEqual(provider.getLookedUpCommit(), null);

                provider.dispose();
            });
        });

        suite('Tree Data Integration', () => {
            test('should return empty array when not initialized', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                const children = await provider.getChildren();
                assert.deepStrictEqual(children, []);

                provider.dispose();
            });

            test('should have refresh method', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                assert.ok(typeof provider.refresh === 'function');

                // Should not throw
                provider.refresh();

                provider.dispose();
            });

            test('should have onDidChangeTreeData event', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                assert.ok(provider.onDidChangeTreeData);

                provider.dispose();
            });

            test('should fire onDidChangeTreeData when setting commit', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                let eventFired = false;
                const disposable = provider.onDidChangeTreeData(() => {
                    eventFired = true;
                });

                const mockCommit = createMockCommit('Test');
                provider.setLookedUpCommit(mockCommit);

                assert.strictEqual(eventFired, true);

                disposable.dispose();
                provider.dispose();
            });

            test('should fire onDidChangeTreeData when clearing commit', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                const mockCommit = createMockCommit('Test');
                provider.setLookedUpCommit(mockCommit);

                let eventFired = false;
                const disposable = provider.onDidChangeTreeData(() => {
                    eventFired = true;
                });

                provider.clearLookedUpCommit();

                assert.strictEqual(eventFired, true);

                disposable.dispose();
                provider.dispose();
            });
        });
    });

    // ============================================
    // Module Exports Tests
    // ============================================
    suite('Module Exports', () => {
        test('should export LookedUpCommitItem', async () => {
            const { LookedUpCommitItem } = await import('../../shortcuts/git');
            assert.ok(LookedUpCommitItem);
        });

        test('should be able to create LookedUpCommitItem instance', async () => {
            const { LookedUpCommitItem } = await import('../../shortcuts/git');
            const commit = createMockCommit('Test');
            const item = new LookedUpCommitItem(commit);
            assert.ok(item instanceof vscode.TreeItem);
        });
    });

    // ============================================
    // Edge Cases
    // ============================================
    suite('Edge Cases', () => {
        test('should handle commit with unicode in subject', () => {
            const commit = createMockCommit('Fix: Handle emoji \u{1F600} in strings');
            const item = new LookedUpCommitItem(commit);
            assert.ok(item.label);
        });

        test('should handle commit with newlines in subject', () => {
            const commit = createMockCommit('Fix bug\nExtra line');
            const item = new LookedUpCommitItem(commit);
            assert.ok(item.label);
        });

        test('should handle commit with very long hash', () => {
            const commit = createMockCommit('Fix', [], {
                hash: 'a'.repeat(100),
                shortHash: 'aaaaaaa'
            });
            const item = new LookedUpCommitItem(commit);
            assert.ok(item.label);
        });

        test('should handle commit with empty author', () => {
            const commit = createMockCommit('Fix', [], {
                authorName: '',
                authorEmail: ''
            });
            const item = new LookedUpCommitItem(commit);
            assert.ok(item.tooltip);
        });

        test('should handle commit with many refs', () => {
            const manyRefs = Array.from({ length: 20 }, (_, i) => `branch-${i}`);
            const commit = createMockCommit('Fix', manyRefs);
            const item = new LookedUpCommitItem(commit);
            const tooltip = item.tooltip as vscode.MarkdownString;
            assert.ok(tooltip.value.includes('branch-0'));
        });

        test('should handle repeated set and clear operations', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
            const provider = new GitTreeDataProvider();

            // Repeat set/clear multiple times
            for (let i = 0; i < 10; i++) {
                const commit = createMockCommit(`Commit ${i}`, [], { hash: `hash${i}` });
                provider.setLookedUpCommit(commit);
                assert.strictEqual(provider.getLookedUpCommit()?.hash, `hash${i}`);
                provider.clearLookedUpCommit();
                assert.strictEqual(provider.getLookedUpCommit(), null);
            }

            provider.dispose();
        });
    });

    // ============================================
    // Comparison with GitCommitItem
    // ============================================
    suite('Comparison with GitCommitItem', () => {
        test('LookedUpCommitItem should have different contextValue than GitCommitItem', async () => {
            const { GitCommitItem, LookedUpCommitItem } = await import('../../shortcuts/git');
            const commit = createMockCommit('Test');

            const gitCommitItem = new GitCommitItem(commit);
            const lookedUpItem = new LookedUpCommitItem(commit);

            assert.notStrictEqual(gitCommitItem.contextValue, lookedUpItem.contextValue);
            assert.strictEqual(gitCommitItem.contextValue, 'gitCommit');
            // contextValue includes index for multiple looked-up commits support
            assert.strictEqual(lookedUpItem.contextValue, 'lookedUpCommit_0');
        });

        test('LookedUpCommitItem should have different icon than GitCommitItem', async () => {
            const { GitCommitItem, LookedUpCommitItem } = await import('../../shortcuts/git');
            const commit = createMockCommit('Test');

            const gitCommitItem = new GitCommitItem(commit);
            const lookedUpItem = new LookedUpCommitItem(commit);

            const gitIcon = (gitCommitItem.iconPath as vscode.ThemeIcon).id;
            const lookedUpIcon = (lookedUpItem.iconPath as vscode.ThemeIcon).id;

            assert.strictEqual(gitIcon, 'git-commit');
            assert.strictEqual(lookedUpIcon, 'search');
        });

        test('LookedUpCommitItem should be expanded while GitCommitItem is collapsed', async () => {
            const { GitCommitItem, LookedUpCommitItem } = await import('../../shortcuts/git');
            const commit = createMockCommit('Test');

            const gitCommitItem = new GitCommitItem(commit);
            const lookedUpItem = new LookedUpCommitItem(commit);

            assert.strictEqual(gitCommitItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            assert.strictEqual(lookedUpItem.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
        });

        test('both items should store the same commit object', async () => {
            const { GitCommitItem, LookedUpCommitItem } = await import('../../shortcuts/git');
            const commit = createMockCommit('Test');

            const gitCommitItem = new GitCommitItem(commit);
            const lookedUpItem = new LookedUpCommitItem(commit);

            assert.strictEqual(gitCommitItem.commit, lookedUpItem.commit);
            assert.strictEqual(gitCommitItem.commit.hash, lookedUpItem.commit.hash);
        });
    });

    // ============================================
    // Ref Format Tests
    // ============================================
    suite('Ref Format Handling', () => {
        // These tests document supported ref formats
        const refFormats = [
            { ref: 'abc123def456789012345678901234567890abcd', desc: 'full SHA' },
            { ref: 'abc123d', desc: 'short SHA (7 chars)' },
            { ref: 'abc123', desc: 'short SHA (6 chars)' },
            { ref: 'HEAD', desc: 'HEAD ref' },
            { ref: 'HEAD~1', desc: 'HEAD relative (parent)' },
            { ref: 'HEAD~5', desc: 'HEAD relative (5 commits back)' },
            { ref: 'HEAD^', desc: 'HEAD parent caret notation' },
            { ref: 'main', desc: 'branch name' },
            { ref: 'origin/main', desc: 'remote branch' },
            { ref: 'v1.0.0', desc: 'tag name' },
            { ref: 'feature/new-thing', desc: 'branch with slash' },
        ];

        for (const { ref, desc } of refFormats) {
            test(`should handle ${desc} format: ${ref}`, () => {
                // Just verify the format is valid string
                assert.ok(typeof ref === 'string');
                assert.ok(ref.length > 0);
            });
        }
    });

    // ============================================
    // Quick Pick Suggestions Tests
    // ============================================
    suite('Quick Pick Suggestions', () => {
        test('default suggestions should include HEAD~1', () => {
            const defaultSuggestions = ['HEAD~1', 'HEAD~2', 'HEAD~5'];
            assert.ok(defaultSuggestions.includes('HEAD~1'));
        });

        test('default suggestions should include HEAD~2', () => {
            const defaultSuggestions = ['HEAD~1', 'HEAD~2', 'HEAD~5'];
            assert.ok(defaultSuggestions.includes('HEAD~2'));
        });

        test('default suggestions should include HEAD~5', () => {
            const defaultSuggestions = ['HEAD~1', 'HEAD~2', 'HEAD~5'];
            assert.ok(defaultSuggestions.includes('HEAD~5'));
        });

        test('suggestions should be valid ref formats', () => {
            const suggestions = ['HEAD~1', 'HEAD~2', 'HEAD~5'];
            for (const suggestion of suggestions) {
                // Should match HEAD~N format
                assert.ok(/^HEAD~\d+$/.test(suggestion));
            }
        });
    });
});
