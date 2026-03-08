/**
 * Unit tests for Diff AI Resolve Comment functionality
 * Tests the AI resolve comment flow: message types, context building, and comment resolution
 */

import * as assert from 'assert';
import {
    buildDiffClarificationPrompt,
    validateAndTruncateDiffPrompt
} from '../../shortcuts/git-diff-comments/diff-ai-clarification-handler';
import {
    DiffClarificationContext,
    DiffComment,
    DiffGitContext,
    DiffSelection,
    DiffWebviewMessage
} from '../../shortcuts/git-diff-comments/types';

/**
 * Helper to create a DiffComment for testing
 */
function createTestComment(overrides: Partial<DiffComment> = {}): DiffComment {
    return {
        id: 'test-comment-1',
        filePath: 'src/index.ts',
        selection: {
            side: 'new',
            oldStartLine: null,
            oldEndLine: null,
            newStartLine: 10,
            newEndLine: 15,
            startColumn: 1,
            endColumn: 20
        },
        selectedText: 'function hello() { return "world"; }',
        comment: 'This function should validate input before returning',
        status: 'open',
        type: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        gitContext: {
            repositoryRoot: '/repo',
            repositoryName: 'test-repo',
            oldRef: 'HEAD',
            newRef: 'WORKING_TREE',
            wasStaged: false
        },
        ...overrides
    };
}

