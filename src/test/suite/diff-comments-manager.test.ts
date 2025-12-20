/**
 * Comprehensive unit tests for DiffCommentsManager
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DEFAULT_DIFF_COMMENTS_SETTINGS,
    DIFF_COMMENTS_CONFIG_FILE,
    DiffComment,
    DiffCommentsConfig,
    DiffCommentsManager,
    DiffGitContext,
    DiffSelection
} from '../../shortcuts/git-diff-comments';

/**
 * Create a test git context
 */
function createTestGitContext(tempDir: string): DiffGitContext {
    return {
        repositoryRoot: tempDir,
        repositoryName: 'test-repo',
        oldRef: 'HEAD',
        newRef: ':0',
        wasStaged: true
    };
}

/**
 * Create a test selection
 */
function createTestSelection(side: 'old' | 'new' = 'new'): DiffSelection {
    if (side === 'old') {
        return {
            side: 'old',
            oldStartLine: 1,
            oldEndLine: 1,
            newStartLine: null,
            newEndLine: null,
            startColumn: 1,
            endColumn: 10
        };
    }
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

suite('DiffCommentsManager Tests', () => {
    let tempDir: string;
    let manager: DiffCommentsManager;

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-comments-test-'));
        // Ensure .vscode directory exists
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        // Create empty comments file
        fs.writeFileSync(
            path.join(vscodePath, DIFF_COMMENTS_CONFIG_FILE),
            JSON.stringify({ version: 1, comments: [] })
        );
        manager = new DiffCommentsManager(tempDir);
    });

    teardown(() => {
        manager.dispose();
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Initialization', () => {
        test('should initialize with empty comments', async () => {
            await manager.initialize();
            const comments = manager.getAllComments();
            assert.strictEqual(comments.length, 0);
        });

        test('should create config directory if not exists', async () => {
            // Remove .vscode directory
            const vscodePath = path.join(tempDir, '.vscode');
            fs.rmSync(vscodePath, { recursive: true, force: true });

            await manager.initialize();
            
            // Add a comment to trigger save
            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test text',
                'Test comment',
                createTestGitContext(tempDir)
            );

            assert.ok(fs.existsSync(vscodePath));
            assert.ok(fs.existsSync(path.join(vscodePath, DIFF_COMMENTS_CONFIG_FILE)));
        });
    });

    suite('Adding Comments', () => {
        test('should add a comment successfully', async () => {
            await manager.initialize();

            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test text',
                'This is a test comment',
                createTestGitContext(tempDir)
            );

            assert.ok(comment);
            assert.ok(comment.id);
            assert.ok(comment.id.startsWith('diff_comment_'));
            assert.strictEqual(comment.selectedText, 'Test text');
            assert.strictEqual(comment.comment, 'This is a test comment');
            assert.strictEqual(comment.status, 'open');
        });

        test('should generate unique comment IDs', async () => {
            await manager.initialize();

            const ids = new Set<string>();
            for (let i = 0; i < 50; i++) {
                const comment = await manager.addComment(
                    'test.ts',
                    createTestSelection(),
                    `Text ${i}`,
                    `Comment ${i}`,
                    createTestGitContext(tempDir)
                );
                assert.ok(!ids.has(comment.id), `Duplicate ID found: ${comment.id}`);
                ids.add(comment.id);
            }
            assert.strictEqual(ids.size, 50);
        });

        test('should add comment with author and tags', async () => {
            await manager.initialize();

            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test text',
                'Test comment',
                createTestGitContext(tempDir),
                undefined, // content
                'John Doe',
                ['bug', 'review']
            );

            assert.strictEqual(comment.author, 'John Doe');
            assert.deepStrictEqual(comment.tags, ['bug', 'review']);
        });

        test('should store git context', async () => {
            await manager.initialize();

            const gitContext = createTestGitContext(tempDir);
            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test text',
                'Test comment',
                gitContext
            );

            assert.deepStrictEqual(comment.gitContext, gitContext);
        });

        test('should add comment on old side', async () => {
            await manager.initialize();

            const selection = createTestSelection('old');
            const comment = await manager.addComment(
                'test.ts',
                selection,
                'Old text',
                'Comment on old',
                createTestGitContext(tempDir)
            );

            assert.strictEqual(comment.selection.side, 'old');
            assert.strictEqual(comment.selection.oldStartLine, 1);
            assert.strictEqual(comment.selection.newStartLine, null);
        });
    });

    suite('Updating Comments', () => {
        test('should update a comment', async () => {
            await manager.initialize();

            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test text',
                'Original comment',
                createTestGitContext(tempDir)
            );

            await new Promise(resolve => setTimeout(resolve, 5));

            const updated = await manager.updateComment(comment.id, {
                comment: 'Updated comment'
            });

            assert.ok(updated);
            assert.strictEqual(updated.comment, 'Updated comment');
            assert.ok(updated.updatedAt, 'Updated timestamp should be set');
        });

        test('should update comment tags', async () => {
            await manager.initialize();

            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test text',
                'Test comment',
                createTestGitContext(tempDir)
            );

            const updated = await manager.updateComment(comment.id, {
                tags: ['important', 'urgent']
            });

            assert.deepStrictEqual(updated?.tags, ['important', 'urgent']);
        });

        test('should return undefined for non-existent comment update', async () => {
            await manager.initialize();

            const result = await manager.updateComment('non_existent', { comment: 'test' });
            assert.strictEqual(result, undefined);
        });
    });

    suite('Deleting Comments', () => {
        test('should delete a comment', async () => {
            await manager.initialize();

            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test text',
                'Test comment',
                createTestGitContext(tempDir)
            );

            assert.strictEqual(manager.getAllComments().length, 1);

            const result = await manager.deleteComment(comment.id);
            assert.strictEqual(result, true);
            assert.strictEqual(manager.getAllComments().length, 0);
        });

        test('should return false when deleting non-existent comment', async () => {
            await manager.initialize();
            const result = await manager.deleteComment('non_existent_id');
            assert.strictEqual(result, false);
        });

        test('should delete all comments', async () => {
            await manager.initialize();

            for (let i = 0; i < 5; i++) {
                await manager.addComment(
                    'test.ts',
                    createTestSelection(),
                    `Text ${i}`,
                    `Comment ${i}`,
                    createTestGitContext(tempDir)
                );
            }

            assert.strictEqual(manager.getAllComments().length, 5);

            const count = await manager.deleteAllComments();
            assert.strictEqual(count, 5);
            assert.strictEqual(manager.getAllComments().length, 0);
        });
    });

    suite('Resolving Comments', () => {
        test('should resolve a comment', async () => {
            await manager.initialize();

            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test text',
                'Test comment',
                createTestGitContext(tempDir)
            );

            assert.strictEqual(comment.status, 'open');

            const resolved = await manager.resolveComment(comment.id);
            assert.ok(resolved);
            assert.strictEqual(resolved.status, 'resolved');
        });

        test('should reopen a resolved comment', async () => {
            await manager.initialize();

            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test text',
                'Test comment',
                createTestGitContext(tempDir)
            );

            await manager.resolveComment(comment.id);
            const reopened = await manager.reopenComment(comment.id);

            assert.ok(reopened);
            assert.strictEqual(reopened.status, 'open');
        });

        test('should resolve all open comments', async () => {
            await manager.initialize();

            for (let i = 0; i < 5; i++) {
                await manager.addComment(
                    'test.ts',
                    createTestSelection(),
                    `Text ${i}`,
                    `Comment ${i}`,
                    createTestGitContext(tempDir)
                );
            }

            assert.strictEqual(manager.getOpenCommentCount(), 5);

            const count = await manager.resolveAllComments();
            assert.strictEqual(count, 5);
            assert.strictEqual(manager.getOpenCommentCount(), 0);
            assert.strictEqual(manager.getResolvedCommentCount(), 5);
        });
    });

    suite('Querying Comments', () => {
        test('should get comments for a specific file', async () => {
            await manager.initialize();

            await manager.addComment('file1.ts', createTestSelection(), 'T1', 'C1', createTestGitContext(tempDir));
            await manager.addComment('file2.ts', createTestSelection(), 'T2', 'C2', createTestGitContext(tempDir));
            await manager.addComment('file1.ts', createTestSelection(), 'T3', 'C3', createTestGitContext(tempDir));

            const file1Comments = manager.getCommentsForFile('file1.ts');
            assert.strictEqual(file1Comments.length, 2);

            const file2Comments = manager.getCommentsForFile('file2.ts');
            assert.strictEqual(file2Comments.length, 1);
        });

        test('should get comments grouped by file', async () => {
            await manager.initialize();

            await manager.addComment('file1.ts', createTestSelection(), 'T1', 'C1', createTestGitContext(tempDir));
            await manager.addComment('file2.ts', createTestSelection(), 'T2', 'C2', createTestGitContext(tempDir));
            await manager.addComment('file1.ts', createTestSelection(), 'T3', 'C3', createTestGitContext(tempDir));

            const grouped = manager.getCommentsGroupedByFile();
            assert.strictEqual(grouped.size, 2);
            assert.strictEqual(grouped.get('file1.ts')?.length, 2);
            assert.strictEqual(grouped.get('file2.ts')?.length, 1);
        });

        test('should get open comments only', async () => {
            await manager.initialize();

            const c1 = await manager.addComment('test.ts', createTestSelection(), 'T1', 'C1', createTestGitContext(tempDir));
            await manager.addComment('test.ts', createTestSelection(), 'T2', 'C2', createTestGitContext(tempDir));

            await manager.resolveComment(c1.id);

            const openComments = manager.getOpenComments();
            assert.strictEqual(openComments.length, 1);
            assert.strictEqual(openComments[0].comment, 'C2');
        });

        test('should get resolved comments only', async () => {
            await manager.initialize();

            const c1 = await manager.addComment('test.ts', createTestSelection(), 'T1', 'C1', createTestGitContext(tempDir));
            await manager.addComment('test.ts', createTestSelection(), 'T2', 'C2', createTestGitContext(tempDir));

            await manager.resolveComment(c1.id);

            const resolvedComments = manager.getResolvedComments();
            assert.strictEqual(resolvedComments.length, 1);
            assert.strictEqual(resolvedComments[0].comment, 'C1');
        });

        test('should get a comment by ID', async () => {
            await manager.initialize();

            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test text',
                'Test comment',
                createTestGitContext(tempDir)
            );

            const found = manager.getComment(comment.id);
            assert.ok(found);
            assert.strictEqual(found.id, comment.id);
            assert.strictEqual(found.comment, 'Test comment');
        });

        test('should return undefined for non-existent comment', async () => {
            await manager.initialize();

            const found = manager.getComment('non_existent');
            assert.strictEqual(found, undefined);
        });

        test('should get files with comments', async () => {
            await manager.initialize();

            await manager.addComment('a.ts', createTestSelection(), 'T', 'C', createTestGitContext(tempDir));
            await manager.addComment('b.ts', createTestSelection(), 'T', 'C', createTestGitContext(tempDir));
            await manager.addComment('a.ts', createTestSelection(), 'T', 'C', createTestGitContext(tempDir));

            const files = manager.getFilesWithComments();
            assert.strictEqual(files.length, 2);
            assert.ok(files.includes('a.ts'));
            assert.ok(files.includes('b.ts'));
        });

        test('should get comment count for file', async () => {
            await manager.initialize();

            await manager.addComment('file1.ts', createTestSelection(), 'T1', 'C1', createTestGitContext(tempDir));
            await manager.addComment('file1.ts', createTestSelection(), 'T2', 'C2', createTestGitContext(tempDir));
            await manager.addComment('file2.ts', createTestSelection(), 'T3', 'C3', createTestGitContext(tempDir));

            assert.strictEqual(manager.getCommentCountForFile('file1.ts'), 2);
            assert.strictEqual(manager.getCommentCountForFile('file2.ts'), 1);
            assert.strictEqual(manager.getCommentCountForFile('file3.ts'), 0);
        });
    });

    suite('Persistence', () => {
        test('should persist comments to file', async () => {
            await manager.initialize();

            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test text',
                'Test comment',
                createTestGitContext(tempDir)
            );

            const configPath = path.join(tempDir, '.vscode', DIFF_COMMENTS_CONFIG_FILE);
            assert.ok(fs.existsSync(configPath), 'Config file should exist');

            const content = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(content) as DiffCommentsConfig;
            assert.strictEqual(config.comments.length, 1);
            assert.strictEqual(config.comments[0].comment, 'Test comment');
        });

        test('should load comments from file', async () => {
            // Create config file manually
            const vscodePath = path.join(tempDir, '.vscode');
            const configPath = path.join(vscodePath, DIFF_COMMENTS_CONFIG_FILE);

            const config: DiffCommentsConfig = {
                version: 1,
                comments: [
                    {
                        id: 'test_id_123',
                        filePath: 'test.ts',
                        selection: createTestSelection(),
                        selectedText: 'Test text',
                        comment: 'Loaded comment',
                        status: 'open',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        gitContext: createTestGitContext(tempDir)
                    }
                ]
            };

            fs.writeFileSync(configPath, JSON.stringify(config));

            await manager.initialize();
            const comments = manager.getAllComments();
            assert.strictEqual(comments.length, 1);
            assert.strictEqual(comments[0].id, 'test_id_123');
            assert.strictEqual(comments[0].comment, 'Loaded comment');
        });

        test('should handle invalid JSON gracefully', async () => {
            const vscodePath = path.join(tempDir, '.vscode');
            const configPath = path.join(vscodePath, DIFF_COMMENTS_CONFIG_FILE);

            // Write invalid JSON
            fs.writeFileSync(configPath, 'this is not valid json');

            // Should not throw
            await manager.initialize();
            const comments = manager.getAllComments();
            assert.strictEqual(comments.length, 0);
        });

        test('should validate comment structure on load', async () => {
            const vscodePath = path.join(tempDir, '.vscode');
            const configPath = path.join(vscodePath, DIFF_COMMENTS_CONFIG_FILE);

            // Write config with invalid comment
            const config = {
                version: 1,
                comments: [
                    {
                        id: 'valid',
                        filePath: 'test.ts',
                        selection: createTestSelection(),
                        selectedText: 'text',
                        comment: 'valid',
                        status: 'open',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        gitContext: createTestGitContext(tempDir)
                    },
                    { id: 'invalid_missing_fields' }, // Invalid
                    { filePath: 'test.ts', comment: 'missing id' } // Invalid
                ]
            };

            fs.writeFileSync(configPath, JSON.stringify(config));

            await manager.initialize();
            const comments = manager.getAllComments();
            assert.strictEqual(comments.length, 1, 'Only valid comment should be loaded');
            assert.strictEqual(comments[0].id, 'valid');
        });

        test('should persist and restore all comment fields', async () => {
            await manager.initialize();

            const original = await manager.addComment(
                'test.ts',
                createTestSelection('old'),
                'Selected text content',
                'Comment content here',
                createTestGitContext(tempDir),
                undefined,
                'Test Author',
                ['tag1', 'tag2']
            );

            await manager.resolveComment(original.id);

            // Create new manager and reload
            const newManager = new DiffCommentsManager(tempDir);
            await newManager.initialize();

            const loaded = newManager.getComment(original.id);
            assert.ok(loaded);
            assert.strictEqual(loaded.filePath, 'test.ts');
            assert.strictEqual(loaded.selection.side, 'old');
            assert.strictEqual(loaded.selectedText, 'Selected text content');
            assert.strictEqual(loaded.comment, 'Comment content here');
            assert.strictEqual(loaded.author, 'Test Author');
            assert.deepStrictEqual(loaded.tags, ['tag1', 'tag2']);
            assert.strictEqual(loaded.status, 'resolved');
            assert.ok(loaded.createdAt);
            assert.ok(loaded.updatedAt);
            assert.ok(loaded.gitContext);

            newManager.dispose();
        });
    });

    suite('Settings', () => {
        test('should get default settings', async () => {
            await manager.initialize();

            const settings = manager.getSettings();
            assert.deepStrictEqual(settings, DEFAULT_DIFF_COMMENTS_SETTINGS);
        });

        test('should update settings', async () => {
            await manager.initialize();

            await manager.updateSettings({
                showResolved: false,
                highlightColor: 'rgba(255, 0, 0, 0.5)'
            });

            const settings = manager.getSettings();
            assert.strictEqual(settings.showResolved, false);
            assert.strictEqual(settings.highlightColor, 'rgba(255, 0, 0, 0.5)');
        });
    });

    suite('Events', () => {
        test('should fire events on comment changes', async () => {
            await manager.initialize();

            let addedEvent = false;
            let resolvedEvent = false;
            let deletedEvent = false;

            const disposable = manager.onDidChangeComments((event) => {
                if (event.type === 'comment-added') { addedEvent = true; }
                if (event.type === 'comment-resolved') { resolvedEvent = true; }
                if (event.type === 'comment-deleted') { deletedEvent = true; }
            });

            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                'Comment',
                createTestGitContext(tempDir)
            );
            assert.ok(addedEvent);

            await manager.resolveComment(comment.id);
            assert.ok(resolvedEvent);

            await manager.deleteComment(comment.id);
            assert.ok(deletedEvent);

            disposable.dispose();
        });
    });

    suite('Path Handling', () => {
        test('should handle relative and absolute paths', async () => {
            await manager.initialize();

            // Add with absolute path
            const absPath = path.join(tempDir, 'test.ts');
            await manager.addComment(
                absPath,
                createTestSelection(),
                'Test',
                'Comment',
                createTestGitContext(tempDir)
            );

            // Should store as relative path
            const comments = manager.getAllComments();
            assert.strictEqual(comments[0].filePath, 'test.ts');

            // Should find with both relative and absolute paths
            const byRelative = manager.getCommentsForFile('test.ts');
            const byAbsolute = manager.getCommentsForFile(absPath);
            assert.strictEqual(byRelative.length, 1);
            assert.strictEqual(byAbsolute.length, 1);
        });
    });

    suite('Edge Cases', () => {
        test('should handle empty selection text', async () => {
            await manager.initialize();

            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                '',
                'Comment on empty selection',
                createTestGitContext(tempDir)
            );

            assert.ok(comment);
            assert.strictEqual(comment.selectedText, '');
        });

        test('should handle very long comments', async () => {
            await manager.initialize();

            const longComment = 'A'.repeat(10000);
            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                longComment,
                createTestGitContext(tempDir)
            );

            assert.ok(comment);
            assert.strictEqual(comment.comment.length, 10000);
        });

        test('should handle special characters in comments', async () => {
            await manager.initialize();

            const specialComment = 'Special chars: 🎉 <script>alert("xss")</script> \n\t\r émojis';
            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Test',
                specialComment,
                createTestGitContext(tempDir)
            );

            assert.ok(comment);
            assert.strictEqual(comment.comment, specialComment);

            // Save and reload
            const newManager = new DiffCommentsManager(tempDir);
            await newManager.initialize();
            const loaded = newManager.getAllComments()[0];
            assert.strictEqual(loaded.comment, specialComment);
            newManager.dispose();
        });

        test('should handle concurrent comment operations', async () => {
            await manager.initialize();

            // Add comments concurrently
            const promises = [];
            for (let i = 0; i < 20; i++) {
                promises.push(manager.addComment(
                    'test.ts',
                    createTestSelection(),
                    `Text ${i}`,
                    `Comment ${i}`,
                    createTestGitContext(tempDir)
                ));
            }

            const comments = await Promise.all(promises);
            assert.strictEqual(comments.length, 20);

            // All should have unique IDs
            const ids = new Set(comments.map(c => c.id));
            assert.strictEqual(ids.size, 20);
        });

        test('should handle multi-line selections', async () => {
            await manager.initialize();

            const selection: DiffSelection = {
                side: 'new',
                oldStartLine: null,
                oldEndLine: null,
                newStartLine: 1,
                newEndLine: 10,
                startColumn: 5,
                endColumn: 15
            };

            const comment = await manager.addComment(
                'test.ts',
                selection,
                'This is\na multi-line\nselection',
                'Comment on multi-line',
                createTestGitContext(tempDir)
            );

            assert.ok(comment);
            assert.strictEqual(comment.selection.newStartLine, 1);
            assert.strictEqual(comment.selection.newEndLine, 10);
        });

        test('should handle file with many comments', async () => {
            await manager.initialize();

            // Add 100 comments
            for (let i = 0; i < 100; i++) {
                const selection: DiffSelection = {
                    side: 'new',
                    oldStartLine: null,
                    oldEndLine: null,
                    newStartLine: i + 1,
                    newEndLine: i + 1,
                    startColumn: 1,
                    endColumn: 10
                };

                await manager.addComment(
                    'large-file.ts',
                    selection,
                    `Text ${i}`,
                    `Comment ${i}`,
                    createTestGitContext(tempDir)
                );
            }

            const comments = manager.getCommentsForFile('large-file.ts');
            assert.strictEqual(comments.length, 100);

            // Should be sorted by line number
            for (let i = 1; i < comments.length; i++) {
                const prevLine = comments[i - 1].selection.newStartLine ?? 0;
                const currLine = comments[i].selection.newStartLine ?? 0;
                assert.ok(currLine >= prevLine);
            }
        });
    });
});
