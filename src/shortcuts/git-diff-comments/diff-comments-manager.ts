/**
 * DiffCommentsManager - Handles storage and management of Git diff comments
 * Extends CommentsManagerBase to reuse common functionality
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CommentsManagerBase } from '../markdown-comments/comments-manager-base';
import {
    createDiffAnchor,
    needsDiffRelocation,
    relocateDiffAnchor,
    updateDiffAnchor
} from './diff-anchor';
import {
    CleanupResult,
    DEFAULT_DIFF_ANCHOR_CONFIG,
    DEFAULT_DIFF_COMMENTS_CONFIG,
    DEFAULT_DIFF_COMMENTS_SETTINGS,
    DIFF_COMMENTS_CONFIG_FILE,
    DiffAnchor,
    DiffAnchorConfig,
    DiffAnchorRelocationResult,
    DiffComment,
    DiffCommentEvent,
    DiffCommentsConfig,
    DiffCommentsSettings,
    DiffGitContext,
    DiffSelection,
    DiffSide
} from './types';

/**
 * Manages Git diff comments storage and operations
 * Extends the base comments manager with diff-specific functionality
 */
export class DiffCommentsManager extends CommentsManagerBase<
    DiffSelection,
    DiffAnchor,
    DiffComment,
    DiffCommentsSettings,
    DiffCommentsConfig,
    DiffCommentEvent