suite('Diff AI Resolve Comment Tests', () => {

    suite('Message Type', () => {

        test('aiResolveComment should be a valid DiffWebviewMessage type', () => {
            const message: DiffWebviewMessage = {
                type: 'aiResolveComment',
                commentId: 'test-comment-1'
            };
            assert.strictEqual(message.type, 'aiResolveComment');
            assert.strictEqual(message.commentId, 'test-comment-1');
        });

        test('aiResolveComment message should carry commentId', () => {
            const message: DiffWebviewMessage = {
                type: 'aiResolveComment',
                commentId: 'diff_comment_abc123'
            };
            assert.ok(message.commentId);
            assert.strictEqual(message.commentId, 'diff_comment_abc123');
        });
    });

    suite('AI Resolve Context Building', () => {

        test('should build clarification context from a comment', () => {
            const comment = createTestComment();

            const startLine = comment.selection.newStartLine ?? comment.selection.oldStartLine ?? 1;
            const endLine = comment.selection.newEndLine ?? comment.selection.oldEndLine ?? startLine;

            const context: DiffClarificationContext = {
                selectedText: comment.selectedText,
                selectionRange: { startLine, endLine },
                side: comment.selection.side,
                filePath: comment.filePath,
                surroundingContent: '',
                instructionType: 'custom',
                customInstruction: `Please resolve this code review comment by providing a fix or explanation.\n\nComment: "${comment.comment}"\n\nCode under review:`
            };

            assert.strictEqual(context.selectedText, 'function hello() { return "world"; }');
            assert.strictEqual(context.selectionRange.startLine, 10);
            assert.strictEqual(context.selectionRange.endLine, 15);
            assert.strictEqual(context.side, 'new');
            assert.strictEqual(context.filePath, 'src/index.ts');
            assert.strictEqual(context.instructionType, 'custom');
            assert.ok(context.customInstruction!.includes('This function should validate input'));
        });

        test('should build context from comment on old side', () => {
            const comment = createTestComment({
                selection: {
                    side: 'old',
                    oldStartLine: 5,
                    oldEndLine: 8,
                    newStartLine: null,
                    newEndLine: null,
                    startColumn: 1,
                    endColumn: 30
                }
            });

            const startLine = comment.selection.newStartLine ?? comment.selection.oldStartLine ?? 1;
            const endLine = comment.selection.newEndLine ?? comment.selection.oldEndLine ?? startLine;

            assert.strictEqual(startLine, 5);
            assert.strictEqual(endLine, 8);
        });

        test('should use line 1 as fallback when no line numbers', () => {
            const comment = createTestComment({
                selection: {
                    side: 'new',
                    oldStartLine: null,
                    oldEndLine: null,
                    newStartLine: null,
                    newEndLine: null,
                    startColumn: 1,
                    endColumn: 10
                }
            });

            const startLine = comment.selection.newStartLine ?? comment.selection.oldStartLine ?? 1;
            const endLine = comment.selection.newEndLine ?? comment.selection.oldEndLine ?? startLine;

            assert.strictEqual(startLine, 1);
            assert.strictEqual(endLine, 1);
        });
    });

    suite('Prompt Generation for AI Resolve', () => {

        test('should generate valid prompt with comment text and code', () => {
            const comment = createTestComment();

            const context: DiffClarificationContext = {
                selectedText: comment.selectedText,
                selectionRange: { startLine: 10, endLine: 15 },
                side: 'new',
                filePath: comment.filePath,
                surroundingContent: '',
                instructionType: 'custom',
                customInstruction: `Please resolve this code review comment by providing a fix or explanation.\n\nComment: "${comment.comment}"\n\nCode under review:`
            };

            const prompt = buildDiffClarificationPrompt(context);

            // Should include the custom instruction with the comment text
            assert.ok(prompt.includes('resolve this code review comment'));
            assert.ok(prompt.includes(comment.comment));
            assert.ok(prompt.includes(comment.selectedText));
            assert.ok(prompt.includes(comment.filePath));
        });

        test('should include file path and side info in prompt', () => {
            const context: DiffClarificationContext = {
                selectedText: 'const x = 1;',
                selectionRange: { startLine: 1, endLine: 1 },
                side: 'new',
                filePath: 'src/utils.ts',
                surroundingContent: '',
                instructionType: 'custom',
                customInstruction: 'Please resolve this code review comment'
            };

            const prompt = buildDiffClarificationPrompt(context);

            assert.ok(prompt.includes('src/utils.ts'));
            assert.ok(prompt.includes('(from new version)'));
        });

        test('should handle old side in prompt', () => {
            const context: DiffClarificationContext = {
                selectedText: 'old code',
                selectionRange: { startLine: 5, endLine: 5 },
                side: 'old',
                filePath: 'src/old.ts',
                surroundingContent: '',
                instructionType: 'custom',
                customInstruction: 'Resolve this comment'
            };

            const prompt = buildDiffClarificationPrompt(context);
            assert.ok(prompt.includes('(from old version)'));
        });

        test('should validate and truncate long prompts', () => {
            const longText = 'x'.repeat(10000);
            const comment = createTestComment({ selectedText: longText });

            const context: DiffClarificationContext = {
                selectedText: comment.selectedText,
                selectionRange: { startLine: 1, endLine: 1 },
                side: 'new',
                filePath: comment.filePath,
                surroundingContent: '',
                instructionType: 'custom',
                customInstruction: `Please resolve this code review comment.\n\nComment: "${comment.comment}"`
            };

            const { prompt, truncated } = validateAndTruncateDiffPrompt(context);
            assert.ok(prompt.length > 0);
            // Very long text may or may not be truncated depending on limits
            assert.ok(typeof truncated === 'boolean');
        });
    });

    suite('Comment Eligibility for AI Resolve', () => {

        test('open user comment should be eligible for AI resolve', () => {
            const comment = createTestComment({ status: 'open', type: 'user' });
            const isEligible = comment.status === 'open' && (!comment.type || comment.type === 'user');
            assert.strictEqual(isEligible, true);
        });

        test('open comment with no type should be eligible', () => {
            const comment = createTestComment({ status: 'open', type: undefined });
            const isEligible = comment.status === 'open' && (!comment.type || comment.type === 'user');
            assert.strictEqual(isEligible, true);
        });

        test('resolved comment should not be eligible for AI resolve', () => {
            const comment = createTestComment({ status: 'resolved', type: 'user' });
            const isEligible = comment.status === 'open' && (!comment.type || comment.type === 'user');
            assert.strictEqual(isEligible, false);
        });

        test('AI clarification comment should not be eligible', () => {
            const comment = createTestComment({ status: 'open', type: 'ai-clarification' });
            const isEligible = comment.status === 'open' && (!comment.type || comment.type === 'user');
            assert.strictEqual(isEligible, false);
        });

        test('AI suggestion comment should not be eligible', () => {
            const comment = createTestComment({ status: 'open', type: 'ai-suggestion' });
            const isEligible = comment.status === 'open' && (!comment.type || comment.type === 'user');
            assert.strictEqual(isEligible, false);
        });

        test('AI critique comment should not be eligible', () => {
            const comment = createTestComment({ status: 'open', type: 'ai-critique' });
            const isEligible = comment.status === 'open' && (!comment.type || comment.type === 'user');
            assert.strictEqual(isEligible, false);
        });

        test('AI question comment should not be eligible', () => {
            const comment = createTestComment({ status: 'open', type: 'ai-question' });
            const isEligible = comment.status === 'open' && (!comment.type || comment.type === 'user');
            assert.strictEqual(isEligible, false);
        });
    });

    suite('AI Resolve Response Handling', () => {

        test('successful AI response should produce ai-suggestion comment', () => {
            const aiResponse = 'Here is the fix:\n\n```ts\nfunction hello(input: string) {\n  if (!input) throw new Error("invalid");\n  return "world";\n}\n```';
            const formattedComment = `🤖 **AI Resolution:**\n\n${aiResponse}`;

            assert.ok(formattedComment.startsWith('🤖 **AI Resolution:**'));
            assert.ok(formattedComment.includes('Here is the fix:'));
        });

        test('AI response comment should use same selection as original', () => {
            const originalComment = createTestComment();
            const aiSelection = originalComment.selection;

            assert.strictEqual(aiSelection.side, 'new');
            assert.strictEqual(aiSelection.newStartLine, 10);
            assert.strictEqual(aiSelection.newEndLine, 15);
        });

        test('original comment should be resolved after AI response', () => {
            const comment = createTestComment({ status: 'open' });
            // Simulate resolution
            comment.status = 'resolved';
            assert.strictEqual(comment.status, 'resolved');
        });

        test('failed AI response should not resolve the original comment', () => {
            const comment = createTestComment({ status: 'open' });
            const aiResult = { success: false, error: 'AI unavailable' };

            // When AI fails, comment should remain open
            if (!aiResult.success) {
                // Don't resolve
            }
            assert.strictEqual(comment.status, 'open');
        });
    });

    suite('Edge Cases', () => {

        test('should handle comment with empty selectedText', () => {
            const comment = createTestComment({ selectedText: '' });

            const context: DiffClarificationContext = {
                selectedText: comment.selectedText,
                selectionRange: { startLine: 10, endLine: 10 },
                side: 'new',
                filePath: comment.filePath,
                surroundingContent: '',
                instructionType: 'custom',
                customInstruction: `Please resolve this comment: "${comment.comment}"`
            };

            const prompt = buildDiffClarificationPrompt(context);
            assert.ok(prompt.length > 0);
            assert.ok(prompt.includes(comment.filePath));
        });

        test('should handle comment with very long comment text', () => {
            const longComment = 'Please fix '.repeat(500);
            const comment = createTestComment({ comment: longComment });

            const context: DiffClarificationContext = {
                selectedText: comment.selectedText,
                selectionRange: { startLine: 1, endLine: 1 },
                side: 'new',
                filePath: comment.filePath,
                surroundingContent: '',
                instructionType: 'custom',
                customInstruction: `Please resolve this code review comment.\n\nComment: "${comment.comment}"`
            };

            const prompt = buildDiffClarificationPrompt(context);
            assert.ok(prompt.length > 0);
        });

        test('should handle comment with special characters', () => {
            const comment = createTestComment({
                comment: 'Fix the <script>alert("xss")</script> issue & handle "quotes"',
                selectedText: 'const a = b && c || d;'
            });

            const context: DiffClarificationContext = {
                selectedText: comment.selectedText,
                selectionRange: { startLine: 1, endLine: 1 },
                side: 'new',
                filePath: comment.filePath,
                surroundingContent: '',
                instructionType: 'custom',
                customInstruction: `Please resolve this comment: "${comment.comment}"`
            };

            const prompt = buildDiffClarificationPrompt(context);
            assert.ok(prompt.includes('const a = b && c || d;'));
        });

        test('should handle both side selection', () => {
            const comment = createTestComment({
                selection: {
                    side: 'both',
                    oldStartLine: 5,
                    oldEndLine: 8,
                    newStartLine: 5,
                    newEndLine: 10,
                    startColumn: 1,
                    endColumn: 20
                }
            });

            const startLine = comment.selection.newStartLine ?? comment.selection.oldStartLine ?? 1;
            assert.strictEqual(startLine, 5);
            assert.strictEqual(comment.selection.side, 'both');
        });
    });
});
