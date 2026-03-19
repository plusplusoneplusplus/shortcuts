/**
 * Language Model Tool for resolving comments
 * Allows Copilot Chat to mark comments as resolved
 */

import * as vscode from 'vscode';
import { CommentsManager } from '../markdown-comments/comments-manager';
import { DiffCommentsManager } from '../git-diff-comments/diff-comments-manager';

/**
 * Input schema for the resolve comments tool
 */
export interface ResolveCommentsInput {
    /** Type of comments to resolve: 'markdown' or 'diff' */
    commentType: 'markdown' | 'diff';
    /** Comment ID(s) to resolve */
    commentIds: string[];
}

/**
 * Result structure for resolved comments
 */
interface ResolveCommentsResult {
    success: boolean;
    resolvedCount: number;
    resolvedIds: string[];
    errors: string[];
}

/**
 * Language Model Tool for resolving comments in markdown and git diff reviews
 */
export class ResolveCommentsTool implements vscode.LanguageModelTool<ResolveCommentsInput> {
    constructor(
        private readonly markdownCommentsManager: CommentsManager,
        private readonly diffCommentsManager: DiffCommentsManager
    ) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ResolveCommentsInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const input = options.input;
        const result: ResolveCommentsResult = {
            success: true,
            resolvedCount: 0,
            resolvedIds: [],
            errors: []
        };

        try {
            const manager = input.commentType === 'markdown'
                ? this.markdownCommentsManager
                : this.diffCommentsManager;

            // Resolve specific comments by ID
            for (const commentId of input.commentIds) {
                if (token.isCancellationRequested) {
                    result.errors.push('Operation cancelled');
                    break;
                }

                const comment = manager.getComment(commentId);
                if (!comment) {
                    result.errors.push(`Comment not found: ${commentId}`);
                    continue;
                }
                if (comment.status === 'resolved') {
                    result.errors.push(`Comment already resolved: ${commentId}`);
                    continue;
                }

                await manager.resolveComment(commentId);
                result.resolvedIds.push(commentId);
                result.resolvedCount++;
            }

            // Build response message
            let message: string;
            if (result.resolvedCount === 0) {
                message = 'No comments were resolved.';
                if (result.errors.length > 0) {
                    message += ` Errors: ${result.errors.join('; ')}`;
                }
                result.success = false;
            } else {
                message = `Successfully resolved ${result.resolvedCount} comment(s).`;
                if (result.errors.length > 0) {
                    message += ` Some errors occurred: ${result.errors.join('; ')}`;
                }
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(message)
            ]);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Failed to resolve comments: ${errorMessage}`)
            ]);
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ResolveCommentsInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation | undefined> {
        const input = options.input;

        // Build descriptive message
        const count = input.commentIds.length;
        const typeLabel = input.commentType === 'markdown' ? 'markdown review' : 'git diff';
        const actionDescription = `${count} ${typeLabel} comment(s)`;

        return {
            invocationMessage: `Resolving ${actionDescription}...`,
            confirmationMessages: {
                title: 'Resolve Comments',
                message: new vscode.MarkdownString(
                    `Are you sure you want to resolve ${actionDescription}?\n\n` +
                    `This will mark the comment(s) as resolved.`
                )
            }
        };
    }
}
