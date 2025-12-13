/**
 * Integration tests for Markdown Comments feature with Custom Editor
 * Tests end-to-end workflows and integration with VS Code APIs
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    CommentFileItem,
    CommentItem,
    COMMENTS_CONFIG_FILE,
    CommentsManager,
    MarkdownCommentsTreeDataProvider,
    PromptGenerator
} from '../../shortcuts/markdown-comments';

suite('Markdown Comments Integration Tests', () => {
    let tempDir: string;
    let commentsManager: CommentsManager;
    let testMarkdownFile: string;

    setup(() => {
        // Create temporary directory and test markdown file
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-comments-integration-'));
        testMarkdownFile = path.join(tempDir, 'test-document.md');

        // Ensure .vscode directory exists and has an empty comments file
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        fs.writeFileSync(path.join(vscodePath, COMMENTS_CONFIG_FILE), JSON.stringify({ version: 1, comments: [] }));

        // Create a test markdown file with content
        const markdownContent = `# Test Document

## Introduction

This is a test document for markdown comments integration testing.
It contains multiple paragraphs and sections.

## Section One

Lorem ipsum dolor sit amet, consectetur adipiscing elit.
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.

## Section Two

Another section with some content that can be commented on.
Multiple lines help test multi-line comment functionality.

### Subsection

Nested content for deeper testing.

## Conclusion

Final thoughts and summary of the document.
`;
        fs.writeFileSync(testMarkdownFile, markdownContent);

        commentsManager = new CommentsManager(tempDir);
    });

    teardown(() => {
        commentsManager.dispose();
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Full Comment Workflow', () => {
        test('should complete full add-edit-resolve-delete workflow', async () => {
            await commentsManager.initialize();

            // Step 1: Add a comment
            const comment = await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 5, startColumn: 1, endLine: 5, endColumn: 50 },
                'This is a test document for markdown comments integration testing.',
                'Should clarify what specific aspects are being tested',
                'Tester',
                ['integration', 'documentation']
            );

            assert.ok(comment.id);
            assert.strictEqual(commentsManager.getOpenCommentCount(), 1);

            // Step 2: Edit the comment
            const edited = await commentsManager.updateComment(comment.id, {
                comment: 'Updated: Should add more specific test scenarios'
            });
            assert.strictEqual(edited?.comment, 'Updated: Should add more specific test scenarios');

            // Step 3: Resolve the comment
            const resolved = await commentsManager.resolveComment(comment.id);
            assert.strictEqual(resolved?.status, 'resolved');
            assert.strictEqual(commentsManager.getOpenCommentCount(), 0);
            assert.strictEqual(commentsManager.getResolvedCommentCount(), 1);

            // Step 4: Reopen the comment
            const reopened = await commentsManager.reopenComment(comment.id);
            assert.strictEqual(reopened?.status, 'open');
            assert.strictEqual(commentsManager.getOpenCommentCount(), 1);

            // Step 5: Delete the comment
            const deleted = await commentsManager.deleteComment(comment.id);
            assert.strictEqual(deleted, true);
            assert.strictEqual(commentsManager.getAllComments().length, 0);
        });

        test('should handle multiple comments across multiple files', async () => {
            await commentsManager.initialize();

            // Create additional test files
            const file2 = path.join(tempDir, 'second-doc.md');
            const file3 = path.join(tempDir, 'third-doc.md');
            fs.writeFileSync(file2, '# Second Document\n\nContent here.');
            fs.writeFileSync(file3, '# Third Document\n\nMore content.');

            // Add comments to different files
            await commentsManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 15 }, 'Test Document', 'Title comment');
            await commentsManager.addComment(testMarkdownFile, { startLine: 10, startColumn: 1, endLine: 10, endColumn: 30 }, 'Lorem ipsum', 'Section 1 comment');
            await commentsManager.addComment(file2, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 17 }, 'Second Document', 'File 2 comment');
            await commentsManager.addComment(file3, { startLine: 3, startColumn: 1, endLine: 3, endColumn: 13 }, 'More content', 'File 3 comment');

            // Verify grouping
            const grouped = commentsManager.getCommentsGroupedByFile();
            assert.strictEqual(grouped.size, 3);

            // Verify file comments
            const testFileComments = commentsManager.getCommentsForFile(testMarkdownFile);
            assert.strictEqual(testFileComments.length, 2);

            // Verify total count
            assert.strictEqual(commentsManager.getAllComments().length, 4);
        });
    });

    suite('Tree Data Provider Integration', () => {
        test('should update tree when comments change', async () => {
            await commentsManager.initialize();
            const treeProvider = new MarkdownCommentsTreeDataProvider(commentsManager);

            // Initially empty
            let children = await treeProvider.getChildren();
            assert.strictEqual(children.length, 0);

            // Add comment
            const comment = await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
                'Test text',
                'Test comment'
            );

            // Wait for event propagation
            await new Promise(resolve => setTimeout(resolve, 100));

            // Should now have file item
            children = await treeProvider.getChildren();
            assert.strictEqual(children.length, 1);
            assert.ok(children[0] instanceof CommentFileItem);

            // Get comment items under file
            const commentItems = await treeProvider.getChildren(children[0]);
            assert.strictEqual(commentItems.length, 1);
            assert.ok(commentItems[0] instanceof CommentItem);

            // Resolve and check filtering
            await commentsManager.resolveComment(comment.id);
            treeProvider.setShowResolved(false);
            children = await treeProvider.getChildren();
            assert.strictEqual(children.length, 0, 'Should hide file when all comments resolved and hiding resolved');

            treeProvider.dispose();
        });

        test('should navigate to comment location', async () => {
            await commentsManager.initialize();
            const treeProvider = new MarkdownCommentsTreeDataProvider(commentsManager);

            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 10, startColumn: 1, endLine: 10, endColumn: 20 },
                'Lorem ipsum',
                'Navigate test'
            );

            const fileItems = await treeProvider.getChildren();
            const commentItems = await treeProvider.getChildren(fileItems[0]) as CommentItem[];

            // Verify comment item has correct command
            const commentItem = commentItems[0];
            assert.ok(commentItem.command);
            assert.strictEqual(commentItem.command.command, 'markdownComments.goToComment');
            assert.ok(commentItem.command.arguments);
            assert.strictEqual(commentItem.command.arguments[0], commentItem);

            treeProvider.dispose();
        });
    });

    suite('Prompt Generation Integration', () => {
        test('should generate comprehensive prompt from multiple comments', async () => {
            await commentsManager.initialize();
            const promptGenerator = new PromptGenerator(commentsManager);

            // Add multiple comments with different characteristics
            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 1, startColumn: 1, endLine: 1, endColumn: 15 },
                '# Test Document',
                'Consider using a more descriptive title',
                'Reviewer 1',
                ['title', 'improvement']
            );

            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 5, startColumn: 1, endLine: 6, endColumn: 40 },
                'This is a test document for markdown comments integration testing.\nIt contains multiple paragraphs and sections.',
                'Should add more context about the purpose',
                'Reviewer 2'
            );

            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 20, startColumn: 1, endLine: 20, endColumn: 35 },
                'Nested content for deeper testing.',
                'Add code examples in this section'
            );

            const prompt = promptGenerator.generatePrompt({
                groupByFile: true,
                includeLineNumbers: true,
                outputFormat: 'markdown'
            });

            // Verify prompt structure
            assert.ok(prompt.includes('# Document Revision Request'), 'Should have title');
            assert.ok(prompt.includes('test-document.md'), 'Should include file name');
            assert.ok(prompt.includes('Line 1'), 'Should include line number for first comment');
            assert.ok(prompt.includes('Lines 5-6'), 'Should include line range for multi-line');
            assert.ok(prompt.includes('Consider using a more descriptive title'), 'Should include comment content');
            assert.ok(prompt.includes('# Test Document'), 'Should include selected text');

            // Verify JSON format
            const jsonPrompt = promptGenerator.generatePrompt({ outputFormat: 'json' });
            const parsed = JSON.parse(jsonPrompt);
            assert.ok(parsed.files);
            assert.strictEqual(parsed.files.length, 1);
            assert.strictEqual(parsed.files[0].comments.length, 3);
        });

        test('should handle prompt generation with file content', async () => {
            await commentsManager.initialize();
            const promptGenerator = new PromptGenerator(commentsManager);

            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 1, startColumn: 1, endLine: 1, endColumn: 15 },
                '# Test Document',
                'Review this'
            );

            const promptWithContent = promptGenerator.generatePrompt({
                includeFullFileContent: true,
                outputFormat: 'markdown'
            });

            // Should include file content
            assert.ok(promptWithContent.includes('### Full File Content'));
            assert.ok(promptWithContent.includes('## Introduction'));
            assert.ok(promptWithContent.includes('## Section One'));
        });

        test('should split large prompts correctly', async () => {
            await commentsManager.initialize();
            const promptGenerator = new PromptGenerator(commentsManager);

            // Add many comments
            for (let i = 0; i < 15; i++) {
                await commentsManager.addComment(
                    testMarkdownFile,
                    { startLine: i + 1, startColumn: 1, endLine: i + 1, endColumn: 10 },
                    `Text ${i}`,
                    `Comment ${i}`
                );
            }

            const prompts = promptGenerator.generatePrompts({ maxCommentsPerPrompt: 5 });

            assert.strictEqual(prompts.length, 3);

            // Each prompt should have proper part numbering
            assert.ok(prompts[0].includes('Part 1 of 3'));
            assert.ok(prompts[1].includes('Part 2 of 3'));
            assert.ok(prompts[2].includes('Part 3 of 3'));
        });
    });

    suite('Persistence and Reload', () => {
        test('should persist and reload comments across manager instances', async () => {
            await commentsManager.initialize();

            // Add comments
            const c1 = await commentsManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'Text 1', 'Comment 1', 'Author 1', ['tag1']);
            const c2 = await commentsManager.addComment(testMarkdownFile, { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 }, 'Text 2', 'Comment 2');
            await commentsManager.resolveComment(c2.id);

            commentsManager.dispose();

            // Create new manager and reload
            const newManager = new CommentsManager(tempDir);
            await newManager.initialize();

            // Verify comments loaded
            assert.strictEqual(newManager.getAllComments().length, 2);
            assert.strictEqual(newManager.getOpenCommentCount(), 1);
            assert.strictEqual(newManager.getResolvedCommentCount(), 1);

            const loaded1 = newManager.getComment(c1.id);
            assert.ok(loaded1);
            assert.strictEqual(loaded1.comment, 'Comment 1');
            assert.strictEqual(loaded1.author, 'Author 1');
            assert.deepStrictEqual(loaded1.tags, ['tag1']);

            const loaded2 = newManager.getComment(c2.id);
            assert.ok(loaded2);
            assert.strictEqual(loaded2.status, 'resolved');

            newManager.dispose();
        });

        test('should handle config file deletion', async () => {
            await commentsManager.initialize();

            await commentsManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'Test', 'Comment');
            assert.strictEqual(commentsManager.getAllComments().length, 1);

            // Delete config file
            const configPath = commentsManager.getConfigPath();
            fs.unlinkSync(configPath);

            // Reload - should start fresh
            await commentsManager.loadComments();

            // Wait for file watcher event
            await new Promise(resolve => setTimeout(resolve, 500));

            assert.strictEqual(commentsManager.getAllComments().length, 0);
        });
    });

    suite('Event System', () => {
        test('should emit events in correct order during workflow', async () => {
            await commentsManager.initialize();

            const events: string[] = [];
            const disposable = commentsManager.onDidChangeComments((event) => {
                events.push(event.type);
            });

            // Perform operations
            const comment = await commentsManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'T', 'C');
            await commentsManager.updateComment(comment.id, { comment: 'Updated' });
            await commentsManager.resolveComment(comment.id);
            await commentsManager.reopenComment(comment.id);
            await commentsManager.deleteComment(comment.id);

            assert.deepStrictEqual(events, [
                'comment-added',
                'comment-updated',
                'comment-resolved',
                'comment-reopened',
                'comment-deleted'
            ]);

            disposable.dispose();
        });

        test('should include comment in event data', async () => {
            await commentsManager.initialize();

            let capturedComment: any;
            const disposable = commentsManager.onDidChangeComments((event) => {
                if (event.type === 'comment-added') {
                    capturedComment = event.comment;
                }
            });

            const comment = await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
                'Test text',
                'Test comment'
            );

            assert.ok(capturedComment);
            assert.strictEqual(capturedComment.id, comment.id);
            assert.strictEqual(capturedComment.comment, 'Test comment');

            disposable.dispose();
        });
    });

    suite('Position Queries', () => {
        test('should find overlapping comments at position', async () => {
            await commentsManager.initialize();

            // Add overlapping comments
            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 5, startColumn: 1, endLine: 10, endColumn: 50 },
                'Large selection',
                'First comment'
            );

            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 7, startColumn: 10, endLine: 8, endColumn: 20 },
                'Nested selection',
                'Second comment'
            );

            // Position within both
            const atLine7 = commentsManager.getCommentsAtPosition(testMarkdownFile, 7, 15);
            assert.strictEqual(atLine7.length, 2);

            // Position only in first
            const atLine5 = commentsManager.getCommentsAtPosition(testMarkdownFile, 5, 5);
            assert.strictEqual(atLine5.length, 1);
            assert.strictEqual(atLine5[0].comment, 'First comment');

            // Position outside both
            const atLine15 = commentsManager.getCommentsAtPosition(testMarkdownFile, 15, 5);
            assert.strictEqual(atLine15.length, 0);
        });
    });

    suite('Settings Integration', () => {
        test('should persist settings with comments', async () => {
            await commentsManager.initialize();

            // Update settings
            await commentsManager.updateSettings({
                showResolved: false,
                highlightColor: 'rgba(100, 100, 255, 0.5)'
            });

            // Add a comment to trigger save
            await commentsManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'T', 'C');

            // Reload in new manager
            const newManager = new CommentsManager(tempDir);
            await newManager.initialize();

            const settings = newManager.getSettings();
            assert.strictEqual(settings?.showResolved, false);
            assert.strictEqual(settings?.highlightColor, 'rgba(100, 100, 255, 0.5)');

            newManager.dispose();
        });
    });

    suite('Error Recovery', () => {
        test('should recover from corrupted config file', async () => {
            await commentsManager.initialize();

            // Add a valid comment
            await commentsManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'Test', 'Comment');
            commentsManager.dispose();

            // Corrupt the file
            const configPath = path.join(tempDir, '.vscode', 'md-comments.json');
            fs.writeFileSync(configPath, '{ invalid json content }}}}}');

            // New manager should recover
            const newManager = new CommentsManager(tempDir);
            await newManager.initialize();

            // Should have empty comments (recovery state)
            assert.strictEqual(newManager.getAllComments().length, 0);

            // Should be able to add new comments
            const newComment = await newManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'New', 'After recovery');
            assert.ok(newComment);

            newManager.dispose();
        });

        test('should handle read-only config file gracefully', async function () {
            // Skip on Windows where file permissions work differently
            if (process.platform === 'win32') {
                this.skip();
                return;
            }

            await commentsManager.initialize();

            // Create config file
            await commentsManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'Test', 'Comment');

            // Make it read-only
            const configPath = commentsManager.getConfigPath();
            fs.chmodSync(configPath, 0o444);

            try {
                // This should throw but not crash
                await assert.rejects(
                    async () => {
                        await commentsManager.addComment(testMarkdownFile, { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 }, 'Test2', 'Comment2');
                    }
                );
            } finally {
                // Restore write permissions for cleanup
                fs.chmodSync(configPath, 0o644);
            }
        });
    });

    suite('Bulk Operations', () => {
        test('should efficiently handle bulk resolve', async () => {
            await commentsManager.initialize();

            // Add many comments
            const startTime = Date.now();
            for (let i = 0; i < 50; i++) {
                await commentsManager.addComment(
                    testMarkdownFile,
                    { startLine: i + 1, startColumn: 1, endLine: i + 1, endColumn: 10 },
                    `Text ${i}`,
                    `Comment ${i}`
                );
            }

            assert.strictEqual(commentsManager.getOpenCommentCount(), 50);

            // Bulk resolve
            const count = await commentsManager.resolveAllComments();
            assert.strictEqual(count, 50);
            assert.strictEqual(commentsManager.getOpenCommentCount(), 0);
            assert.strictEqual(commentsManager.getResolvedCommentCount(), 50);

            const totalTime = Date.now() - startTime;
            console.log(`Bulk operations completed in ${totalTime}ms`);
        });

        test('should delete all comments', async () => {
            await commentsManager.initialize();

            // Add multiple comments
            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                'Text 1',
                'Comment 1'
            );
            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 },
                'Text 2',
                'Comment 2'
            );
            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 10, startColumn: 1, endLine: 10, endColumn: 10 },
                'Text 3',
                'Comment 3'
            );

            assert.strictEqual(commentsManager.getAllComments().length, 3);

            // Delete all
            const count = await commentsManager.deleteAllComments();
            assert.strictEqual(count, 3);
            assert.strictEqual(commentsManager.getAllComments().length, 0);
        });

        test('should return 0 when deleting all from empty comments', async () => {
            await commentsManager.initialize();

            // No comments to delete
            assert.strictEqual(commentsManager.getAllComments().length, 0);

            const count = await commentsManager.deleteAllComments();
            assert.strictEqual(count, 0);
            assert.strictEqual(commentsManager.getAllComments().length, 0);
        });

        test('should delete all comments including resolved ones', async () => {
            await commentsManager.initialize();

            // Add comments with different statuses
            const c1 = await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                'Text 1',
                'Open comment'
            );
            const c2 = await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 },
                'Text 2',
                'To be resolved'
            );
            await commentsManager.resolveComment(c2.id);

            assert.strictEqual(commentsManager.getOpenCommentCount(), 1);
            assert.strictEqual(commentsManager.getResolvedCommentCount(), 1);
            assert.strictEqual(commentsManager.getAllComments().length, 2);

            // Delete all should remove both open and resolved comments
            const count = await commentsManager.deleteAllComments();
            assert.strictEqual(count, 2);
            assert.strictEqual(commentsManager.getAllComments().length, 0);
            assert.strictEqual(commentsManager.getOpenCommentCount(), 0);
            assert.strictEqual(commentsManager.getResolvedCommentCount(), 0);
        });

        test('should emit comments-loaded event after delete all', async () => {
            await commentsManager.initialize();

            // Add a comment
            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                'Text',
                'Comment'
            );

            let eventFired = false;
            let eventComments: any[] = [];
            const disposable = commentsManager.onDidChangeComments((event) => {
                if (event.type === 'comments-loaded') {
                    eventFired = true;
                    eventComments = event.comments || [];
                }
            });

            await commentsManager.deleteAllComments();

            assert.strictEqual(eventFired, true, 'Should fire comments-loaded event');
            assert.strictEqual(eventComments.length, 0, 'Event should have empty comments array');

            disposable.dispose();
        });

        test('should persist delete all across manager instances', async () => {
            await commentsManager.initialize();

            // Add comments
            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                'Text 1',
                'Comment 1'
            );
            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 },
                'Text 2',
                'Comment 2'
            );

            // Delete all
            await commentsManager.deleteAllComments();
            commentsManager.dispose();

            // Create new manager and verify
            const newManager = new CommentsManager(tempDir);
            await newManager.initialize();

            assert.strictEqual(newManager.getAllComments().length, 0, 'Delete all should persist');

            newManager.dispose();
        });
    });

    suite('Review Editor View Integration', () => {
        test('should register Review Editor View for .md files', async () => {
            // The Review Editor View provider should be registered
            // We can verify this by checking if the command exists
            const commands = await vscode.commands.getCommands();
            assert.ok(
                commands.includes('markdownComments.openWithReviewEditor'),
                'Review Editor View open command should be registered'
            );
        });

        test('should sync comments with Review Editor View', async () => {
            await commentsManager.initialize();

            // Add a comment
            const comment = await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
                'Test text',
                'Test comment for Review Editor sync'
            );

            // Verify the comment is accessible
            const fileComments = commentsManager.getCommentsForFile(testMarkdownFile);
            assert.strictEqual(fileComments.length, 1);
            assert.strictEqual(fileComments[0].id, comment.id);

            // Comments should be available after reload
            commentsManager.dispose();
            const newManager = new CommentsManager(tempDir);
            await newManager.initialize();

            const reloadedComments = newManager.getCommentsForFile(testMarkdownFile);
            assert.strictEqual(reloadedComments.length, 1);
            assert.strictEqual(reloadedComments[0].comment, 'Test comment for Review Editor sync');

            newManager.dispose();
        });

        test('should have all required Review Editor View commands registered', async () => {
            const commands = await vscode.commands.getCommands();

            // Core commands for Review Editor View
            const requiredCommands = [
                'markdownComments.openWithReviewEditor',
                'markdownComments.resolveComment',
                'markdownComments.reopenComment',
                'markdownComments.deleteComment',
                'markdownComments.resolveAll',
                'markdownComments.generatePrompt',
                'markdownComments.generateAndCopyPrompt',
                'markdownComments.goToComment',
                'markdownComments.toggleShowResolved',
                'markdownComments.refresh',
                'markdownComments.openConfig'
            ];

            for (const cmd of requiredCommands) {
                assert.ok(
                    commands.includes(cmd),
                    `Command ${cmd} should be registered`
                );
            }
        });

        test('should NOT have obsolete decoration-based commands', async () => {
            const commands = await vscode.commands.getCommands();

            // These commands were removed in favor of Review Editor View
            const obsoleteCommands = [
                'markdownComments.addComment',  // Now handled in webview
                'markdownComments.editComment'   // Now handled in webview
            ];

            for (const cmd of obsoleteCommands) {
                assert.ok(
                    !commands.includes(cmd),
                    `Obsolete command ${cmd} should NOT be registered`
                );
            }
        });
    });

    suite('Comments Data Flow for Review Editor', () => {
        test('should provide comments grouped by file for tree view', async () => {
            await commentsManager.initialize();

            // Add comments to multiple files
            await commentsManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'T1', 'Comment in file 1');

            const file2 = path.join(tempDir, 'second.md');
            fs.writeFileSync(file2, '# Second Document\n\nContent here.');
            await commentsManager.addComment(file2, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'T2', 'Comment in file 2');
            await commentsManager.addComment(testMarkdownFile, { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 }, 'T3', 'Another comment in file 1');

            const grouped = commentsManager.getCommentsGroupedByFile();
            assert.strictEqual(grouped.size, 2, 'Should have 2 files with comments');

            // Check file 1 has 2 comments
            let file1Comments = 0;
            grouped.forEach((comments, filePath) => {
                if (filePath.includes('test-document.md')) {
                    file1Comments = comments.length;
                }
            });
            assert.strictEqual(file1Comments, 2, 'File 1 should have 2 comments');
        });

        test('should filter comments by status for Review Editor display', async () => {
            await commentsManager.initialize();

            const c1 = await commentsManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'T1', 'Open comment');
            await commentsManager.addComment(testMarkdownFile, { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 }, 'T2', 'Resolved comment');
            await commentsManager.resolveComment(c1.id);

            const allComments = commentsManager.getCommentsForFile(testMarkdownFile);
            assert.strictEqual(allComments.length, 2);

            const openComments = allComments.filter(c => c.status === 'open');
            const resolvedComments = allComments.filter(c => c.status === 'resolved');

            assert.strictEqual(openComments.length, 1);
            assert.strictEqual(resolvedComments.length, 1);
        });

        test('should emit events for Review Editor View to update UI', async () => {
            await commentsManager.initialize();

            const events: string[] = [];
            const disposable = commentsManager.onDidChangeComments((event) => {
                events.push(event.type);
            });

            // Simulate actions that would be triggered from Review Editor View
            const comment = await commentsManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'Text', 'Comment');
            await commentsManager.updateComment(comment.id, { comment: 'Updated via Review Editor' });
            await commentsManager.resolveComment(comment.id);
            await commentsManager.deleteComment(comment.id);

            assert.deepStrictEqual(events, [
                'comment-added',
                'comment-updated',
                'comment-resolved',
                'comment-deleted'
            ]);

            disposable.dispose();
        });
    });

    suite('Review Editor View Prompt Generation', () => {
        test('should generate prompt for Review Editor View toolbar action', async () => {
            await commentsManager.initialize();

            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 5, startColumn: 1, endLine: 5, endColumn: 50 },
                'This is a test document',
                'Add more context here'
            );
            await commentsManager.addComment(
                testMarkdownFile,
                { startLine: 10, startColumn: 1, endLine: 10, endColumn: 30 },
                'Lorem ipsum',
                'Expand this section'
            );

            const promptGenerator = new PromptGenerator(commentsManager);
            const prompt = promptGenerator.generatePrompt({
                includeFullFileContent: false,
                groupByFile: true,
                includeLineNumbers: true,
                outputFormat: 'markdown'
            });

            // Verify prompt contains both comments
            assert.ok(prompt.includes('Add more context here'));
            assert.ok(prompt.includes('Expand this section'));
            // Single line selections use "Line X" format, not "Lines X"
            assert.ok(prompt.includes('Line 5') || prompt.includes('Lines 5'));
            assert.ok(prompt.includes('Line 10') || prompt.includes('Lines 10'));
        });

        test('should exclude resolved comments from prompt', async () => {
            await commentsManager.initialize();

            const c1 = await commentsManager.addComment(testMarkdownFile, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }, 'Text1', 'Open comment');
            const c2 = await commentsManager.addComment(testMarkdownFile, { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 }, 'Text2', 'Resolved comment');

            await commentsManager.resolveComment(c2.id);

            const promptGenerator = new PromptGenerator(commentsManager);
            const prompt = promptGenerator.generatePrompt({
                includeFullFileContent: false,
                groupByFile: true,
                includeLineNumbers: true,
                outputFormat: 'markdown'
            });

            assert.ok(prompt.includes('Open comment'));
            assert.ok(!prompt.includes('Resolved comment'));
        });
    });
});
