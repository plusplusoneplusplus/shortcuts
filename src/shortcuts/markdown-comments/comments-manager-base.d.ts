/**
 * CommentsManagerBase - Base class for comments management
 * Provides shared functionality for both markdown and diff comments
 *
 * This module is free of VS Code dependencies — all platform-specific
 * behaviour is injected via constructor parameters (FileWatcherFactory, Logger).
 */
import { Logger } from '@plusplusoneplusplus/pipeline-core';
import { BaseAnchor, BaseComment, BaseCommentEvent, BaseCommentsConfig, BaseCommentsSettings, BaseSelection } from './base-types';
/** Matches the `vscode.Disposable` interface structurally. */
export interface Disposable {
    dispose(): void;
}
/**
 * Minimal typed event emitter that is a drop-in replacement for
 * `vscode.EventEmitter<T>`.  Backed by Node.js `EventEmitter`.
 */
export declare class TypedEventEmitter<T> {
    private readonly _emitter;
    private static readonly EVENT;
    /** Subscribe; returns a Disposable to unsubscribe. */
    readonly event: (listener: (e: T) => void) => Disposable;
    /** Emit an event to all subscribers. */
    fire(data: T): void;
    /** Remove all listeners and clean up. */
    dispose(): void;
}
/** Subset of `vscode.FileSystemWatcher` used by setupFileWatcher(). */
export interface FileWatcher extends Disposable {
    onDidChange: (listener: () => void) => Disposable;
    onDidCreate: (listener: () => void) => Disposable;
    onDidDelete: (listener: () => void) => Disposable;
}
/**
 * Factory that creates a FileWatcher for a given config file path.
 * The factory is responsible for constructing any watch patterns
 * (glob, RelativePattern, chokidar, etc.).
 */
export type FileWatcherFactory = (configPath: string) => FileWatcher;
/**
 * Abstract base class for managing comments storage and operations
 * Subclasses must implement type-specific validation and anchor operations
 */
