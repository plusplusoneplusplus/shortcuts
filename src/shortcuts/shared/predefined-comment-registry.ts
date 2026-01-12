/**
 * Predefined Comment Registry
 *
 * Central registry for managing configurable predefined comments.
 * Loads comments from VSCode settings and provides comment lookup
 * for both Markdown Review and Git Diff Review editors.
 */

import * as vscode from 'vscode';
import {
    DEFAULT_DIFF_PREDEFINED_COMMENTS,
    DEFAULT_MARKDOWN_PREDEFINED_COMMENTS,
    PredefinedComment,
    SerializedPredefinedComment,
    serializePredefinedComments
} from './predefined-comment-types';

/**
 * Singleton registry for predefined comments
 */
export class PredefinedCommentRegistry {
    private static instance: PredefinedCommentRegistry | null = null;
    private markdownComments: PredefinedComment[] = [];
    private diffComments: PredefinedComment[] = [];
    private disposables: vscode.Disposable[] = [];

    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

    private constructor() {
        this.loadFromSettings();
        this.watchSettings();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): PredefinedCommentRegistry {
        if (!PredefinedCommentRegistry.instance) {
            PredefinedCommentRegistry.instance = new PredefinedCommentRegistry();
        }
        return PredefinedCommentRegistry.instance;
    }

    /**
     * Dispose the registry (for testing or extension deactivation)
     */
    public static dispose(): void {
        if (PredefinedCommentRegistry.instance) {
            PredefinedCommentRegistry.instance.disposables.forEach(d => d.dispose());
            PredefinedCommentRegistry.instance._onDidChange.dispose();
            PredefinedCommentRegistry.instance = null;
        }
    }

    /**
     * Load comments from VSCode settings
     */
    private loadFromSettings(): void {
        // Load markdown comments
        const mdConfig = vscode.workspace.getConfiguration('workspaceShortcuts.markdownComments');
        const customMdComments = mdConfig.get<PredefinedComment[]>('predefinedComments');
        this.markdownComments = this.loadComments(customMdComments, DEFAULT_MARKDOWN_PREDEFINED_COMMENTS);

        // Load diff comments
        const diffConfig = vscode.workspace.getConfiguration('workspaceShortcuts.diffComments');
        const customDiffComments = diffConfig.get<PredefinedComment[]>('predefinedComments');
        this.diffComments = this.loadComments(customDiffComments, DEFAULT_DIFF_PREDEFINED_COMMENTS);
    }

    /**
     * Load and validate comments, falling back to defaults if needed
     */
    private loadComments(
        customComments: PredefinedComment[] | undefined,
        defaultComments: PredefinedComment[]
    ): PredefinedComment[] {
        // Use custom comments if configured and non-empty
        const commentsToLoad = (customComments && customComments.length > 0)
            ? customComments
            : defaultComments;

        const validComments: PredefinedComment[] = [];

        for (const comment of commentsToLoad) {
            if (this.validateComment(comment)) {
                validComments.push({
                    ...comment,
                    order: comment.order ?? 100
                });
            } else {
                console.warn(`[PredefinedCommentRegistry] Invalid comment configuration:`, comment);
            }
        }

        // Ensure there's always at least one comment (use defaults as fallback)
        if (validComments.length === 0) {
            return [...defaultComments];
        }

        // Sort by order
        return validComments.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    }

    /**
     * Validate a comment configuration
     */
    private validateComment(comment: unknown): comment is PredefinedComment {
        if (!comment || typeof comment !== 'object') {
            return false;
        }

        const c = comment as Record<string, unknown>;

        // Required fields
        if (typeof c.id !== 'string' || c.id.trim() === '') {
            return false;
        }
        if (typeof c.label !== 'string' || c.label.trim() === '') {
            return false;
        }
        if (typeof c.text !== 'string') {
            return false;
        }

        // Optional fields type checking
        if (c.order !== undefined && typeof c.order !== 'number') {
            return false;
        }
        if (c.description !== undefined && typeof c.description !== 'string') {
            return false;
        }

        return true;
    }

    /**
     * Watch for settings changes
     */
    private watchSettings(): void {
        const disposable = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('workspaceShortcuts.markdownComments.predefinedComments') ||
                e.affectsConfiguration('workspaceShortcuts.diffComments.predefinedComments')) {
                this.loadFromSettings();
                this._onDidChange.fire();
            }
        });
        this.disposables.push(disposable);
    }

    /**
     * Get markdown predefined comments sorted by order
     */
    public getMarkdownComments(): PredefinedComment[] {
        return [...this.markdownComments];
    }

    /**
     * Get diff predefined comments sorted by order
     */
    public getDiffComments(): PredefinedComment[] {
        return [...this.diffComments];
    }

    /**
     * Get markdown comments serialized for webview
     */
    public getSerializedMarkdownComments(): SerializedPredefinedComment[] {
        return serializePredefinedComments(this.markdownComments);
    }

    /**
     * Get diff comments serialized for webview
     */
    public getSerializedDiffComments(): SerializedPredefinedComment[] {
        return serializePredefinedComments(this.diffComments);
    }

    /**
     * Get a markdown comment by ID
     */
    public getMarkdownComment(id: string): PredefinedComment | undefined {
        return this.markdownComments.find(c => c.id === id);
    }

    /**
     * Get a diff comment by ID
     */
    public getDiffComment(id: string): PredefinedComment | undefined {
        return this.diffComments.find(c => c.id === id);
    }
}

/**
 * Get the singleton instance (convenience function)
 */
export function getPredefinedCommentRegistry(): PredefinedCommentRegistry {
    return PredefinedCommentRegistry.getInstance();
}
