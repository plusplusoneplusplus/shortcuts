/**
 * DiffCommentsManager - Handles storage and management of Git diff comments
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    createDiffAnchor,
    needsDiffRelocation,
    relocateDiffAnchor,
    updateDiffAnchor
} from './diff-anchor';
import {
    DEFAULT_DIFF_ANCHOR_CONFIG,
    DEFAULT_DIFF_COMMENTS_CONFIG,
    DEFAULT_DIFF_COMMENTS_SETTINGS,
    DIFF_COMMENTS_CONFIG_FILE,
    DiffAnchor,
    DiffAnchorConfig,
    DiffAnchorRelocationResult,
    DiffComment,
    DiffCommentEvent,
    DiffCommentEventType,
    DiffCommentStatus,
    DiffCommentsConfig,
    DiffCommentsSettings,
    DiffGitContext,
    DiffSelection,
    DiffSide
} from './types';

/**
 * Manages Git diff comments storage and operations
 */
export class DiffCommentsManager implements vscode.Disposable {
    private readonly configPath: string;
    private readonly workspaceRoot: string;
    private config: DiffCommentsConfig;
    private fileWatcher?: vscode.FileSystemWatcher;
    private debounceTimer?: NodeJS.Timeout;

    private readonly _onDidChangeComments = new vscode.EventEmitter<DiffCommentEvent>();
    readonly onDidChangeComments: vscode.Event<DiffCommentEvent> = this._onDidChangeComments.event;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configPath = path.join(workspaceRoot, '.vscode', DIFF_COMMENTS_CONFIG_FILE);
        this.config = { ...DEFAULT_DIFF_COMMENTS_CONFIG };
    }

    /**
     * Initialize the comments manager
     */
    async initialize(): Promise<void> {
        await this.loadComments();
        this.setupFileWatcher();
    }

    /**
     * Load comments from the JSON file
     */
    async loadComments(): Promise<DiffCommentsConfig> {
        try {
            if (fs.existsSync(this.configPath)) {
                const content = fs.readFileSync(this.configPath, 'utf8');
                const parsed = JSON.parse(content) as DiffCommentsConfig;
                this.config = this.validateConfig(parsed);
            } else {
                this.config = { ...DEFAULT_DIFF_COMMENTS_CONFIG };
            }

            this._onDidChangeComments.fire({
                type: 'comments-loaded',
                comments: this.config.comments
            });

            return this.config;
        } catch (error) {
            console.error('Error loading diff comments:', error);
            this.config = { ...DEFAULT_DIFF_COMMENTS_CONFIG };
            return this.config;
        }
    }

    /**
     * Save comments to the JSON file
     */
    async saveComments(): Promise<void> {
        try {
            // Ensure .vscode directory exists
            const configDir = path.dirname(this.configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            const content = JSON.stringify(this.config, null, 2);
            fs.writeFileSync(this.configPath, content, 'utf8');
        } catch (error) {
            console.error('Error saving diff comments:', error);
            throw error;
        }
    }

    /**
     * Generate a unique comment ID
     */
    private generateId(): string {
        return `diff_comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
        tags?: string[]
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
            id: this.generateId(),
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
            anchor
        };

        this.config.comments.push(newComment);
        await this.saveComments();

        this._onDidChangeComments.fire({
            type: 'comment-added',
            comment: newComment,
            filePath: relativePath
        });

        return newComment;
    }

    /**
     * Update an existing comment
     */
    async updateComment(
        commentId: string,
        updates: Partial<Pick<DiffComment, 'comment' | 'tags' | 'status'>>
    ): Promise<DiffComment | undefined> {
        const comment = this.config.comments.find(c => c.id === commentId);
        if (!comment) {
            return undefined;
        }

        const previousStatus = comment.status;

        if (updates.comment !== undefined) {
            comment.comment = updates.comment;
        }
        if (updates.tags !== undefined) {
            comment.tags = updates.tags;
        }
        if (updates.status !== undefined) {
            comment.status = updates.status;
        }

        comment.updatedAt = new Date().toISOString();
        await this.saveComments();

        // Determine the event type
        let eventType: DiffCommentEventType = 'comment-updated';
        if (updates.status !== undefined && updates.status !== previousStatus) {
            if (updates.status === 'resolved') {
                eventType = 'comment-resolved';
            } else if (previousStatus === 'resolved') {
                eventType = 'comment-reopened';
            }
        }

        this._onDidChangeComments.fire({
            type: eventType,
            comment,
            filePath: comment.filePath
        });

        return comment;
    }

    /**
     * Delete a comment
     */
    async deleteComment(commentId: string): Promise<boolean> {
        const index = this.config.comments.findIndex(c => c.id === commentId);
        if (index === -1) {
            return false;
        }

        const [deletedComment] = this.config.comments.splice(index, 1);
        await this.saveComments();

        this._onDidChangeComments.fire({
            type: 'comment-deleted',
            comment: deletedComment,
            filePath: deletedComment.filePath
        });

        return true;
    }

    /**
     * Mark a comment as resolved
     */
    async resolveComment(commentId: string): Promise<DiffComment | undefined> {
        return this.updateComment(commentId, { status: 'resolved' });
    }

    /**
     * Reopen a resolved comment
     */
    async reopenComment(commentId: string): Promise<DiffComment | undefined> {
        return this.updateComment(commentId, { status: 'open' });
    }

    /**
     * Resolve all open comments
     */
    async resolveAllComments(): Promise<number> {
        let count = 0;
        for (const comment of this.config.comments) {
            if (comment.status === 'open') {
                comment.status = 'resolved';
                comment.updatedAt = new Date().toISOString();
                count++;
            }
        }

        if (count > 0) {
            await this.saveComments();
            this._onDidChangeComments.fire({
                type: 'comment-resolved',
                comments: this.config.comments.filter(c => c.status === 'resolved')
            });
        }

        return count;
    }

    /**
     * Delete all comments
     */
    async deleteAllComments(): Promise<number> {
        const count = this.config.comments.length;

        if (count > 0) {
            this.config.comments = [];
            await this.saveComments();
            this._onDidChangeComments.fire({
                type: 'comments-loaded',
                comments: []
            });
        }

        return count;
    }

    /**
     * Get all comments
     */
    getAllComments(): DiffComment[] {
        return [...this.config.comments];
    }

    /**
     * Get comments for a specific file
     */
    getCommentsForFile(filePath: string): DiffComment[] {
        const relativePath = this.getRelativePath(filePath);
        return this.config.comments.filter(c => c.filePath === relativePath);
    }

    /**
     * Get all open comments
     */
    getOpenComments(): DiffComment[] {
        return this.config.comments.filter(c => c.status === 'open');
    }

    /**
     * Get all resolved comments
     */
    getResolvedComments(): DiffComment[] {
        return this.config.comments.filter(c => c.status === 'resolved');
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
     * Get a comment by ID
     */
    getComment(commentId: string): DiffComment | undefined {
        return this.config.comments.find(c => c.id === commentId);
    }

    /**
     * Get current settings
     */
    getSettings(): DiffCommentsSettings {
        return this.config.settings || DEFAULT_DIFF_COMMENTS_SETTINGS;
    }

    /**
     * Update settings
     */
    async updateSettings(settings: Partial<DiffCommentsSettings>): Promise<void> {
        this.config.settings = {
            ...DEFAULT_DIFF_COMMENTS_SETTINGS,
            ...this.config.settings,
            ...settings
        };
        await this.saveComments();
    }

    /**
     * Get the absolute path for a relative path
     */
    getAbsolutePath(relativePath: string): string {
        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }
        return path.join(this.workspaceRoot, relativePath);
    }

    /**
     * Get a relative path from an absolute path
     */
    private getRelativePath(filePath: string): string {
        if (!path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.relative(this.workspaceRoot, filePath);
    }

    /**
     * Validate and normalize the configuration
     */
    private validateConfig(config: any): DiffCommentsConfig {
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
    private isValidComment(comment: any): comment is DiffComment {
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
     * Setup file watcher for external changes
     */
    private setupFileWatcher(): void {
        const pattern = new vscode.RelativePattern(
            path.dirname(this.configPath),
            DIFF_COMMENTS_CONFIG_FILE
        );

        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        const handleChange = () => {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = setTimeout(() => {
                this.loadComments();
            }, 300);
        };

        this.fileWatcher.onDidChange(handleChange);
        this.fileWatcher.onDidCreate(handleChange);
        this.fileWatcher.onDidDelete(() => {
            this.config = { ...DEFAULT_DIFF_COMMENTS_CONFIG };
            this._onDidChangeComments.fire({
                type: 'comments-loaded',
                comments: []
            });
        });
    }

    /**
     * Get the configuration file path
     */
    getConfigPath(): string {
        return this.configPath;
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

            this._onDidChangeComments.fire({
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
            this._onDidChangeComments.fire({
                type: 'comments-loaded',
                comments: this.config.comments,
                filePath: relativePath
            });
        }

        return results;
    }

    /**
     * Check if there are any comments
     */
    hasComments(): boolean {
        return this.config.comments.length > 0;
    }

    /**
     * Get the count of open comments
     */
    getOpenCommentCount(): number {
        return this.config.comments.filter(c => c.status === 'open').length;
    }

    /**
     * Get the count of resolved comments
     */
    getResolvedCommentCount(): number {
        return this.config.comments.filter(c => c.status === 'resolved').length;
    }

    /**
     * Get files that have comments
     */
    getFilesWithComments(): string[] {
        const files = new Set<string>();
        for (const comment of this.config.comments) {
            files.add(comment.filePath);
        }
        return Array.from(files).sort();
    }

    /**
     * Get comment count for a file (for display in tree view)
     */
    getCommentCountForFile(filePath: string): number {
        const relativePath = this.getRelativePath(filePath);
        return this.config.comments.filter(c => c.filePath === relativePath).length;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this._onDidChangeComments.dispose();
    }
}