export declare abstract class CommentsManagerBase<TSelection extends BaseSelection, TAnchor extends BaseAnchor, TComment extends BaseComment<TSelection, TAnchor>, TSettings extends BaseCommentsSettings, TConfig extends BaseCommentsConfig<TComment, TSettings>, TEvent extends BaseCommentEvent<TComment>> implements Disposable {
    protected readonly fileWatcherFactory?: FileWatcherFactory | undefined;
    protected readonly logger: Logger;
    protected readonly configPath: string;
    protected readonly workspaceRoot: string;
    protected config: TConfig;
    protected fileWatcher?: FileWatcher;
    protected debounceTimer?: NodeJS.Timeout;
    protected readonly _onDidChangeComments: TypedEventEmitter<TEvent>;
    readonly onDidChangeComments: (listener: (e: TEvent) => void) => Disposable;
    constructor(workspaceRoot: string, configFileName: string, defaultConfig: TConfig, fileWatcherFactory?: FileWatcherFactory | undefined, logger?: Logger);
    /**
     * Initialize the comments manager
     */
    initialize(): Promise<void>;
    /**
     * Load comments from the JSON file
     */
    loadComments(): Promise<TConfig>;
    /**
     * Save comments to the JSON file
     */
    saveComments(): Promise<void>;
    /**
     * Generate a unique comment ID
     */
    protected generateId(prefix?: string): string;
    /**
     * Get the ID prefix for generated comment IDs
     * Override in subclass to customize (e.g., 'comment', 'diff_comment')
     */
    protected getCommentIdPrefix(): string;
    /**
     * Update an existing comment
     */
    updateComment(commentId: string, updates: Partial<Pick<TComment, 'comment' | 'tags' | 'status'>>): Promise<TComment | undefined>;
    /**
     * Delete a comment
     */
    deleteComment(commentId: string): Promise<boolean>;
    /**
     * Mark a comment as resolved
     */
    resolveComment(commentId: string): Promise<TComment | undefined>;
    /**
     * Reopen a resolved comment
     */
    reopenComment(commentId: string): Promise<TComment | undefined>;
    /**
     * Resolve all open comments
     */
    resolveAllComments(): Promise<number>;
    /**
     * Delete all comments
     */
    deleteAllComments(): Promise<number>;
    /**
     * Get all comments
     */
    getAllComments(): TComment[];
    /**
     * Get comments for a specific file
     */
    getCommentsForFile(filePath: string): TComment[];
    /**
     * Get all open comments
     */
    getOpenComments(): TComment[];
    /**
     * Get all resolved comments
     */
    getResolvedComments(): TComment[];
    /**
     * Get a comment by ID
     */
    getComment(commentId: string): TComment | undefined;
    /**
     * Get current settings
     */
    getSettings(): TSettings;
    /**
     * Update settings
     */
    updateSettings(settings: Partial<TSettings>): Promise<void>;
    /**
     * Get the absolute path for a relative path
     */
    getAbsolutePath(relativePath: string): string;
    /**
     * Get a relative path from an absolute path
     */
    protected getRelativePath(filePath: string): string;
    /**
     * Get the configuration file path
     */
    getConfigPath(): string;
    /**
     * Check if there are any comments
     */
    hasComments(): boolean;
    /**
     * Get the count of open comments
     */
    getOpenCommentCount(): number;
    /**
     * Get the count of resolved comments
     */
    getResolvedCommentCount(): number;
    /**
     * Get files that have comments
     */
    getFilesWithComments(): string[];
    /**
     * Get comments grouped by file.
     * Comments within each file are sorted by line number.
     * Subclasses can override getLineNumber to customize sorting.
     */
    getCommentsGroupedByFile(): Map<string, TComment[]>;
    /**
     * Get the start line number from a comment.
     * Subclasses can override this to handle different selection types.
     */
    protected getStartLine(comment: TComment): number;
    /**
     * Get comment count for a file
     */
    getCommentCountForFile(filePath: string): number;
    /**
     * Setup file watcher for external changes
     */
    protected setupFileWatcher(): void;
    /**
     * Fire a comment event
     */
    protected fireEvent(eventData: Partial<TEvent>): void;
    /**
     * Add a comment to the config and save
     */
    protected addCommentToConfig(newComment: TComment): Promise<TComment>;
    /**
     * Dispose of resources
     */
    dispose(): void;
    /**
     * Helper method for validating config structure.
     * Subclasses can use this in their validateConfig implementation.
     */
    protected validateConfigStructure(config: any, defaultSettings: TSettings): {
        version: number;
        comments: TComment[];
        settings: TSettings;
    };
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
    /**
     * Create anchor from content - must be implemented by subclass
     * @param content File or diff content
     * @param selection Type-specific selection object
     * @param additionalContext Optional context (unused in base)
     * @returns Anchor or undefined if creation fails
     */
    protected abstract createAnchorFromContent(content: string, selection: TSelection, additionalContext?: any): TAnchor | undefined;
    /**
     * Safely create anchor with error handling
     * @param content Content string (or undefined)
     * @param selection Selection object
     * @param additionalContext Optional context
     * @returns Anchor or undefined if creation fails or content is undefined
     */
    protected tryCreateAnchor(content: string | undefined, selection: TSelection, additionalContext?: any): TAnchor | undefined;
    /**
     * Create base comment object with common fields
     * Subclasses add type-specific fields via spread operator
     * @param filePath Absolute or relative file path
     * @param selection Type-specific selection object
     * @param selectedText The selected text content
     * @param comment The comment text
     * @param author Optional author
     * @param tags Optional tags
     * @returns Partial comment object with common fields
     */
    protected createCommentBase(filePath: string, selection: TSelection, selectedText: string, comment: string, author?: string, tags?: string[]): Pick<TComment, 'id' | 'filePath' | 'selection' | 'selectedText' | 'comment' | 'status' | 'createdAt' | 'updatedAt' | 'author' | 'tags'>;
}
//# sourceMappingURL=comments-manager-base.d.ts.map