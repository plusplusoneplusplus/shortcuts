/**
 * CommentsManager - Handles storage and management of markdown comments
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    AnchorConfig,
    createAnchor,
    DEFAULT_ANCHOR_CONFIG,
    needsRelocation,
    relocateAnchor,
    updateAnchor
} from './comment-anchor';
import { CommentsManagerBase } from './comments-manager-base';
import {
    AnchorRelocationResult,
    CommentAnchor,
    CommentEvent,
    COMMENTS_CONFIG_FILE,
    CommentsConfig,
    CommentSelection,
    CommentsSettings,
    CommentType,
    DEFAULT_COMMENTS_CONFIG,
    DEFAULT_COMMENTS_SETTINGS,
    isUserComment,
    MarkdownComment,
    MermaidContext
} from './types';

/**
 * Manages markdown comments storage and operations
 */
export class CommentsManager extends CommentsManagerBase<
    CommentSelection,
    CommentAnchor,
    MarkdownComment,
    CommentsSettings,
    CommentsConfig,
    CommentEvent
> {
    constructor(workspaceRoot: string) {
        super(workspaceRoot, COMMENTS_CONFIG_FILE, { ...DEFAULT_COMMENTS_CONFIG });
    }

    /**
     * Get the default configuration
     */
    protected getDefaultConfig(): CommentsConfig {
        return { ...DEFAULT_COMMENTS_CONFIG };
    }

    /**
     * Get the default settings
     */
    protected getDefaultSettings(): CommentsSettings {
        return { ...DEFAULT_COMMENTS_SETTINGS };
    }

    /**
     * Add a new comment
     */
    async addComment(
        filePath: string,
        selection: { startLine: number; startColumn: number; endLine: number; endColumn: number },
        selectedText: string,
        comment: string,
        author?: string,
        tags?: string[],
        mermaidContext?: MermaidContext,
        type?: CommentType
    ): Promise<MarkdownComment> {
        const now = new Date().toISOString();
        const relativePath = this.getRelativePath(filePath);

        // Try to create anchor from file content
        let anchor: CommentAnchor | undefined;
        try {
            const absolutePath = this.getAbsolutePath(relativePath);
            if (fs.existsSync(absolutePath)) {
                const content = fs.readFileSync(absolutePath, 'utf8');
                anchor = createAnchor(content, selection);
            }
        } catch (error) {
            console.warn('Failed to create anchor for comment:', error);
        }

        const newComment: MarkdownComment = {
            id: this.generateId('comment'),
            filePath: relativePath,
            selection,
            selectedText,
            comment,
            status: 'open',
            type: type || 'user',
            createdAt: now,
            updatedAt: now,
            author,
            tags,
            mermaidContext,
            anchor
        };

        return this.addCommentToConfig(newComment);
    }

    /**
     * Override getStartLine for markdown comments which use startLine directly
     */
    protected override getStartLine(comment: MarkdownComment): number {
        return comment.selection.startLine;
    }

    /**
     * Get comments at a specific position in a file
     */
    getCommentsAtPosition(filePath: string, line: number, column: number): MarkdownComment[] {
        const relativePath = this.getRelativePath(filePath);
        return this.config.comments.filter(c => {
            if (c.filePath !== relativePath) {
                return false;
            }

            // Check if position is within the selection
            if (line < c.selection.startLine || line > c.selection.endLine) {
                return false;
            }

            if (line === c.selection.startLine && column < c.selection.startColumn) {
                return false;
            }

            if (line === c.selection.endLine && column > c.selection.endColumn) {
                return false;
            }

            return true;
        });
    }

    /**
     * Validate and normalize the configuration
     */
    protected validateConfig(config: any): CommentsConfig {
        return this.validateConfigStructure(config, DEFAULT_COMMENTS_SETTINGS);
    }

    /**
     * Check if a comment object is valid
     */
    protected isValidComment(comment: any): comment is MarkdownComment {
        return (
            typeof comment === 'object' &&
            typeof comment.id === 'string' &&
            typeof comment.filePath === 'string' &&
            typeof comment.selection === 'object' &&
            typeof comment.selection.startLine === 'number' &&
            typeof comment.selection.startColumn === 'number' &&
            typeof comment.selection.endLine === 'number' &&
            typeof comment.selection.endColumn === 'number' &&
            typeof comment.selectedText === 'string' &&
            typeof comment.comment === 'string' &&
            ['open', 'resolved', 'pending'].includes(comment.status) &&
            typeof comment.createdAt === 'string' &&
            typeof comment.updatedAt === 'string'
        );
    }

    /**
     * Relocate a single comment's position based on its anchor
     * Call this when document content has changed
     */
    async relocateComment(
        commentId: string,
        newContent: string,
        config: AnchorConfig = DEFAULT_ANCHOR_CONFIG
    ): Promise<AnchorRelocationResult | undefined> {
        const comment = this.config.comments.find(c => c.id === commentId);
        if (!comment || !comment.anchor) {
            return undefined;
        }

        const result = relocateAnchor(newContent, comment.anchor, config);

        if (result.found && result.selection) {
            // Update the comment's selection
            comment.selection = result.selection;

            // Update the anchor with new content
            comment.anchor = updateAnchor(newContent, result.selection, comment.anchor, config);
            comment.updatedAt = new Date().toISOString();

            await this.saveComments();

            this.fireEvent({
                type: 'comment-updated',
                comment,
                filePath: comment.filePath
            });
        }

        return result;
    }

    /**
     * Relocate all comments for a specific file
     * Call this when a document is opened or content changes significantly
     */
    async relocateCommentsForFile(
        filePath: string,
        newContent: string,
        config: AnchorConfig = DEFAULT_ANCHOR_CONFIG
    ): Promise<Map<string, AnchorRelocationResult>> {
        const relativePath = this.getRelativePath(filePath);
        const comments = this.config.comments.filter(c => c.filePath === relativePath);

        const results = new Map<string, AnchorRelocationResult>();
        let hasChanges = false;

        for (const comment of comments) {
            if (!comment.anchor) {
                // Create anchor if missing
                try {
                    comment.anchor = createAnchor(newContent, comment.selection);
                    hasChanges = true;
                    results.set(comment.id, {
                        found: true,
                        selection: comment.selection,
                        confidence: 1.0,
                        reason: 'exact_match'
                    });
                } catch {
                    results.set(comment.id, {
                        found: false,
                        confidence: 0,
                        reason: 'not_found'
                    });
                }
                continue;
            }

            // Check if relocation is needed
            if (!needsRelocation(newContent, comment.anchor, comment.selection)) {
                results.set(comment.id, {
                    found: true,
                    selection: comment.selection,
                    confidence: 1.0,
                    reason: 'exact_match'
                });
                continue;
            }

            // Relocate the anchor
            const result = relocateAnchor(newContent, comment.anchor, config);
            results.set(comment.id, result);

            if (result.found && result.selection) {
                comment.selection = result.selection;
                comment.anchor = updateAnchor(newContent, result.selection, comment.anchor, config);
                comment.updatedAt = new Date().toISOString();
                hasChanges = true;
            }
        }

        if (hasChanges) {
            await this.saveComments();
            this.fireEvent({
                type: 'comments-loaded',
                comments: this.config.comments,
                filePath: relativePath
            });
        }

        return results;
    }

    /**
     * Update the anchor for an existing comment
     * Call this when the user manually corrects a comment's position
     */
    async updateCommentAnchor(
        commentId: string,
        newContent: string,
        newSelection: CommentSelection,
        config: AnchorConfig = DEFAULT_ANCHOR_CONFIG
    ): Promise<boolean> {
        const comment = this.config.comments.find(c => c.id === commentId);
        if (!comment) {
            return false;
        }

        // Update selection and anchor
        comment.selection = newSelection;
        comment.anchor = updateAnchor(newContent, newSelection, comment.anchor, config);
        comment.updatedAt = new Date().toISOString();

        await this.saveComments();

        this.fireEvent({
            type: 'comment-updated',
            comment,
            filePath: comment.filePath
        });

        return true;
    }

    /**
     * Check if any comments for a file need relocation
     */
    checkNeedsRelocation(filePath: string, content: string): string[] {
        const relativePath = this.getRelativePath(filePath);
        const comments = this.config.comments.filter(c => c.filePath === relativePath);

        const needsRelocationIds: string[] = [];

        for (const comment of comments) {
            if (comment.anchor && needsRelocation(content, comment.anchor, comment.selection)) {
                needsRelocationIds.push(comment.id);
            }
        }

        return needsRelocationIds;
    }

    /**
     * Create anchors for all comments that don't have them
     * Useful for migrating existing comments to anchor-based tracking
     */
    async createMissingAnchors(): Promise<number> {
        let count = 0;

        for (const comment of this.config.comments) {
            if (!comment.anchor) {
                try {
                    const absolutePath = this.getAbsolutePath(comment.filePath);
                    if (fs.existsSync(absolutePath)) {
                        const content = fs.readFileSync(absolutePath, 'utf8');
                        comment.anchor = createAnchor(content, comment.selection);
                        count++;
                    }
                } catch (error) {
                    console.warn(`Failed to create anchor for comment ${comment.id}:`, error);
                }
            }
        }

        if (count > 0) {
            await this.saveComments();
        }

        return count;
    }

    /**
     * Get the count of open user comments (excluding AI comments)
     */
    getOpenUserCommentCount(): number {
        return this.config.comments.filter(c => c.status === 'open' && isUserComment(c)).length;
    }
}
