/**
 * Registration helper for Language Model Tools
 */

import * as vscode from 'vscode';
import { CommentsManager } from '../markdown-comments/comments-manager';
import { DiffCommentsManager } from '../git-diff-comments/diff-comments-manager';
import { ResolveCommentsTool } from './resolve-comments-tool';

/**
 * Register all Language Model Tools for the extension
 * @param context Extension context
 * @param markdownCommentsManager Manager for markdown comments
 * @param diffCommentsManager Manager for git diff comments
 * @returns Array of disposables for the registered tools
 */
export function registerLanguageModelTools(
    context: vscode.ExtensionContext,
    markdownCommentsManager: CommentsManager,
    diffCommentsManager: DiffCommentsManager
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Check if the Language Model API is available
    if (!vscode.lm || !vscode.lm.registerTool) {
        console.log('Language Model Tools API not available');
        return disposables;
    }

    try {
        // Register resolve comments tool
        const resolveCommentsTool = new ResolveCommentsTool(
            markdownCommentsManager,
            diffCommentsManager
        );

        disposables.push(
            vscode.lm.registerTool(
                'workspace-shortcuts_resolveComments',
                resolveCommentsTool
            )
        );

        console.log('Language Model Tools registered successfully');
    } catch (error) {
        console.error('Failed to register Language Model Tools:', error);
    }

    return disposables;
}
