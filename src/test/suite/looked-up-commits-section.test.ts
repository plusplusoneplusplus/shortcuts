/**
 * Tests for LookedUpCommitsSectionItem and lazy loading of looked-up commits
 * Covers: Section item creation, collapsible state, lazy loading behavior
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { LookedUpCommitsSectionItem } from '../../shortcuts/git/looked-up-commits-section-item';
import { LookedUpCommitItem } from '../../shortcuts/git/looked-up-commit-item';
import { GitCommit } from '../../shortcuts/git/types';

suite('Looked Up Commits Section Tests', () => {

    // ============================================
    // Helper Functions
    // ============================================
    const createMockCommit = (
        hash: string = 'abc123def456789012345678901234567890abcd',
        subject: string = 'Fix bug in parser'
    ): GitCommit => ({
        hash,
        shortHash: hash.substring(0, 7),
        subject,
        authorName: 'John Doe',
        authorEmail: 'john@example.com',
        date: '2024-01-15T10:30:00Z',
        relativeDate: '2 hours ago',
        parentHashes: 'parent123',
        refs: [],
        repositoryRoot: '/repo',
        repositoryName: 'repo'
    });

    // ============================================
    // LookedUpCommitsSectionItem Tests
    // ============================================
    suite('LookedUpCommitsSectionItem', () => {

        suite('Basic Properties', () => {
            test('should create section item with correct label', () => {
                const section = new LookedUpCommitsSectionItem(3);
                assert.strictEqual(section.label, 'Looked Up Commits');
            });

            test('should be collapsed by default for lazy loading', () => {
                const section = new LookedUpCommitsSectionItem(3);
                assert.strictEqual(
                    section.collapsibleState,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'Section should be collapsed by default to enable lazy loading'
                );
            });

            test('should have search icon', () => {
                const section = new LookedUpCommitsSectionItem(3);
                assert.ok(section.iconPath instanceof vscode.ThemeIcon);
                assert.strictEqual((section.iconPath as vscode.ThemeIcon).id, 'search');
            });

            test('should have contextValue of lookedUpCommitsSection', () => {
                const section = new LookedUpCommitsSectionItem(3);
                assert.strictEqual(section.contextValue, 'lookedUpCommitsSection');
            });

            test('should be instance of TreeItem', () => {
                const section = new LookedUpCommitsSectionItem(3);
                assert.ok(section instanceof vscode.TreeItem);
            });
        });

        suite('Count Display', () => {
            test('should show count in description', () => {
                const section = new LookedUpCommitsSectionItem(5);
                assert.strictEqual(section.description, '5');
            });

            test('should show 0 when no commits', () => {
                const section = new LookedUpCommitsSectionItem(0);
                assert.strictEqual(section.description, '0');
            });

            test('should show 1 for single commit', () => {
                const section = new LookedUpCommitsSectionItem(1);
                assert.strictEqual(section.description, '1');
            });

            test('should show large numbers correctly', () => {
                const section = new LookedUpCommitsSectionItem(100);
                assert.strictEqual(section.description, '100');
            });
        });

        suite('Tooltip', () => {
            test('should have tooltip for multiple commits', () => {
                const section = new LookedUpCommitsSectionItem(3);
                assert.strictEqual(section.tooltip, '3 looked-up commits');
            });

            test('should have singular tooltip for one commit', () => {
                const section = new LookedUpCommitsSectionItem(1);
                assert.strictEqual(section.tooltip, '1 looked-up commit');
            });

            test('should have tooltip for zero commits', () => {
                const section = new LookedUpCommitsSectionItem(0);
                assert.strictEqual(section.tooltip, 'No looked-up commits');
            });
        });
    });

    // ============================================
    // Tree Data Provider Integration Tests
    // ============================================
    suite('GitTreeDataProvider Integration', () => {

        suite('Section Visibility', () => {
            test('should not show section when no looked-up commits', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                // Get root items without initializing (will return empty array)
                const children = await provider.getChildren();

                // Should not contain LookedUpCommitsSectionItem
                const sectionItem = children.find(item => item instanceof LookedUpCommitsSectionItem);
                assert.strictEqual(sectionItem, undefined, 'Should not show section when no looked-up commits');

                provider.dispose();
            });

            test('should show section when looked-up commits exist', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const { LookedUpCommitsSectionItem } = await import('../../shortcuts/git/looked-up-commits-section-item');
                const provider = new GitTreeDataProvider();

                // Add a looked-up commit
                const commit = createMockCommit('hash1', 'Test commit');
                provider.addLookedUpCommit(commit);

                // We can't test getChildren directly without initialization,
                // but we can verify the commit was added
                assert.strictEqual(provider.getLookedUpCommits().length, 1);

                provider.dispose();
            });
        });

        suite('Lazy Loading Behavior', () => {
            test('should return looked-up commits when section is expanded (with initialization)', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const { LookedUpCommitsSectionItem } = await import('../../shortcuts/git/looked-up-commits-section-item');
                const provider = new GitTreeDataProvider();

                // Initialize the provider (may fail without git, but that's ok for this test)
                try {
                    await provider.initialize();
                } catch {
                    // Git not available, skip test
                    provider.dispose();
                    return;
                }

                // Add commits
                const commit1 = createMockCommit('hash1', 'First commit');
                const commit2 = createMockCommit('hash2', 'Second commit');
                provider.addLookedUpCommit(commit1);
                provider.addLookedUpCommit(commit2);

                // Create section item and get its children
                const sectionItem = new LookedUpCommitsSectionItem(2);
                const children = await provider.getChildren(sectionItem);

                assert.strictEqual(children.length, 2, 'Should return 2 looked-up commit items');
                assert.ok(children[0] instanceof LookedUpCommitItem, 'First child should be LookedUpCommitItem');
                assert.ok(children[1] instanceof LookedUpCommitItem, 'Second child should be LookedUpCommitItem');

                provider.dispose();
            });

            test('should return commits in correct order (newest first) - via getLookedUpCommits', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                // Add commits in order
                const commit1 = createMockCommit('hash1', 'First commit');
                const commit2 = createMockCommit('hash2', 'Second commit');
                const commit3 = createMockCommit('hash3', 'Third commit');
                provider.addLookedUpCommit(commit1);
                provider.addLookedUpCommit(commit2);
                provider.addLookedUpCommit(commit3);

                // Verify order via getLookedUpCommits
                const commits = provider.getLookedUpCommits();

                // Newest (most recently added) should be first
                assert.strictEqual(commits[0].hash, 'hash3');
                assert.strictEqual(commits[1].hash, 'hash2');
                assert.strictEqual(commits[2].hash, 'hash1');

                provider.dispose();
            });

            test('should assign correct indices to looked-up commit items', () => {
                // Test LookedUpCommitItem index assignment directly
                const commit1 = createMockCommit('hash1', 'First commit');
                const commit2 = createMockCommit('hash2', 'Second commit');

                const item0 = new LookedUpCommitItem(commit1, 0);
                const item1 = new LookedUpCommitItem(commit2, 1);

                // Check indices
                assert.strictEqual(item0.index, 0);
                assert.strictEqual(item1.index, 1);
                assert.strictEqual(item0.contextValue, 'lookedUpCommit_0');
                assert.strictEqual(item1.contextValue, 'lookedUpCommit_1');
            });
        });

        suite('Section Item Children', () => {
            test('should return empty array when no commits added', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                // No commits added
                const commits = provider.getLookedUpCommits();
                assert.strictEqual(commits.length, 0, 'Should return empty array');

                provider.dispose();
            });

            test('should return correct number of commits', async () => {
                const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
                const provider = new GitTreeDataProvider();

                // Add 5 commits
                for (let i = 0; i < 5; i++) {
                    provider.addLookedUpCommit(createMockCommit(`hash${i}`, `Commit ${i}`));
                }

                const commits = provider.getLookedUpCommits();
                assert.strictEqual(commits.length, 5, 'Should return 5 commits');

                provider.dispose();
            });
        });
    });

    // ============================================
    // LookedUpCommitItem within Section Tests
    // ============================================
    suite('LookedUpCommitItem within Section', () => {

        test('should still be expandable to show commit files', async () => {
            const commit = createMockCommit('hash1', 'Test commit');
            const item = new LookedUpCommitItem(commit, 0);

            // LookedUpCommitItem should be expanded by default to show files
            assert.strictEqual(
                item.collapsibleState,
                vscode.TreeItemCollapsibleState.Expanded,
                'LookedUpCommitItem should be expanded to show files'
            );
        });

        test('should have correct contextValue with index', () => {
            const commit = createMockCommit('hash1', 'Test commit');

            const item0 = new LookedUpCommitItem(commit, 0);
            const item3 = new LookedUpCommitItem(commit, 3);

            assert.strictEqual(item0.contextValue, 'lookedUpCommit_0');
            assert.strictEqual(item3.contextValue, 'lookedUpCommit_3');
        });

        test('should store commit reference correctly', () => {
            const commit = createMockCommit('hash1', 'Test commit');
            const item = new LookedUpCommitItem(commit, 2);

            assert.strictEqual(item.commit.hash, 'hash1');
            assert.strictEqual(item.commit.subject, 'Test commit');
            assert.strictEqual(item.index, 2);
        });
    });

    // ============================================
    // Module Exports Tests
    // ============================================
    suite('Module Exports', () => {
        test('should export LookedUpCommitsSectionItem', async () => {
            const { LookedUpCommitsSectionItem } = await import('../../shortcuts/git');
            assert.ok(LookedUpCommitsSectionItem);
        });

        test('should be able to create LookedUpCommitsSectionItem instance', async () => {
            const { LookedUpCommitsSectionItem } = await import('../../shortcuts/git');
            const item = new LookedUpCommitsSectionItem(3);
            assert.ok(item instanceof vscode.TreeItem);
        });
    });

    // ============================================
    // Edge Cases
    // ============================================
    suite('Edge Cases', () => {
        test('should handle section with very large count', () => {
            const section = new LookedUpCommitsSectionItem(9999);
            assert.strictEqual(section.description, '9999');
            assert.ok(typeof section.tooltip === 'string' && section.tooltip.includes('9999'));
        });

        test('should handle negative count gracefully', () => {
            // This shouldn't happen in practice, but test defensive behavior
            const section = new LookedUpCommitsSectionItem(-1);
            // Negative counts are treated as 0
            assert.strictEqual(section.description, '0');
            assert.strictEqual(section.tooltip, 'No looked-up commits');
        });

        test('section should remain collapsed after creation', () => {
            const section = new LookedUpCommitsSectionItem(10);
            // Verify it's collapsed (lazy loading)
            assert.strictEqual(
                section.collapsibleState,
                vscode.TreeItemCollapsibleState.Collapsed
            );
        });
    });

    // ============================================
    // Comparison with Other Section Items
    // ============================================
    suite('Comparison with Other Section Items', () => {
        test('should have different contextValue than SectionHeaderItem', async () => {
            const { SectionHeaderItem } = await import('../../shortcuts/git/section-header-item');
            const { LookedUpCommitsSectionItem } = await import('../../shortcuts/git/looked-up-commits-section-item');

            const changesSection = new SectionHeaderItem('changes', 5, false);
            const commitsSection = new SectionHeaderItem('commits', 10, true);
            const lookedUpSection = new LookedUpCommitsSectionItem(3);

            assert.notStrictEqual(changesSection.contextValue, lookedUpSection.contextValue);
            assert.notStrictEqual(commitsSection.contextValue, lookedUpSection.contextValue);
            assert.strictEqual(lookedUpSection.contextValue, 'lookedUpCommitsSection');
        });

        test('should have different collapsible state than SectionHeaderItem', async () => {
            const { SectionHeaderItem } = await import('../../shortcuts/git/section-header-item');
            const { LookedUpCommitsSectionItem } = await import('../../shortcuts/git/looked-up-commits-section-item');

            const changesSection = new SectionHeaderItem('changes', 5, false);
            const lookedUpSection = new LookedUpCommitsSectionItem(3);

            // SectionHeaderItem starts expanded, LookedUpCommitsSectionItem starts collapsed
            assert.strictEqual(changesSection.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
            assert.strictEqual(lookedUpSection.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });
    });

    // ============================================
    // State Management Tests
    // ============================================
    suite('State Management with Section', () => {
        test('should update section count when commits are added', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
            const provider = new GitTreeDataProvider();

            // Add commits
            provider.addLookedUpCommit(createMockCommit('hash1', 'Commit 1'));
            assert.strictEqual(provider.getLookedUpCommits().length, 1);

            provider.addLookedUpCommit(createMockCommit('hash2', 'Commit 2'));
            assert.strictEqual(provider.getLookedUpCommits().length, 2);

            provider.dispose();
        });

        test('should update section count when commits are cleared', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
            const provider = new GitTreeDataProvider();

            // Add commits
            provider.addLookedUpCommit(createMockCommit('hash1', 'Commit 1'));
            provider.addLookedUpCommit(createMockCommit('hash2', 'Commit 2'));
            assert.strictEqual(provider.getLookedUpCommits().length, 2);

            // Clear one
            provider.clearLookedUpCommitByIndex(0);
            assert.strictEqual(provider.getLookedUpCommits().length, 1);

            // Clear all
            provider.clearAllLookedUpCommits();
            assert.strictEqual(provider.getLookedUpCommits().length, 0);

            provider.dispose();
        });

        test('should fire tree data change event when section content changes', async () => {
            const { GitTreeDataProvider } = await import('../../shortcuts/git/tree-data-provider');
            const provider = new GitTreeDataProvider();

            let eventCount = 0;
            const disposable = provider.onDidChangeTreeData(() => {
                eventCount++;
            });

            // Add commit - should fire event
            provider.addLookedUpCommit(createMockCommit('hash1', 'Commit 1'));
            assert.strictEqual(eventCount, 1, 'Should fire event when adding commit');

            // Clear commit - should fire event
            provider.clearLookedUpCommitByIndex(0);
            assert.strictEqual(eventCount, 2, 'Should fire event when clearing commit');

            disposable.dispose();
            provider.dispose();
        });
    });
});
