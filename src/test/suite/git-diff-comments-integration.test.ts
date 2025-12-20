/**
 * Integration tests for Git Diff Comments feature
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DIFF_COMMENTS_CONFIG_FILE,
    DiffCommentsConfig,
    DiffCommentsManager,
    DiffGitContext,
    DiffSelection,
    DiffComment,
    createDiffAnchor,
    relocateDiffAnchor,
    needsDiffRelocation
} from '../../shortcuts/git-diff-comments';

/**
 * Helper to create a test workspace
 */
function createTestWorkspace(): string {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-diff-comments-integration-'));
    const vscodePath = path.join(tempDir, '.vscode');
    fs.mkdirSync(vscodePath, { recursive: true });
    return tempDir;
}

/**
 * Helper to create a test git context
 */
function createTestGitContext(workspaceRoot: string): DiffGitContext {
    return {
        repositoryRoot: workspaceRoot,
        repositoryName: 'test-repo',
        oldRef: 'HEAD',
        newRef: ':0',
        wasStaged: true
    };
}

/**
 * Helper to create a test selection
 */
function createTestSelection(
    side: 'old' | 'new' = 'new',
    startLine: number = 1,
    endLine: number = 1
): DiffSelection {
    if (side === 'old') {
        return {
            side: 'old',
            oldStartLine: startLine,
            oldEndLine: endLine,
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
        newStartLine: startLine,
        newEndLine: endLine,
        startColumn: 1,
        endColumn: 10
    };
}

suite('Git Diff Comments Integration Tests', () => {
    let workspaceRoot: string;
    let manager: DiffCommentsManager;

    setup(() => {
        workspaceRoot = createTestWorkspace();
        manager = new DiffCommentsManager(workspaceRoot);
    });

    teardown(() => {
        manager.dispose();
        if (fs.existsSync(workspaceRoot)) {
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
    });

    suite('End-to-End Comment Workflow', () => {
        test('should complete full comment lifecycle', async () => {
            await manager.initialize();

            // 1. Add a comment
            const comment = await manager.addComment(
                'src/app.ts',
                createTestSelection('new', 10, 15),
                'function handleClick() {\n  // TODO: implement\n}',
                'This function needs proper error handling',
                createTestGitContext(workspaceRoot),
                undefined,
                'Developer',
                ['review', 'error-handling']
            );

            assert.ok(comment.id);
            assert.strictEqual(comment.status, 'open');

            // 2. Update the comment
            const updated = await manager.updateComment(comment.id, {
                comment: 'This function needs proper error handling. Consider try-catch blocks.'
            });
            assert.ok(updated);
            assert.ok(updated.comment.includes('try-catch'));

            // 3. Resolve the comment
            const resolved = await manager.resolveComment(comment.id);
            assert.ok(resolved);
            assert.strictEqual(resolved.status, 'resolved');

            // 4. Reopen the comment
            const reopened = await manager.reopenComment(comment.id);
            assert.ok(reopened);
            assert.strictEqual(reopened.status, 'open');

            // 5. Delete the comment
            const deleted = await manager.deleteComment(comment.id);
            assert.strictEqual(deleted, true);
            assert.strictEqual(manager.getAllComments().length, 0);
        });

        test('should handle multiple files with comments', async () => {
            await manager.initialize();

            const files = ['src/app.ts', 'src/utils.ts', 'src/components/Button.tsx'];
            const gitContext = createTestGitContext(workspaceRoot);

            // Add comments to multiple files
            for (const file of files) {
                for (let i = 0; i < 3; i++) {
                    await manager.addComment(
                        file,
                        createTestSelection('new', i + 1, i + 1),
                        `Code at line ${i + 1}`,
                        `Comment ${i + 1} for ${file}`,
                        gitContext
                    );
                }
            }

            // Verify counts
            assert.strictEqual(manager.getAllComments().length, 9);
            assert.strictEqual(manager.getFilesWithComments().length, 3);

            for (const file of files) {
                assert.strictEqual(manager.getCommentsForFile(file).length, 3);
            }
        });

        test('should persist and reload comments across sessions', async () => {
            await manager.initialize();

            const gitContext = createTestGitContext(workspaceRoot);

            // Add comments
            const c1 = await manager.addComment(
                'file1.ts',
                createTestSelection('new', 1),
                'Text 1',
                'Comment 1',
                gitContext,
                undefined,
                'Author 1',
                ['tag1']
            );

            const c2 = await manager.addComment(
                'file2.ts',
                createTestSelection('old', 5),
                'Text 2',
                'Comment 2',
                gitContext,
                undefined,
                'Author 2',
                ['tag2']
            );

            await manager.resolveComment(c1.id);

            // Dispose and create new manager
            manager.dispose();
            manager = new DiffCommentsManager(workspaceRoot);
            await manager.initialize();

            // Verify persistence
            const comments = manager.getAllComments();
            assert.strictEqual(comments.length, 2);

            const loaded1 = manager.getComment(c1.id);
            assert.ok(loaded1);
            assert.strictEqual(loaded1.status, 'resolved');
            assert.strictEqual(loaded1.author, 'Author 1');
            assert.deepStrictEqual(loaded1.tags, ['tag1']);

            const loaded2 = manager.getComment(c2.id);
            assert.ok(loaded2);
            assert.strictEqual(loaded2.selection.side, 'old');
            assert.strictEqual(loaded2.author, 'Author 2');
        });
    });

    suite('Comment Relocation Integration', () => {
        test('should relocate comments when file content changes', async () => {
            await manager.initialize();

            const originalContent = `function test() {
    const x = 1;
    const y = 2;
    return x + y;
}`;

            const selection = createTestSelection('new', 3, 3);
            const selectedText = '    const y = 2;';

            const comment = await manager.addComment(
                'test.ts',
                selection,
                selectedText,
                'This variable should be renamed',
                createTestGitContext(workspaceRoot),
                originalContent
            );

            // Simulate content change (new lines inserted)
            const newContent = `function test() {
    const x = 1;
    // New comment line
    const y = 2;
    return x + y;
}`;

            // Check if relocation is needed
            const anchor = comment.anchor;
            if (anchor) {
                const needs = needsDiffRelocation(newContent, anchor, 3, 3, 1, 17);
                assert.strictEqual(needs, true);

                // Relocate
                const result = relocateDiffAnchor(newContent, anchor, 'new');
                assert.strictEqual(result.found, true);
                if (result.selection?.side === 'new') {
                    assert.strictEqual(result.selection?.newStartLine, 4);
                }
            }
        });

        test('should handle comment on deleted line', async () => {
            await manager.initialize();

            const originalContent = `line 1
line 2
line 3
line 4
line 5`;

            const selection = createTestSelection('new', 3, 3);
            const selectedText = 'line 3';

            const comment = await manager.addComment(
                'test.ts',
                selection,
                selectedText,
                'Comment on line 3',
                createTestGitContext(workspaceRoot),
                originalContent
            );

            // Line 3 is deleted
            const newContent = `line 1
line 2
line 4
line 5`;

            const anchor = comment.anchor;
            if (anchor) {
                const result = relocateDiffAnchor(newContent, anchor, 'new');
                // Should either not find or fall back to line
                if (result.found) {
                    assert.strictEqual(result.reason, 'line_fallback');
                } else {
                    assert.strictEqual(result.reason, 'not_found');
                }
            }
        });
    });

    suite('Grouped Comments', () => {
        test('should group comments by file correctly', async () => {
            await manager.initialize();

            const gitContext = createTestGitContext(workspaceRoot);

            await manager.addComment('a.ts', createTestSelection(), 'T', 'C1', gitContext);
            await manager.addComment('b.ts', createTestSelection(), 'T', 'C2', gitContext);
            await manager.addComment('a.ts', createTestSelection(), 'T', 'C3', gitContext);
            await manager.addComment('c.ts', createTestSelection(), 'T', 'C4', gitContext);
            await manager.addComment('a.ts', createTestSelection(), 'T', 'C5', gitContext);

            const grouped = manager.getCommentsGroupedByFile();

            assert.strictEqual(grouped.size, 3);
            assert.strictEqual(grouped.get('a.ts')?.length, 3);
            assert.strictEqual(grouped.get('b.ts')?.length, 1);
            assert.strictEqual(grouped.get('c.ts')?.length, 1);
        });

        test('should resolve all comments for a specific file', async () => {
            await manager.initialize();

            const gitContext = createTestGitContext(workspaceRoot);

            await manager.addComment('target.ts', createTestSelection(), 'T', 'C1', gitContext);
            await manager.addComment('target.ts', createTestSelection(), 'T', 'C2', gitContext);
            await manager.addComment('other.ts', createTestSelection(), 'T', 'C3', gitContext);

            // Resolve all in target.ts
            const comments = manager.getCommentsForFile('target.ts');
            for (const comment of comments) {
                await manager.resolveComment(comment.id);
            }

            // Check
            const targetComments = manager.getCommentsForFile('target.ts');
            assert.ok(targetComments.every(c => c.status === 'resolved'));

            const otherComments = manager.getCommentsForFile('other.ts');
            assert.ok(otherComments.every(c => c.status === 'open'));
        });
    });

    suite('Event Handling', () => {
        test('should fire events for all operations', async () => {
            await manager.initialize();

            const events: string[] = [];
            const disposable = manager.onDidChangeComments((event) => {
                events.push(event.type);
            });

            const gitContext = createTestGitContext(workspaceRoot);

            // Add
            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Text',
                'Comment',
                gitContext
            );

            // Update
            await manager.updateComment(comment.id, { comment: 'Updated' });

            // Resolve
            await manager.resolveComment(comment.id);

            // Reopen
            await manager.reopenComment(comment.id);

            // Delete
            await manager.deleteComment(comment.id);

            disposable.dispose();

            assert.ok(events.includes('comment-added'));
            assert.ok(events.includes('comment-updated'));
            assert.ok(events.includes('comment-resolved'));
            assert.ok(events.includes('comment-reopened'));
            assert.ok(events.includes('comment-deleted'));
        });
    });

    suite('Settings Integration', () => {
        test('should apply custom settings', async () => {
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

    suite('Error Handling', () => {
        test('should handle corrupted config file', async () => {
            const configPath = path.join(workspaceRoot, '.vscode', DIFF_COMMENTS_CONFIG_FILE);
            fs.writeFileSync(configPath, 'not valid json {{{');

            // Should not throw
            await manager.initialize();
            const comments = manager.getAllComments();
            assert.strictEqual(comments.length, 0);
        });

        test('should handle missing .vscode directory', async () => {
            const vscodePath = path.join(workspaceRoot, '.vscode');
            fs.rmSync(vscodePath, { recursive: true, force: true });

            await manager.initialize();

            // Adding a comment should create the directory
            await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Text',
                'Comment',
                createTestGitContext(workspaceRoot)
            );

            assert.ok(fs.existsSync(vscodePath));
        });

        test('should handle read-only config file gracefully', async function() {
            // Skip on Windows as file permissions work differently
            if (process.platform === 'win32') {
                this.skip();
                return;
            }

            const configPath = path.join(workspaceRoot, '.vscode', DIFF_COMMENTS_CONFIG_FILE);
            fs.writeFileSync(configPath, JSON.stringify({ version: 1, comments: [] }));
            fs.chmodSync(configPath, 0o444); // Read-only

            await manager.initialize();

            // Should handle gracefully (may throw or log error)
            try {
                await manager.addComment(
                    'test.ts',
                    createTestSelection(),
                    'Text',
                    'Comment',
                    createTestGitContext(workspaceRoot)
                );
            } catch (error) {
                // Expected to fail
                assert.ok(error);
            } finally {
                // Restore permissions for cleanup
                fs.chmodSync(configPath, 0o644);
            }
        });
    });

    suite('Concurrent Operations', () => {
        test('should handle concurrent comment additions', async () => {
            await manager.initialize();

            const gitContext = createTestGitContext(workspaceRoot);
            const promises: Promise<DiffComment>[] = [];

            // Add 50 comments concurrently
            for (let i = 0; i < 50; i++) {
                promises.push(manager.addComment(
                    `file${i % 5}.ts`,
                    createTestSelection('new', i + 1),
                    `Text ${i}`,
                    `Comment ${i}`,
                    gitContext
                ));
            }

            const comments = await Promise.all(promises);

            // All should succeed
            assert.strictEqual(comments.length, 50);

            // All should have unique IDs
            const ids = new Set(comments.map(c => c.id));
            assert.strictEqual(ids.size, 50);

            // All should be persisted
            const allComments = manager.getAllComments();
            assert.strictEqual(allComments.length, 50);
        });

        test('should handle concurrent updates to same comment', async () => {
            await manager.initialize();

            const comment = await manager.addComment(
                'test.ts',
                createTestSelection(),
                'Text',
                'Original',
                createTestGitContext(workspaceRoot)
            );

            // Update concurrently
            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(manager.updateComment(comment.id, {
                    comment: `Update ${i}`
                }));
            }

            await Promise.all(promises);

            // Comment should exist and have one of the updates
            const updated = manager.getComment(comment.id);
            assert.ok(updated);
            assert.ok(updated.comment.startsWith('Update'));
        });
    });

    suite('Large Scale Operations', () => {
        test('should handle many comments efficiently', async function() {
            this.timeout(10000);

            await manager.initialize();

            const gitContext = createTestGitContext(workspaceRoot);
            const start = Date.now();

            // Add 500 comments
            for (let i = 0; i < 500; i++) {
                await manager.addComment(
                    `file${i % 20}.ts`,
                    createTestSelection('new', (i % 100) + 1),
                    `Selected text for comment ${i}`,
                    `This is comment number ${i} with some detailed description`,
                    gitContext,
                    undefined,
                    `Author ${i % 5}`,
                    [`tag${i % 10}`]
                );
            }

            const addTime = Date.now() - start;
            console.log(`Adding 500 comments took ${addTime}ms`);

            // Query operations
            const queryStart = Date.now();

            const allComments = manager.getAllComments();
            assert.strictEqual(allComments.length, 500);

            const grouped = manager.getCommentsGroupedByFile();
            assert.strictEqual(grouped.size, 20);

            const files = manager.getFilesWithComments();
            assert.strictEqual(files.length, 20);

            const queryTime = Date.now() - queryStart;
            console.log(`Query operations took ${queryTime}ms`);

            // Resolve all
            const resolveStart = Date.now();
            const resolvedCount = await manager.resolveAllComments();
            assert.strictEqual(resolvedCount, 500);
            const resolveTime = Date.now() - resolveStart;
            console.log(`Resolving 500 comments took ${resolveTime}ms`);

            // Total should be reasonable
            const totalTime = addTime + queryTime + resolveTime;
            assert.ok(totalTime < 10000, `Total operations took too long: ${totalTime}ms`);
        });
    });
});
