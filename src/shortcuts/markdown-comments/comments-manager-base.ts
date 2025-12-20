/**
 * CommentsManagerBase - Base class for comments management
 * Provides shared functionality for both markdown and diff comments
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    BaseAnchor,
    BaseComment,
    BaseCommentEvent,
    BaseCommentEventType,
    BaseCommentsConfig,
    BaseCommentsSettings,
    BaseSelection
} from './base-types';

/**
 * Abstract base class for managing comments storage and operations
 * Subclasses must implement type-specific validation and anchor operations
 */
export abstract class CommentsManagerBase<
    TSelection extends BaseSelection,
    TAnchor extends BaseAnchor,
    TComment extends BaseComment<TSelection, TAnchor>,
    TSettings extends BaseCommentsSettings,
    TConfig extends BaseCommentsConfig<TComment, TSettings>,
    TEvent extends BaseCommentEvent<TComment>
> implements vscode.Disposable {
    protected readonly configPath: string;
    protected readonly workspaceRoot: string;
    protected config: TConfig;
    protected fileWatcher?: vscode.FileSystemWatcher;
    protected debounceTimer?: NodeJS.Timeout;

    protected readonly _onDidChangeComments = new vscode.EventEmitter<TEvent>();
    readonly onDidChangeComments: vscode.Event<TEvent> = this._onDidChangeComments.event;

    constructor(
        workspaceRoot: string,
        configFileName: string,
        defaultConfig: TConfig
    ) {
        this.workspaceRoot = workspaceRoot;
        this.configPath = path.join(workspaceRoot, '.vscode', configFileName);
        this.config = { ...defaultConfig };
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
    async loadComments(): Promise<TConfig> {
        try {
            if (fs.existsSync(this.configPath)) {
                const content = fs.readFileSync(this.configPath, 'utf8');
                const parsed = JSON.parse(content) as TConfig;
                this.config = this.validateConfig(parsed);
            } else {
                this.config = this.getDefaultConfig();
            }

            this.fireEvent({
                type: 'comments-loaded',
                comments: this.config.comments
            } as Partial<TEvent>);

            return this.config;
        } catch (error) {
            console.error('Error loading comments:', error);
            this.config = this.getDefaultConfig();
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
    protected generateId(prefix: string = 'comment'): string {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Update an existing comment
     */
    async updateComment(
        commentId: string,
        updates: Partial<Pick<TComment, 'comment' | 'tags' | 'status'>>
    ): Promise<TComment | undefined> {
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
        let eventType: BaseCommentEventType = 'comment-updated';
        if (updates.status !== undefined && updates.status !== previousStatus) {
            if (updates.status === 'resolved') {
                eventType = 'comment-resolved';
            } else if (previousStatus === 'resolved') {
                eventType = 'comment-reopened';
            }
        }

        this.fireEvent({
            type: eventType,
            comment,
            filePath: comment.filePath
        } as Partial<TEvent>);

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

        this.fireEvent({
            type: 'comment-deleted',
            comment: deletedComment,
            filePath: deletedComment.filePath
        } as Partial<TEvent>);

        return true;
    }

    /**
     * Mark a comment as resolved
     */
    async resolveComment(commentId: string): Promise<TComment | undefined> {
        return this.updateComment(commentId, { status: 'resolved' } as Partial<Pick<TComment, 'comment' | 'tags' | 'status'>>);
    }

    /**
     * Reopen a resolved comment
     */
    async reopenComment(commentId: string): Promise<TComment | undefined> {
        return this.updateComment(commentId, { status: 'open' } as Partial<Pick<TComment, 'comment' | 'tags' | 'status'>>);
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
            this.fireEvent({
                type: 'comment-resolved',
                comments: this.config.comments.filter(c => c.status === 'resolved')
            } as Partial<TEvent>);
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
            this.fireEvent({
                type: 'comments-loaded',
                comments: []
            } as unknown as Partial<TEvent>);
        }

        return count;
    }

    /**
     * Get all comments
     */
    getAllComments(): TComment[] {
        return [...this.config.comments];
    }

    /**
     * Get comments for a specific file
     */
    getCommentsForFile(filePath: string): TComment[] {
        const relativePath = this.getRelativePath(filePath);
        return this.config.comments.filter(c => c.filePath === relativePath);
    }

    /**
     * Get all open comments
     */
    getOpenComments(): TComment[] {
        return this.config.comments.filter(c => c.status === 'open');
    }

    /**
     * Get all resolved comments
     */
    getResolvedComments(): TComment[] {
        return this.config.comments.filter(c => c.status === 'resolved');
    }

    /**
     * Get a comment by ID
     */
    getComment(commentId: string): TComment | undefined {
        return this.config.comments.find(c => c.id === commentId);
    }

    /**
     * Get current settings
     */
    getSettings(): TSettings {
        return this.config.settings || this.getDefaultSettings();
    }

    /**
     * Update settings
     */
    async updateSettings(settings: Partial<TSettings>): Promise<void> {
        this.config.settings = {
            ...this.getDefaultSettings(),
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
    protected getRelativePath(filePath: string): string {
        if (!path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.relative(this.workspaceRoot, filePath);
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
     * Get comment count for a file
     */
    getCommentCountForFile(filePath: string): number {
        const relativePath = this.getRelativePath(filePath);
        return this.config.comments.filter(c => c.filePath === relativePath).length;
    }

    /**
     * Setup file watcher for external changes
     */
    protected setupFileWatcher(): void {
        const configFileName = path.basename(this.configPath);
        const pattern = new vscode.RelativePattern(
            path.dirname(this.configPath),
            configFileName
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
            this.config = this.getDefaultConfig();
            this.fireEvent({
                type: 'comments-loaded',
                comments: []
            } as unknown as Partial<TEvent>);
        });
    }

    /**
     * Fire a comment event
     */
    protected fireEvent(eventData: Partial<TEvent>): void {
        this._onDidChangeComments.fire(eventData as TEvent);
    }

    /**
     * Add a comment to the config and save
     */
    protected async addCommentToConfig(newComment: TComment): Promise<TComment> {
        this.config.comments.push(newComment);
        await this.saveComments();

        this.fireEvent({
            type: 'comment-added',
            comment: newComment,
            filePath: newComment.filePath
        } as Partial<TEvent>);

        return newComment;
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

    // Abstract methods that subclasses must implement

    /**
     * Get the default configuration
     */
    protected abstract getDefaultConfig(): TConfig;

    /**
     * Get the default settings
     */
    protected abstract getDefaultSettings(): TSettings;

    /**
     * Validate and normalize the configuration
     */
    protected abstract validateConfig(config: any): TConfig;

    /**
     * Check if a comment object is valid
     */
    protected abstract isValidComment(comment: any): comment is TComment;
}
