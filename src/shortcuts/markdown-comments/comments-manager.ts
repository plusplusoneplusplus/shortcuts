/**
 * CommentsManager - Handles storage and management of markdown comments
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    CommentEvent,
    CommentEventType,
    COMMENTS_CONFIG_FILE,
    CommentsConfig,
    CommentsSettings,
    DEFAULT_COMMENTS_CONFIG,
    DEFAULT_COMMENTS_SETTINGS,
    MarkdownComment
} from './types';

/**
 * Manages markdown comments storage and operations
 */
export class CommentsManager implements vscode.Disposable {
    private readonly configPath: string;
    private readonly workspaceRoot: string;
    private config: CommentsConfig;
    private fileWatcher?: vscode.FileSystemWatcher;
    private debounceTimer?: NodeJS.Timeout;

    private readonly _onDidChangeComments = new vscode.EventEmitter<CommentEvent>();
    readonly onDidChangeComments: vscode.Event<CommentEvent> = this._onDidChangeComments.event;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configPath = path.join(workspaceRoot, '.vscode', COMMENTS_CONFIG_FILE);
        this.config = { ...DEFAULT_COMMENTS_CONFIG };
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
    async loadComments(): Promise<CommentsConfig> {
        try {
            if (fs.existsSync(this.configPath)) {
                const content = fs.readFileSync(this.configPath, 'utf8');
                const parsed = JSON.parse(content) as CommentsConfig;
                this.config = this.validateConfig(parsed);
            } else {
                this.config = { ...DEFAULT_COMMENTS_CONFIG };
            }

            this._onDidChangeComments.fire({
                type: 'comments-loaded',
                comments: this.config.comments
            });

            return this.config;
        } catch (error) {
            console.error('Error loading comments:', error);
            this.config = { ...DEFAULT_COMMENTS_CONFIG };
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
            console.error('Error saving comments:', error);
            throw error;
        }
    }

    /**
     * Generate a unique comment ID
     */
    private generateId(): string {
        return `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
        tags?: string[]
    ): Promise<MarkdownComment> {
        const now = new Date().toISOString();
        const relativePath = this.getRelativePath(filePath);

        const newComment: MarkdownComment = {
            id: this.generateId(),
            filePath: relativePath,
            selection,
            selectedText,
            comment,
            status: 'open',
            createdAt: now,
            updatedAt: now,
            author,
            tags
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
        updates: Partial<Pick<MarkdownComment, 'comment' | 'tags' | 'status'>>
    ): Promise<MarkdownComment | undefined> {
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
        let eventType: CommentEventType = 'comment-updated';
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
    async resolveComment(commentId: string): Promise<MarkdownComment | undefined> {
        return this.updateComment(commentId, { status: 'resolved' });
    }

    /**
     * Reopen a resolved comment
     */
    async reopenComment(commentId: string): Promise<MarkdownComment | undefined> {
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
     * Get all comments
     */
    getAllComments(): MarkdownComment[] {
        return [...this.config.comments];
    }

    /**
     * Get comments for a specific file
     */
    getCommentsForFile(filePath: string): MarkdownComment[] {
        const relativePath = this.getRelativePath(filePath);
        return this.config.comments.filter(c => c.filePath === relativePath);
    }

    /**
     * Get all open comments
     */
    getOpenComments(): MarkdownComment[] {
        return this.config.comments.filter(c => c.status === 'open');
    }

    /**
     * Get all resolved comments
     */
    getResolvedComments(): MarkdownComment[] {
        return this.config.comments.filter(c => c.status === 'resolved');
    }

    /**
     * Get comments grouped by file
     */
    getCommentsGroupedByFile(): Map<string, MarkdownComment[]> {
        const grouped = new Map<string, MarkdownComment[]>();

        for (const comment of this.config.comments) {
            const existing = grouped.get(comment.filePath) || [];
            existing.push(comment);
            grouped.set(comment.filePath, existing);
        }

        // Sort comments within each file by line number
        Array.from(grouped.entries()).forEach(([file, comments]) => {
            comments.sort((a, b) => {
                if (a.selection.startLine !== b.selection.startLine) {
                    return a.selection.startLine - b.selection.startLine;
                }
                return a.selection.startColumn - b.selection.startColumn;
            });
        });

        return grouped;
    }

    /**
     * Get a comment by ID
     */
    getComment(commentId: string): MarkdownComment | undefined {
        return this.config.comments.find(c => c.id === commentId);
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
     * Get current settings
     */
    getSettings(): CommentsSettings | undefined {
        return this.config.settings || DEFAULT_COMMENTS_SETTINGS;
    }

    /**
     * Update settings
     */
    async updateSettings(settings: Partial<CommentsSettings>): Promise<void> {
        this.config.settings = {
            ...DEFAULT_COMMENTS_SETTINGS,
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
    private validateConfig(config: any): CommentsConfig {
        const validated: CommentsConfig = {
            version: typeof config.version === 'number' ? config.version : 1,
            comments: [],
            settings: {
                ...DEFAULT_COMMENTS_SETTINGS,
                ...config.settings
            }
        };

        if (Array.isArray(config.comments)) {
            for (const comment of config.comments) {
                if (this.isValidComment(comment)) {
                    validated.comments.push(comment);
                } else {
                    console.warn('Skipping invalid comment:', comment);
                }
            }
        }

        return validated;
    }

    /**
     * Check if a comment object is valid
     */
    private isValidComment(comment: any): comment is MarkdownComment {
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
     * Setup file watcher for external changes
     */
    private setupFileWatcher(): void {
        const pattern = new vscode.RelativePattern(
            path.dirname(this.configPath),
            COMMENTS_CONFIG_FILE
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
            this.config = { ...DEFAULT_COMMENTS_CONFIG };
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
