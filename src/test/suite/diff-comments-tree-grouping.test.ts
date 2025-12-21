/**
 * Tests for DiffCommentsTreeDataProvider grouping functionality
 * Tests the new category-based grouping (Pending Changes vs Committed)
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    DIFF_COMMENTS_CONFIG_FILE,
    DiffCommentCategoryItem,
    DiffCommentFileItem,
    DiffCommentItem,
    DiffCommentsManager,
    DiffCommentsTreeDataProvider,
    DiffGitContext,
    DiffSelection
} from '../../shortcuts/git-diff-comments';

/**
 * Create a test git context for pending changes
 */
function createPendingGitContext(tempDir: string, staged: boolean = false): DiffGitContext {
    return {
        repositoryRoot: tempDir,
        repositoryName: 'test-repo',
        oldRef: staged ? 'HEAD' : ':0',
        newRef: staged ? ':0' : 'WORKING_TREE',
        wasStaged: staged
    };
}

/**
 * Create a test git context for committed changes
 */
function createCommittedGitContext(tempDir: string, commitHash: string): DiffGitContext {
    return {
        repositoryRoot: tempDir,
        repositoryName: 'test-repo',
        oldRef: `${commitHash}^`,
        newRef: commitHash,
        wasStaged: true,
        commitHash
    };
}

/**
 * Create a test selection
 */
function createTestSelection(): DiffSelection {
    return {
        side: 'new',
        oldStartLine: null,
        oldEndLine: null,
        newStartLine: 1,
        newEndLine: 1,
        startColumn: 1,
        endColumn: 10
    };
}