> {
    constructor(workspaceRoot: string) {
        super(workspaceRoot, DIFF_COMMENTS_CONFIG_FILE, {
            ...DEFAULT_DIFF_COMMENTS_CONFIG,
            comments: [],
            settings: { ...DEFAULT_DIFF_COMMENTS_SETTINGS }
        });
    }

    /**
     * Get the default configuration
     */
    protected getDefaultConfig(): DiffCommentsConfig {
        return {
            ...DEFAULT_DIFF_COMMENTS_CONFIG,
            comments: [],
            settings: { ...DEFAULT_DIFF_COMMENTS_SETTINGS }
        };
    }

    /**
     * Get the default settings
     */
    protected getDefaultSettings(): DiffCommentsSettings {
        return { ...DEFAULT_DIFF_COMMENTS_SETTINGS };
    }

    /**
     * Add a new diff comment
     */
    async addComment(
        filePath: string,
        selection: DiffSelection,
        selectedText: string,
        comment: string,
        gitContext: DiffGitContext,
        content?: string,
        author?: string,
        tags?: string[],
        type?: DiffComment['type']
    ): Promise<DiffComment> {
        const now = new Date().toISOString();
        const relativePath = this.getRelativePath(filePath);

        // Try to create anchor from content
        let anchor: DiffAnchor | undefined;
        if (content) {
            try {
                const startLine = selection.side === 'old' ? selection.oldStartLine : selection.newStartLine;
                const endLine = selection.side === 'old' ? selection.oldEndLine : selection.newEndLine;

                if (startLine !== null && endLine !== null) {
                    anchor = createDiffAnchor(
                        content,
                        startLine,
                        endLine,
                        selection.startColumn,
                        selection.endColumn,
                        selection.side
                    );
                }
            } catch (error) {
                console.warn('Failed to create anchor for diff comment:', error);
            }
        }

        const newComment: DiffComment = {
            id: this.generateId('diff_comment'),
            filePath: relativePath,
            selection,
            selectedText,
            comment,
            status: 'open',
            createdAt: now,
            updatedAt: now,
            author,
            tags,
            gitContext,
            anchor,
            type: type || 'user'
        };

        return this.addCommentToConfig(newComment);
    }

    /**
     * Get comments grouped by file
     */
    getCommentsGroupedByFile(): Map<string, DiffComment[]> {
        const grouped = new Map<string, DiffComment[]>();

        for (const comment of this.config.comments) {
            const existing = grouped.get(comment.filePath) || [];
            existing.push(comment);
            grouped.set(comment.filePath, existing);
        }

        // Sort comments within each file by line number
        for (const [, comments] of grouped) {
            comments.sort((a, b) => {
                const aLine = a.selection.oldStartLine ?? a.selection.newStartLine ?? 0;
                const bLine = b.selection.oldStartLine ?? b.selection.newStartLine ?? 0;
                if (aLine !== bLine) {
                    return aLine - bLine;
                }
                return a.selection.startColumn - b.selection.startColumn;
            });
        }

        return grouped;
    }

    /**
     * Validate and normalize the configuration
     */
    protected validateConfig(config: any): DiffCommentsConfig {
        const validated: DiffCommentsConfig = {
            version: typeof config.version === 'number' ? config.version : 1,
            comments: [],
            settings: {
                ...DEFAULT_DIFF_COMMENTS_SETTINGS,
                ...config.settings
            }
        };

        if (Array.isArray(config.comments)) {
            for (const comment of config.comments) {
                if (this.isValidComment(comment)) {
                    validated.comments.push(comment);
                } else {
                    console.warn('Skipping invalid diff comment:', comment);
                }
            }
        }

        return validated;
    }

    /**
     * Check if a comment object is valid
     */
    protected isValidComment(comment: any): comment is DiffComment {
        return (
            typeof comment === 'object' &&
            typeof comment.id === 'string' &&
            typeof comment.filePath === 'string' &&
            typeof comment.selection === 'object' &&
            typeof comment.selectedText === 'string' &&
            typeof comment.comment === 'string' &&
            ['open', 'resolved', 'pending'].includes(comment.status) &&
            typeof comment.createdAt === 'string' &&
            typeof comment.updatedAt === 'string' &&
            typeof comment.gitContext === 'object'
        );
    }

    /**
     * Relocate a single comment's position based on its anchor
     */
    async relocateComment(
        commentId: string,
        newContent: string,
        side: DiffSide,
        config: DiffAnchorConfig = DEFAULT_DIFF_ANCHOR_CONFIG
    ): Promise<DiffAnchorRelocationResult | undefined> {
        const comment = this.config.comments.find(c => c.id === commentId);
        if (!comment || !comment.anchor) {
            return undefined;
        }

        const result = relocateDiffAnchor(newContent, comment.anchor, side, config);

        if (result.found && result.selection) {
            // Update the comment's selection
            comment.selection = result.selection;

            // Update the anchor with new content
            const startLine = result.selection.oldStartLine ?? result.selection.newStartLine ?? 1;
            const endLine = result.selection.oldEndLine ?? result.selection.newEndLine ?? 1;

            comment.anchor = updateDiffAnchor(
                newContent,
                startLine,
                endLine,
                result.selection.startColumn,
                result.selection.endColumn,
                side,
                comment.anchor,
                config
            );
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
     */
    async relocateCommentsForFile(
        filePath: string,
        newContent: string,
        side: DiffSide,
        config: DiffAnchorConfig = DEFAULT_DIFF_ANCHOR_CONFIG
    ): Promise<Map<string, DiffAnchorRelocationResult>> {
        const relativePath = this.getRelativePath(filePath);
        const comments = this.config.comments.filter(c => c.filePath === relativePath);

        const results = new Map<string, DiffAnchorRelocationResult>();
        let hasChanges = false;

        for (const comment of comments) {
            if (!comment.anchor) {
                // Create anchor if missing
                try {
                    const startLine = comment.selection.oldStartLine ?? comment.selection.newStartLine ?? 1;
                    const endLine = comment.selection.oldEndLine ?? comment.selection.newEndLine ?? 1;

                    comment.anchor = createDiffAnchor(
                        newContent,
                        startLine,
                        endLine,
                        comment.selection.startColumn,
                        comment.selection.endColumn,
                        side
                    );
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
            const startLine = comment.selection.oldStartLine ?? comment.selection.newStartLine ?? 1;
            const endLine = comment.selection.oldEndLine ?? comment.selection.newEndLine ?? 1;

            if (!needsDiffRelocation(
                newContent,
                comment.anchor,
                startLine,
                endLine,
                comment.selection.startColumn,
                comment.selection.endColumn
            )) {
                results.set(comment.id, {
                    found: true,
                    selection: comment.selection,
                    confidence: 1.0,
                    reason: 'exact_match'
                });
                continue;
            }

            // Relocate the anchor
            const result = relocateDiffAnchor(newContent, comment.anchor, side, config);
            results.set(comment.id, result);

            if (result.found && result.selection) {
                comment.selection = result.selection;
                const newStartLine = result.selection.oldStartLine ?? result.selection.newStartLine ?? 1;
                const newEndLine = result.selection.oldEndLine ?? result.selection.newEndLine ?? 1;

                comment.anchor = updateDiffAnchor(
                    newContent,
                    newStartLine,
                    newEndLine,
                    result.selection.startColumn,
                    result.selection.endColumn,
                    side,
                    comment.anchor,
                    config
                );
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
     * Clean up obsolete comments that reference non-existent git state.
     * A comment is considered obsolete if:
     * - It references a commit that no longer exists
     * - It references a file in staged/unstaged changes that is no longer there
     * - The file has been cleaned up (reverted, committed, etc.)
     * 
     * @param currentChanges Array of file paths currently in git changes (staged/unstaged)
     * @returns CleanupResult with details about removed comments
     */
    async cleanupObsoleteComments(currentChanges: string[]): Promise<CleanupResult> {
        const totalBefore = this.config.comments.length;
        const removedIds: string[] = [];
        const removedReasons = new Map<string, string>();

        // Normalize current changes to relative paths for comparison
        const normalizedChanges = new Set(
            currentChanges.map(p => this.getRelativePath(p))
        );

        // Filter out obsolete comments
        this.config.comments = this.config.comments.filter(comment => {
            const isObsolete = this.isCommentObsolete(comment, normalizedChanges);
            if (isObsolete.obsolete) {
                removedIds.push(comment.id);
                removedReasons.set(comment.id, isObsolete.reason);
                return false;
            }
            return true;
        });

        const removed = removedIds.length;

        if (removed > 0) {
            await this.saveComments();
            this.fireEvent({
                type: 'comments-loaded',
                comments: this.config.comments
            });
        }

        return {
            totalBefore,
            removed,
            removedIds,
            removedReasons
        };
    }

    /**
     * Check if a comment is obsolete
     * @param comment The comment to check
     * @param currentChanges Set of file paths currently in git changes
     * @returns Object with obsolete flag and reason
     */
    private isCommentObsolete(
        comment: DiffComment,
        currentChanges: Set<string>
    ): { obsolete: boolean; reason: string } {
        const gitContext = comment.gitContext;

        // Check if this is a comment on a committed file (has commitHash)
        if (gitContext.commitHash) {
            // Verify the commit still exists
            if (!this.commitExists(gitContext.repositoryRoot, gitContext.commitHash)) {
                return {
                    obsolete: true,
                    reason: `Commit ${gitContext.commitHash.slice(0, 7)} no longer exists`
                };
            }
            // Committed file comments are valid as long as the commit exists
            return { obsolete: false, reason: '' };
        }

        // For staged/unstaged comments, check if the file is still in changes
        const filePath = comment.filePath;

        // Check if file is in current changes
        if (!currentChanges.has(filePath)) {
            // The file is no longer in staged/unstaged changes
            // This could be because:
            // - File was committed
            // - File was reverted/reset
            // - File was stashed
            const wasStaged = gitContext.wasStaged;
            const reason = wasStaged
                ? 'File is no longer in staged changes (may have been committed or unstaged)'
                : 'File is no longer in unstaged changes (may have been staged, committed, or reverted)';
            return { obsolete: true, reason };
        }

        // File is still in changes, comment is valid
        return { obsolete: false, reason: '' };
    }

    /**
     * Check if a commit exists in the repository
     * @param repoRoot Repository root path
     * @param commitHash Commit hash to check
     * @returns true if commit exists
     */
    private commitExists(repoRoot: string, commitHash: string): boolean {
        try {
            execSync(`git cat-file -t ${commitHash}`, {
                cwd: repoRoot,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 5000
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get the list of obsolete comments without removing them
     * Useful for previewing what would be cleaned up
     * 
     * @param currentChanges Array of file paths currently in git changes
     * @returns Array of obsolete comments with their reasons
     */
    getObsoleteComments(currentChanges: string[]): Array<{ comment: DiffComment; reason: string }> {
        const normalizedChanges = new Set(
            currentChanges.map(p => this.getRelativePath(p))
        );

        const obsoleteComments: Array<{ comment: DiffComment; reason: string }> = [];

        for (const comment of this.config.comments) {
            const isObsolete = this.isCommentObsolete(comment, normalizedChanges);
            if (isObsolete.obsolete) {
                obsoleteComments.push({
                    comment,
                    reason: isObsolete.reason
                });
            }
        }

        return obsoleteComments;
    }
}
