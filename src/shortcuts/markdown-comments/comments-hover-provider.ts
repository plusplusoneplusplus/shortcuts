/**
 * Hover provider for showing comment previews
 */

import * as vscode from 'vscode';
import { CommentsManager } from './comments-manager';
import { MarkdownComment } from './types';

/**
 * Hover provider for markdown comments
 */
export class CommentsHoverProvider implements vscode.HoverProvider {
    private commentsManager: CommentsManager;

    constructor(commentsManager: CommentsManager) {
        this.commentsManager = commentsManager;
    }

    /**
     * Provide hover information for a position in a document
     */
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        // Only provide hover for markdown files
        if (!this.isMarkdownFile(document)) {
            return undefined;
        }

        // Convert 0-based position to 1-based for comment lookup
        const line = position.line + 1;
        const column = position.character + 1;

        // Get comments at this position
        const comments = this.commentsManager.getCommentsAtPosition(
            document.uri.fsPath,
            line,
            column
        );

        if (comments.length === 0) {
            return undefined;
        }

        // Create hover content for all comments at this position
        const contents = new vscode.MarkdownString();
        contents.isTrusted = true;
        contents.supportHtml = true;

        for (let i = 0; i < comments.length; i++) {
            if (i > 0) {
                contents.appendMarkdown('\n\n---\n\n');
            }
            this.appendCommentContent(contents, comments[i]);
        }

        // Calculate the range for the hover
        const firstComment = comments[0];
        const range = this.getCommentRange(firstComment, document);

        return new vscode.Hover(contents, range);
    }

    /**
     * Append comment content to a MarkdownString
     */
    private appendCommentContent(markdown: vscode.MarkdownString, comment: MarkdownComment): void {
        const statusIcon = comment.status === 'resolved' ? '✅' : '💬';
        const statusText = comment.status === 'resolved' ? 'Resolved' : 'Open';

        markdown.appendMarkdown(`### ${statusIcon} Comment (${statusText})\n\n`);
        markdown.appendMarkdown(`${comment.comment}\n\n`);

        // Selected text preview
        const selectedTextPreview = comment.selectedText.length > 150
            ? comment.selectedText.substring(0, 147) + '...'
            : comment.selectedText;
        markdown.appendMarkdown(`**Selected text:**\n> ${selectedTextPreview.replace(/\n/g, '\n> ')}\n\n`);

        // Metadata
        if (comment.author) {
            markdown.appendMarkdown(`*Author:* ${comment.author}  \n`);
        }
        if (comment.tags && comment.tags.length > 0) {
            markdown.appendMarkdown(`*Tags:* ${comment.tags.map(t => `\`${t}\``).join(', ')}  \n`);
        }
        markdown.appendMarkdown(`*Created:* ${new Date(comment.createdAt).toLocaleString()}  \n`);
        if (comment.updatedAt !== comment.createdAt) {
            markdown.appendMarkdown(`*Updated:* ${new Date(comment.updatedAt).toLocaleString()}  \n`);
        }

        // Action links
        markdown.appendMarkdown(`\n`);
        if (comment.status === 'open') {
            markdown.appendMarkdown(`[$(check) Resolve](command:markdownComments.resolveComment?${encodeURIComponent(JSON.stringify([comment.id]))})`);
        } else {
            markdown.appendMarkdown(`[$(circle-outline) Reopen](command:markdownComments.reopenComment?${encodeURIComponent(JSON.stringify([comment.id]))})`);
        }
        markdown.appendMarkdown(` | `);
        markdown.appendMarkdown(`[$(edit) Edit](command:markdownComments.editComment?${encodeURIComponent(JSON.stringify([comment.id]))})`);
        markdown.appendMarkdown(` | `);
        markdown.appendMarkdown(`[$(trash) Delete](command:markdownComments.deleteComment?${encodeURIComponent(JSON.stringify([comment.id]))})`);
    }

    /**
     * Get the VS Code Range for a comment
     */
    private getCommentRange(comment: MarkdownComment, document: vscode.TextDocument): vscode.Range | undefined {
        try {
            const startLine = Math.max(0, comment.selection.startLine - 1);
            const endLine = Math.max(0, comment.selection.endLine - 1);

            if (startLine >= document.lineCount || endLine >= document.lineCount) {
                return undefined;
            }

            const startLineText = document.lineAt(startLine);
            const endLineText = document.lineAt(endLine);

            const startColumn = Math.min(
                Math.max(0, comment.selection.startColumn - 1),
                startLineText.text.length
            );
            const endColumn = Math.min(
                Math.max(0, comment.selection.endColumn - 1),
                endLineText.text.length
            );

            return new vscode.Range(
                new vscode.Position(startLine, startColumn),
                new vscode.Position(endLine, endColumn)
            );
        } catch {
            return undefined;
        }
    }

    /**
     * Check if a document is a markdown file
     */
    private isMarkdownFile(document: vscode.TextDocument): boolean {
        return document.languageId === 'markdown' ||
            document.fileName.toLowerCase().endsWith('.md') ||
            document.fileName.toLowerCase().endsWith('.markdown');
    }
}
