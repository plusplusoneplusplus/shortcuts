/**
 * Decoration manager for highlighting commented sections in markdown files
 */

import * as vscode from 'vscode';
import { CommentsManager } from './comments-manager';
import { DEFAULT_COMMENTS_SETTINGS, MarkdownComment } from './types';

/**
 * Manages text decorations for markdown comments
 */
export class CommentsDecorationManager implements vscode.Disposable {
    private commentsManager: CommentsManager;
    private openCommentDecorationType: vscode.TextEditorDecorationType;
    private resolvedCommentDecorationType: vscode.TextEditorDecorationType;
    private gutterIconPath: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    constructor(commentsManager: CommentsManager, context: vscode.ExtensionContext) {
        this.commentsManager = commentsManager;

        // Create gutter icon (using a comment icon)
        this.gutterIconPath = vscode.Uri.parse('data:image/svg+xml;base64,' + Buffer.from(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="#FFC107">
                <path d="M14 1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2v3l3-3h7a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm0 9H6.5L4 12.5V10H2V2h12v8z"/>
            </svg>
        `).toString('base64'));

        // Create decoration types
        this.openCommentDecorationType = this.createOpenCommentDecorationType();
        this.resolvedCommentDecorationType = this.createResolvedCommentDecorationType();

        // Listen for editor changes
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) {
                    this.updateDecorations(editor);
                }
            })
        );

        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                const editor = vscode.window.activeTextEditor;
                if (editor && event.document === editor.document) {
                    this.updateDecorations(editor);
                }
            })
        );

        // Listen for comment changes
        this.disposables.push(
            commentsManager.onDidChangeComments(() => {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    this.updateDecorations(editor);
                }
            })
        );

        // Initial decoration update
        if (vscode.window.activeTextEditor) {
            this.updateDecorations(vscode.window.activeTextEditor);
        }
    }

    /**
     * Create decoration type for open comments
     */
    private createOpenCommentDecorationType(): vscode.TextEditorDecorationType {
        const settings = this.commentsManager.getSettings() || DEFAULT_COMMENTS_SETTINGS;
        return vscode.window.createTextEditorDecorationType({
            backgroundColor: settings.highlightColor,
            isWholeLine: false,
            overviewRulerColor: '#FFC107',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            gutterIconPath: this.gutterIconPath,
            gutterIconSize: 'contain'
        });
    }

    /**
     * Create decoration type for resolved comments
     */
    private createResolvedCommentDecorationType(): vscode.TextEditorDecorationType {
        const settings = this.commentsManager.getSettings() || DEFAULT_COMMENTS_SETTINGS;
        return vscode.window.createTextEditorDecorationType({
            backgroundColor: settings.resolvedHighlightColor,
            isWholeLine: false,
            overviewRulerColor: '#4CAF50',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            opacity: '0.7'
        });
    }

    /**
     * Update decorations for the active editor
     */
    updateDecorations(editor: vscode.TextEditor): void {
        // Only apply decorations to markdown files
        if (!this.isMarkdownFile(editor.document)) {
            this.clearDecorations(editor);
            return;
        }

        const filePath = editor.document.uri.fsPath;
        const comments = this.commentsManager.getCommentsForFile(filePath);
        const settings = this.commentsManager.getSettings() || DEFAULT_COMMENTS_SETTINGS;

        const openDecorations: vscode.DecorationOptions[] = [];
        const resolvedDecorations: vscode.DecorationOptions[] = [];

        for (const comment of comments) {
            // Skip resolved comments if not showing them
            if (comment.status === 'resolved' && !settings.showResolved) {
                continue;
            }

            const range = this.commentToRange(comment, editor.document);
            if (!range) {
                continue;
            }

            const decoration: vscode.DecorationOptions = {
                range,
                hoverMessage: this.createHoverMessage(comment)
            };

            if (comment.status === 'resolved') {
                resolvedDecorations.push(decoration);
            } else {
                openDecorations.push(decoration);
            }
        }

        editor.setDecorations(this.openCommentDecorationType, openDecorations);
        editor.setDecorations(this.resolvedCommentDecorationType, resolvedDecorations);
    }

    /**
     * Clear all decorations from an editor
     */
    private clearDecorations(editor: vscode.TextEditor): void {
        editor.setDecorations(this.openCommentDecorationType, []);
        editor.setDecorations(this.resolvedCommentDecorationType, []);
    }

    /**
     * Convert a comment's selection to a VS Code Range
     */
    private commentToRange(comment: MarkdownComment, document: vscode.TextDocument): vscode.Range | undefined {
        try {
            // Convert 1-based line numbers to 0-based
            const startLine = Math.max(0, comment.selection.startLine - 1);
            const endLine = Math.max(0, comment.selection.endLine - 1);

            // Validate lines exist in document
            if (startLine >= document.lineCount || endLine >= document.lineCount) {
                return undefined;
            }

            const startLineText = document.lineAt(startLine);
            const endLineText = document.lineAt(endLine);

            // Convert 1-based columns to 0-based, clamped to line length
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
        } catch (error) {
            console.warn('Error creating range for comment:', error);
            return undefined;
        }
    }

    /**
     * Create hover message for a comment
     */
    private createHoverMessage(comment: MarkdownComment): vscode.MarkdownString {
        const statusIcon = comment.status === 'resolved' ? '✅' : '💬';
        const statusText = comment.status === 'resolved' ? 'Resolved' : 'Open';

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        markdown.appendMarkdown(`### ${statusIcon} Comment (${statusText})\n\n`);
        markdown.appendMarkdown(`${comment.comment}\n\n`);
        markdown.appendMarkdown(`---\n`);
        markdown.appendMarkdown(`*Selected text:*\n`);
        markdown.appendMarkdown(`> ${comment.selectedText.substring(0, 100)}${comment.selectedText.length > 100 ? '...' : ''}\n\n`);

        if (comment.author) {
            markdown.appendMarkdown(`*Author:* ${comment.author}\n`);
        }

        markdown.appendMarkdown(`*Created:* ${new Date(comment.createdAt).toLocaleString()}\n`);

        // Add action links
        markdown.appendMarkdown(`\n---\n`);
        if (comment.status === 'open') {
            markdown.appendMarkdown(`[Resolve](command:markdownComments.resolveComment?${encodeURIComponent(JSON.stringify([comment.id]))})`);
        } else {
            markdown.appendMarkdown(`[Reopen](command:markdownComments.reopenComment?${encodeURIComponent(JSON.stringify([comment.id]))})`);
        }
        markdown.appendMarkdown(` | `);
        markdown.appendMarkdown(`[Edit](command:markdownComments.editComment?${encodeURIComponent(JSON.stringify([comment.id]))})`);
        markdown.appendMarkdown(` | `);
        markdown.appendMarkdown(`[Delete](command:markdownComments.deleteComment?${encodeURIComponent(JSON.stringify([comment.id]))})`);

        return markdown;
    }

    /**
     * Check if a document is a markdown file
     */
    private isMarkdownFile(document: vscode.TextDocument): boolean {
        return document.languageId === 'markdown' ||
            document.fileName.toLowerCase().endsWith('.md') ||
            document.fileName.toLowerCase().endsWith('.markdown');
    }

    /**
     * Refresh decoration types (when settings change)
     */
    refreshDecorationTypes(): void {
        // Dispose old decoration types
        this.openCommentDecorationType.dispose();
        this.resolvedCommentDecorationType.dispose();

        // Create new decoration types with updated settings
        this.openCommentDecorationType = this.createOpenCommentDecorationType();
        this.resolvedCommentDecorationType = this.createResolvedCommentDecorationType();

        // Update all visible editors
        for (const editor of vscode.window.visibleTextEditors) {
            this.updateDecorations(editor);
        }
    }

    /**
     * Update decorations for all visible editors
     */
    updateAllDecorations(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (this.isMarkdownFile(editor.document)) {
                this.updateDecorations(editor);
            }
        }
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.openCommentDecorationType.dispose();
        this.resolvedCommentDecorationType.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