suite('DiffCommentsTreeDataProvider Grouping Tests', () => {
    let tempDir: string;
    let manager: DiffCommentsManager;
    let treeProvider: DiffCommentsTreeDataProvider;

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-tree-test-'));
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        fs.writeFileSync(
            path.join(vscodePath, DIFF_COMMENTS_CONFIG_FILE),
            JSON.stringify({ version: 1, comments: [] })
        );
        manager = new DiffCommentsManager(tempDir);
        treeProvider = new DiffCommentsTreeDataProvider(manager);
    });

    teardown(() => {
        treeProvider.dispose();
        manager.dispose();
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Category Grouping', () => {
        test('should return empty array when no comments', async () => {
            await manager.initialize();
            const children = await treeProvider.getChildren();
            assert.strictEqual(children.length, 0);
        });

        test('should create Pending Changes category for pending comments', async () => {
            await manager.initialize();

            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Pending comment',
                createPendingGitContext(tempDir)
            );

            const children = await treeProvider.getChildren();
            assert.strictEqual(children.length, 1);
            assert.ok(children[0] instanceof DiffCommentCategoryItem);
            
            const category = children[0] as DiffCommentCategoryItem;
            assert.strictEqual(category.category, 'pending');
            assert.strictEqual(category.label, 'Pending Changes');
        });

        test('should create Committed category for committed comments', async () => {
            await manager.initialize();

            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Committed comment',
                createCommittedGitContext(tempDir, 'abc123def456')
            );

            const children = await treeProvider.getChildren();
            assert.strictEqual(children.length, 1);
            assert.ok(children[0] instanceof DiffCommentCategoryItem);
            
            const category = children[0] as DiffCommentCategoryItem;
            assert.strictEqual(category.category, 'committed');
            assert.strictEqual(category.commitHash, 'abc123def456');
            assert.ok(category.label?.toString().includes('abc123d'));
        });

        test('should create separate categories for pending and committed', async () => {
            await manager.initialize();

            await manager.addComment(
                'pending.ts',
                createTestSelection(),
                'Test',
                'Pending comment',
                createPendingGitContext(tempDir)
            );

            await manager.addComment(
                'committed.ts',
                createTestSelection(),
                'Test',
                'Committed comment',
                createCommittedGitContext(tempDir, 'abc123def456')
            );

            const children = await treeProvider.getChildren();
            assert.strictEqual(children.length, 2);
            
            const categories = children.map(c => (c as DiffCommentCategoryItem).category);
            assert.ok(categories.includes('pending'));
            assert.ok(categories.includes('committed'));
        });

        test('should create separate categories for different commits', async () => {
            await manager.initialize();

            await manager.addComment(
                'file1.ts',
                createTestSelection(),
                'Test',
                'Commit 1 comment',
                createCommittedGitContext(tempDir, 'commit1hash')
            );

            await manager.addComment(
                'file2.ts',
                createTestSelection(),
                'Test',
                'Commit 2 comment',
                createCommittedGitContext(tempDir, 'commit2hash')
            );

            const children = await treeProvider.getChildren();
            assert.strictEqual(children.length, 2);
            
            const commitHashes = children.map(c => (c as DiffCommentCategoryItem).commitHash);
            assert.ok(commitHashes.includes('commit1hash'));
            assert.ok(commitHashes.includes('commit2hash'));
        });
    });

    suite('File Items within Categories', () => {
        test('should return file items for pending category', async () => {
            await manager.initialize();

            await manager.addComment(
                'file1.ts',
                createTestSelection(),
                'Test',
                'Comment 1',
                createPendingGitContext(tempDir)
            );

            await manager.addComment(
                'file2.ts',
                createTestSelection(),
                'Test',
                'Comment 2',
                createPendingGitContext(tempDir)
            );

            const categories = await treeProvider.getChildren();
            const pendingCategory = categories[0] as DiffCommentCategoryItem;
            
            const files = await treeProvider.getChildren(pendingCategory);
            assert.strictEqual(files.length, 2);
            
            const filePaths = files.map(f => path.basename((f as DiffCommentFileItem).filePath));
            assert.ok(filePaths.includes('file1.ts'));
            assert.ok(filePaths.includes('file2.ts'));
        });

        test('should return file items for committed category', async () => {
            await manager.initialize();

            const commitHash = 'abc123def456';
            await manager.addComment(
                'committed1.ts',
                createTestSelection(),
                'Test',
                'Comment 1',
                createCommittedGitContext(tempDir, commitHash)
            );

            await manager.addComment(
                'committed2.ts',
                createTestSelection(),
                'Test',
                'Comment 2',
                createCommittedGitContext(tempDir, commitHash)
            );

            const categories = await treeProvider.getChildren();
            const committedCategory = categories[0] as DiffCommentCategoryItem;
            
            const files = await treeProvider.getChildren(committedCategory);
            assert.strictEqual(files.length, 2);
            
            for (const file of files) {
                assert.ok(file instanceof DiffCommentFileItem);
                assert.strictEqual((file as DiffCommentFileItem).category, 'committed');
                assert.strictEqual((file as DiffCommentFileItem).commitHash, commitHash);
            }
        });

        test('should only show files for specific commit in committed category', async () => {
            await manager.initialize();

            await manager.addComment(
                'commit1-file.ts',
                createTestSelection(),
                'Test',
                'Comment for commit 1',
                createCommittedGitContext(tempDir, 'commit1hash')
            );

            await manager.addComment(
                'commit2-file.ts',
                createTestSelection(),
                'Test',
                'Comment for commit 2',
                createCommittedGitContext(tempDir, 'commit2hash')
            );

            const categories = await treeProvider.getChildren();
            
            for (const category of categories) {
                const cat = category as DiffCommentCategoryItem;
                const files = await treeProvider.getChildren(cat);
                
                assert.strictEqual(files.length, 1);
                const file = files[0] as DiffCommentFileItem;
                assert.strictEqual(file.commitHash, cat.commitHash);
            }
        });
    });

    suite('Comment Items within Files', () => {
        test('should return comments for file in pending category', async () => {
            await manager.initialize();

            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Text 1',
                'Comment 1',
                createPendingGitContext(tempDir)
            );

            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Text 2',
                'Comment 2',
                createPendingGitContext(tempDir)
            );

            const categories = await treeProvider.getChildren();
            const pendingCategory = categories[0] as DiffCommentCategoryItem;
            
            const files = await treeProvider.getChildren(pendingCategory);
            const fileItem = files[0] as DiffCommentFileItem;
            
            const comments = await treeProvider.getChildren(fileItem);
            assert.strictEqual(comments.length, 2);
            
            for (const comment of comments) {
                assert.ok(comment instanceof DiffCommentItem);
            }
        });

        test('should only return comments for specific commit in committed file', async () => {
            await manager.initialize();

            // Add pending comment to same file
            await manager.addComment(
                'shared-file.ts',
                createTestSelection(),
                'Pending text',
                'Pending comment',
                createPendingGitContext(tempDir)
            );

            // Add committed comment to same file
            await manager.addComment(
                'shared-file.ts',
                createTestSelection(),
                'Committed text',
                'Committed comment',
                createCommittedGitContext(tempDir, 'commit1hash')
            );

            const categories = await treeProvider.getChildren();
            
            // Find the committed category
            const committedCategory = categories.find(
                c => (c as DiffCommentCategoryItem).category === 'committed'
            ) as DiffCommentCategoryItem;
            
            const files = await treeProvider.getChildren(committedCategory);
            const fileItem = files[0] as DiffCommentFileItem;
            
            const comments = await treeProvider.getChildren(fileItem);
            
            // Should only have the committed comment
            assert.strictEqual(comments.length, 1);
            const comment = (comments[0] as DiffCommentItem).comment;
            assert.strictEqual(comment.comment, 'Committed comment');
        });
    });

    suite('Category Item Properties', () => {
        test('should show correct counts for pending category', async () => {
            await manager.initialize();

            const c1 = await manager.addComment(
                'file1.ts',
                createTestSelection(),
                'Test',
                'Open 1',
                createPendingGitContext(tempDir)
            );

            await manager.addComment(
                'file2.ts',
                createTestSelection(),
                'Test',
                'Open 2',
                createPendingGitContext(tempDir)
            );

            await manager.resolveComment(c1.id);

            const categories = await treeProvider.getChildren();
            const pendingCategory = categories[0] as DiffCommentCategoryItem;
            
            assert.strictEqual(pendingCategory.openCount, 1);
            assert.strictEqual(pendingCategory.resolvedCount, 1);
        });

        test('should use correct icon for pending category', async () => {
            await manager.initialize();

            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Comment',
                createPendingGitContext(tempDir)
            );

            const categories = await treeProvider.getChildren();
            const pendingCategory = categories[0] as DiffCommentCategoryItem;
            
            assert.ok(pendingCategory.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((pendingCategory.iconPath as vscode.ThemeIcon).id, 'git-pull-request-create');
        });

        test('should use correct icon for committed category', async () => {
            await manager.initialize();

            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Comment',
                createCommittedGitContext(tempDir, 'abc123')
            );

            const categories = await treeProvider.getChildren();
            const committedCategory = categories[0] as DiffCommentCategoryItem;
            
            assert.ok(committedCategory.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((committedCategory.iconPath as vscode.ThemeIcon).id, 'git-commit');
        });
    });

    suite('File Item Properties', () => {
        test('should include category and commitHash in file item', async () => {
            await manager.initialize();

            const commitHash = 'abc123def456';
            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Comment',
                createCommittedGitContext(tempDir, commitHash)
            );

            const categories = await treeProvider.getChildren();
            const committedCategory = categories[0] as DiffCommentCategoryItem;
            
            const files = await treeProvider.getChildren(committedCategory);
            const fileItem = files[0] as DiffCommentFileItem;
            
            assert.strictEqual(fileItem.category, 'committed');
            assert.strictEqual(fileItem.commitHash, commitHash);
        });

        test('should show commit hash in tooltip for committed files', async () => {
            await manager.initialize();

            const commitHash = 'abc123def456';
            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Comment',
                createCommittedGitContext(tempDir, commitHash)
            );

            const categories = await treeProvider.getChildren();
            const committedCategory = categories[0] as DiffCommentCategoryItem;
            
            const files = await treeProvider.getChildren(committedCategory);
            const fileItem = files[0] as DiffCommentFileItem;
            
            const tooltip = fileItem.tooltip?.toString() || '';
            assert.ok(tooltip.includes('abc123d'), 'Tooltip should include short commit hash');
        });
    });

    suite('Filtering', () => {
        test('should hide resolved comments when showResolved is false', async () => {
            await manager.initialize();

            const c1 = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Comment 1',
                createPendingGitContext(tempDir)
            );

            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Comment 2',
                createPendingGitContext(tempDir)
            );

            await manager.resolveComment(c1.id);

            // Initially should show both
            let categories = await treeProvider.getChildren();
            let pendingCategory = categories[0] as DiffCommentCategoryItem;
            assert.strictEqual(pendingCategory.openCount + pendingCategory.resolvedCount, 2);

            // Hide resolved
            treeProvider.setShowResolved(false);
            
            categories = await treeProvider.getChildren();
            pendingCategory = categories[0] as DiffCommentCategoryItem;
            assert.strictEqual(pendingCategory.openCount, 1);
            assert.strictEqual(pendingCategory.resolvedCount, 0);
        });

        test('should hide category when all comments are resolved and showResolved is false', async () => {
            await manager.initialize();

            const c1 = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Comment',
                createPendingGitContext(tempDir)
            );

            await manager.resolveComment(c1.id);

            // Hide resolved
            treeProvider.setShowResolved(false);
            
            const categories = await treeProvider.getChildren();
            assert.strictEqual(categories.length, 0);
        });
    });

    suite('Parent Navigation', () => {
        test('should return category as parent of file item', async () => {
            await manager.initialize();

            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Comment',
                createPendingGitContext(tempDir)
            );

            const categories = await treeProvider.getChildren();
            const pendingCategory = categories[0] as DiffCommentCategoryItem;
            
            const files = await treeProvider.getChildren(pendingCategory);
            const fileItem = files[0] as DiffCommentFileItem;
            
            const parent = treeProvider.getParent(fileItem);
            assert.ok(parent instanceof DiffCommentCategoryItem);
            assert.strictEqual((parent as DiffCommentCategoryItem).category, 'pending');
        });

        test('should return file item as parent of comment item', async () => {
            await manager.initialize();

            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Comment',
                createPendingGitContext(tempDir)
            );

            const categories = await treeProvider.getChildren();
            const pendingCategory = categories[0] as DiffCommentCategoryItem;
            
            const files = await treeProvider.getChildren(pendingCategory);
            const fileItem = files[0] as DiffCommentFileItem;
            
            const comments = await treeProvider.getChildren(fileItem);
            const commentItem = comments[0] as DiffCommentItem;
            
            const parent = treeProvider.getParent(commentItem);
            assert.ok(parent instanceof DiffCommentFileItem);
        });
    });

    suite('Refresh and Events', () => {
        test('should refresh when comments change', async () => {
            await manager.initialize();

            let refreshCount = 0;
            treeProvider.onDidChangeTreeData(() => {
                refreshCount++;
            });

            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Comment',
                createPendingGitContext(tempDir)
            );

            // Wait a bit for event propagation
            await new Promise(resolve => setTimeout(resolve, 50));

            assert.ok(refreshCount > 0, 'Should have refreshed after adding comment');
        });
    });
});

