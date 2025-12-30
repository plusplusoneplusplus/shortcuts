/**
 * Unit tests for Language Model Tools
 * Tests the ResolveCommentsTool and prompt generation with comment IDs
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    COMMENTS_CONFIG_FILE,
    CommentsManager,
    PromptGenerator
} from '../../shortcuts/markdown-comments';
import {
    DiffCommentsManager,
    DiffPromptGenerator
} from '../../shortcuts/git-diff-comments';
import { ResolveCommentsTool, ResolveCommentsInput } from '../../shortcuts/lm-tools';

/**
 * Mock implementation of vscode.CancellationToken
 */
class MockCancellationToken {
    isCancellationRequested = false;
    onCancellationRequested = () => ({ dispose: () => {} });
}

/**
 * Mock implementation of vscode.LanguageModelToolInvocationOptions
 */
function createMockInvocationOptions<T>(input: T): any {
    return { input };
}

/**
 * Mock implementation of vscode.LanguageModelToolInvocationPrepareOptions
 */
function createMockPrepareOptions<T>(input: T): any {
    return { input };
}

suite('Language Model Tools Tests', () => {
    let tempDir: string;
    let markdownCommentsManager: CommentsManager;
    let diffCommentsManager: DiffCommentsManager;

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-tools-test-'));
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });

        // Initialize empty comments files
        fs.writeFileSync(
            path.join(vscodePath, COMMENTS_CONFIG_FILE),
            JSON.stringify({ version: 1, comments: [] })
        );
        fs.writeFileSync(
            path.join(vscodePath, 'git-diff-comments.json'),
            JSON.stringify({ version: 1, comments: [] })
        );

        markdownCommentsManager = new CommentsManager(tempDir);
        diffCommentsManager = new DiffCommentsManager(tempDir);
    });

    teardown(() => {
        markdownCommentsManager.dispose();
        diffCommentsManager.dispose();
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('ResolveCommentsTool', () => {
        let tool: ResolveCommentsTool;

        setup(async () => {
            await markdownCommentsManager.initialize();
            await diffCommentsManager.initialize();
            tool = new ResolveCommentsTool(markdownCommentsManager, diffCommentsManager);
        });

        test('should resolve a single markdown comment', async () => {
            const comment = await markdownCommentsManager.addComment(
                'test.md',
                { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                'Test text',
                'Test comment'
            );
            assert.strictEqual(comment.status, 'open');

            const input: ResolveCommentsInput = {
                commentType: 'markdown',
                commentIds: [comment.id]
            };

            const result = await tool.invoke(
                createMockInvocationOptions(input),
                new MockCancellationToken() as any
            );

            // Verify the comment was resolved
            const updatedComment = markdownCommentsManager.getComment(comment.id);
            assert.strictEqual(updatedComment?.status, 'resolved');

            // Verify the result message
            const resultText = (result as any).content[0].value;
            assert.ok(resultText.includes('Successfully resolved 1 comment'));
        });

        test('should resolve multiple markdown comments', async () => {
            const c1 = await markdownCommentsManager.addComment(
                'test.md',
                { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                'Text 1',
                'Comment 1'
            );
            const c2 = await markdownCommentsManager.addComment(
                'test.md',
                { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 },
                'Text 2',
                'Comment 2'
            );

            const input: ResolveCommentsInput = {
                commentType: 'markdown',
                commentIds: [c1.id, c2.id]
            };

            const result = await tool.invoke(
                createMockInvocationOptions(input),
                new MockCancellationToken() as any
            );

            assert.strictEqual(markdownCommentsManager.getComment(c1.id)?.status, 'resolved');
            assert.strictEqual(markdownCommentsManager.getComment(c2.id)?.status, 'resolved');

            const resultText = (result as any).content[0].value;
            assert.ok(resultText.includes('Successfully resolved 2 comment'));
        });

        test('should handle non-existent comment ID', async () => {
            const input: ResolveCommentsInput = {
                commentType: 'markdown',
                commentIds: ['non_existent_id']
            };

            const result = await tool.invoke(
                createMockInvocationOptions(input),
                new MockCancellationToken() as any
            );

            const resultText = (result as any).content[0].value;
            assert.ok(resultText.includes('Comment not found'));
        });

        test('should handle already resolved comment', async () => {
            const comment = await markdownCommentsManager.addComment(
                'test.md',
                { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                'Test text',
                'Test comment'
            );
            await markdownCommentsManager.resolveComment(comment.id);

            const input: ResolveCommentsInput = {
                commentType: 'markdown',
                commentIds: [comment.id]
            };

            const result = await tool.invoke(
                createMockInvocationOptions(input),
                new MockCancellationToken() as any
            );

            const resultText = (result as any).content[0].value;
            assert.ok(resultText.includes('already resolved'));
        });

        test('should resolve diff comments', async () => {
            const comment = await diffCommentsManager.addComment(
                'src/test.ts',
                {
                    startColumn: 1,
                    endColumn: 10,
                    side: 'new',
                    oldStartLine: null,
                    oldEndLine: null,
                    newStartLine: 5,
                    newEndLine: 5
                },
                'Test code',
                'Fix this',
                {
                    repositoryRoot: tempDir,
                    repositoryName: 'test-repo',
                    oldRef: 'HEAD~1',
                    newRef: 'HEAD',
                    wasStaged: false
                }
            );
            assert.strictEqual(comment.status, 'open');

            const input: ResolveCommentsInput = {
                commentType: 'diff',
                commentIds: [comment.id]
            };

            const result = await tool.invoke(
                createMockInvocationOptions(input),
                new MockCancellationToken() as any
            );

            const updatedComment = diffCommentsManager.getComment(comment.id);
            assert.strictEqual(updatedComment?.status, 'resolved');

            const resultText = (result as any).content[0].value;
            assert.ok(resultText.includes('Successfully resolved 1 comment'));
        });

        test('should handle mixed valid and invalid IDs', async () => {
            const validComment = await markdownCommentsManager.addComment(
                'test.md',
                { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                'Valid text',
                'Valid comment'
            );

            const input: ResolveCommentsInput = {
                commentType: 'markdown',
                commentIds: [validComment.id, 'invalid_id']
            };

            const result = await tool.invoke(
                createMockInvocationOptions(input),
                new MockCancellationToken() as any
            );

            // Valid comment should be resolved
            assert.strictEqual(markdownCommentsManager.getComment(validComment.id)?.status, 'resolved');

            // Result should mention both success and error
            const resultText = (result as any).content[0].value;
            assert.ok(resultText.includes('Successfully resolved 1 comment'));
            assert.ok(resultText.includes('Comment not found'));
        });

        test('should handle empty comment IDs array', async () => {
            const input: ResolveCommentsInput = {
                commentType: 'markdown',
                commentIds: []
            };

            const result = await tool.invoke(
                createMockInvocationOptions(input),
                new MockCancellationToken() as any
            );

            const resultText = (result as any).content[0].value;
            assert.ok(resultText.includes('No comments were resolved'));
        });

        test('prepareInvocation should return confirmation message', async () => {
            const input: ResolveCommentsInput = {
                commentType: 'markdown',
                commentIds: ['id1', 'id2', 'id3']
            };

            const result = await tool.prepareInvocation(
                createMockPrepareOptions(input),
                new MockCancellationToken() as any
            );

            assert.ok(result);
            assert.ok(result.invocationMessage);
            const invocationMsg = typeof result.invocationMessage === 'string'
                ? result.invocationMessage
                : result.invocationMessage.value;
            assert.ok(invocationMsg.includes('3'), 'Should mention count of 3');
            assert.ok(invocationMsg.includes('markdown review'), 'Should mention markdown review');
            assert.ok(result.confirmationMessages);
        });

        test('prepareInvocation should handle diff comments', async () => {
            const input: ResolveCommentsInput = {
                commentType: 'diff',
                commentIds: ['id1']
            };

            const result = await tool.prepareInvocation(
                createMockPrepareOptions(input),
                new MockCancellationToken() as any
            );

            assert.ok(result);
            assert.ok(result.invocationMessage);
            const invocationMsg = typeof result.invocationMessage === 'string'
                ? result.invocationMessage
                : result.invocationMessage.value;
            assert.ok(invocationMsg.includes('git diff'), 'Should mention git diff');
        });
    });

    suite('Prompt Generation with Comment IDs', () => {
        suite('Markdown PromptGenerator', () => {
            let promptGenerator: PromptGenerator;

            setup(async () => {
                await markdownCommentsManager.initialize();
                promptGenerator = new PromptGenerator(markdownCommentsManager);
            });

            test('should include comment ID in markdown format', async () => {
                const comment = await markdownCommentsManager.addComment(
                    'test.md',
                    { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
                    'Sample text',
                    'Please review'
                );

                const prompt = promptGenerator.generatePrompt();

                assert.ok(prompt.includes(`**ID:** \`${comment.id}\``), 'Prompt should contain comment ID in markdown format');
            });

            test('should include comment ID in JSON format', async () => {
                const comment = await markdownCommentsManager.addComment(
                    'test.md',
                    { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
                    'Sample text',
                    'Please review'
                );

                const prompt = promptGenerator.generatePrompt({ outputFormat: 'json' });
                const parsed = JSON.parse(prompt);

                // Find the comment in the parsed output
                let foundId = false;
                if (parsed.files) {
                    for (const file of parsed.files) {
                        for (const c of file.comments) {
                            if (c.id === comment.id) {
                                foundId = true;
                            }
                        }
                    }
                } else if (parsed.comments) {
                    for (const c of parsed.comments) {
                        if (c.id === comment.id) {
                            foundId = true;
                        }
                    }
                }

                assert.ok(foundId, 'JSON output should contain comment ID');
            });

            test('should include multiple comment IDs', async () => {
                const c1 = await markdownCommentsManager.addComment(
                    'test.md',
                    { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                    'Text 1',
                    'Comment 1'
                );
                const c2 = await markdownCommentsManager.addComment(
                    'test.md',
                    { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 },
                    'Text 2',
                    'Comment 2'
                );

                const prompt = promptGenerator.generatePrompt();

                assert.ok(prompt.includes(`\`${c1.id}\``), 'Prompt should contain first comment ID');
                assert.ok(prompt.includes(`\`${c2.id}\``), 'Prompt should contain second comment ID');
            });
        });

        suite('Diff PromptGenerator', () => {
            let promptGenerator: DiffPromptGenerator;

            setup(async () => {
                await diffCommentsManager.initialize();
                promptGenerator = new DiffPromptGenerator(diffCommentsManager);
            });

            test('should include comment ID in markdown format', async () => {
                const comment = await diffCommentsManager.addComment(
                    'src/test.ts',
                    {
                        startColumn: 1,
                        endColumn: 10,
                        side: 'new',
                        oldStartLine: null,
                        oldEndLine: null,
                        newStartLine: 5,
                        newEndLine: 5
                    },
                    'Test code',
                    'Fix this bug',
                    {
                        repositoryRoot: tempDir,
                        repositoryName: 'test-repo',
                        oldRef: 'HEAD~1',
                        newRef: 'HEAD',
                        wasStaged: false
                    }
                );

                const prompt = promptGenerator.generatePrompt();

                assert.ok(prompt.includes(`**ID:** \`${comment.id}\``), 'Prompt should contain comment ID in markdown format');
            });

            test('should include comment ID in JSON format', async () => {
                const comment = await diffCommentsManager.addComment(
                    'src/test.ts',
                    {
                        startColumn: 1,
                        endColumn: 10,
                        side: 'new',
                        oldStartLine: null,
                        oldEndLine: null,
                        newStartLine: 5,
                        newEndLine: 5
                    },
                    'Test code',
                    'Fix this bug',
                    {
                        repositoryRoot: tempDir,
                        repositoryName: 'test-repo',
                        oldRef: 'HEAD~1',
                        newRef: 'HEAD',
                        wasStaged: false
                    }
                );

                const prompt = promptGenerator.generatePrompt({ outputFormat: 'json' });
                const parsed = JSON.parse(prompt);

                // Find the comment in the parsed output
                let foundId = false;
                if (parsed.files) {
                    for (const file of parsed.files) {
                        for (const c of file.comments) {
                            if (c.id === comment.id) {
                                foundId = true;
                            }
                        }
                    }
                } else if (parsed.comments) {
                    for (const c of parsed.comments) {
                        if (c.id === comment.id) {
                            foundId = true;
                        }
                    }
                }

                assert.ok(foundId, 'JSON output should contain comment ID');
            });

            test('should include ID in category-specific prompt', async () => {
                const comment = await diffCommentsManager.addComment(
                    'src/test.ts',
                    {
                        startColumn: 1,
                        endColumn: 10,
                        side: 'new',
                        oldStartLine: null,
                        oldEndLine: null,
                        newStartLine: 5,
                        newEndLine: 5
                    },
                    'Test code',
                    'Fix this',
                    {
                        repositoryRoot: tempDir,
                        repositoryName: 'test-repo',
                        oldRef: 'HEAD~1',
                        newRef: 'HEAD',
                        wasStaged: false
                    }
                );

                const prompt = promptGenerator.generatePromptForCategory('pending');

                assert.ok(prompt.includes(`\`${comment.id}\``), 'Category prompt should contain comment ID');
            });

            test('should include ID in file-specific prompt', async () => {
                const comment = await diffCommentsManager.addComment(
                    'src/test.ts',
                    {
                        startColumn: 1,
                        endColumn: 10,
                        side: 'new',
                        oldStartLine: null,
                        oldEndLine: null,
                        newStartLine: 5,
                        newEndLine: 5
                    },
                    'Test code',
                    'Fix this',
                    {
                        repositoryRoot: tempDir,
                        repositoryName: 'test-repo',
                        oldRef: 'HEAD~1',
                        newRef: 'HEAD',
                        wasStaged: false
                    }
                );

                const prompt = promptGenerator.generatePromptForFile('src/test.ts');

                assert.ok(prompt.includes(`\`${comment.id}\``), 'File prompt should contain comment ID');
            });
        });
    });
});
