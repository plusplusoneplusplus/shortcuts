"use strict";
/**
 * CommentsManagerBase - Base class for comments management
 * Provides shared functionality for both markdown and diff comments
 *
 * This module is free of VS Code dependencies — all platform-specific
 * behaviour is injected via constructor parameters (FileWatcherFactory, Logger).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommentsManagerBase = exports.TypedEventEmitter = void 0;
const events_1 = require("events");
const path = __importStar(require("path"));
const pipeline_core_1 = require("@plusplusoneplusplus/pipeline-core");
const pipeline_core_2 = require("@plusplusoneplusplus/pipeline-core");
/**
 * Minimal typed event emitter that is a drop-in replacement for
 * `vscode.EventEmitter<T>`.  Backed by Node.js `EventEmitter`.
 */
class TypedEventEmitter {
    constructor() {
        this._emitter = new events_1.EventEmitter();
        /** Subscribe; returns a Disposable to unsubscribe. */
        this.event = (listener) => {
            this._emitter.on(TypedEventEmitter.EVENT, listener);
            return {
                dispose: () => {
                    this._emitter.removeListener(TypedEventEmitter.EVENT, listener);
                }
            };
        };
    }
    /** Emit an event to all subscribers. */
    fire(data) {
        this._emitter.emit(TypedEventEmitter.EVENT, data);
    }
    /** Remove all listeners and clean up. */
    dispose() {
        this._emitter.removeAllListeners();
    }
}
exports.TypedEventEmitter = TypedEventEmitter;
TypedEventEmitter.EVENT = 'event';
/**
 * Abstract base class for managing comments storage and operations
 * Subclasses must implement type-specific validation and anchor operations
 */
class CommentsManagerBase {
    constructor(workspaceRoot, configFileName, defaultConfig, fileWatcherFactory, logger = pipeline_core_2.consoleLogger) {
        this.fileWatcherFactory = fileWatcherFactory;
        this.logger = logger;
        this._onDidChangeComments = new TypedEventEmitter();
        this.onDidChangeComments = this._onDidChangeComments.event;
        this.workspaceRoot = workspaceRoot;
        this.configPath = path.join(workspaceRoot, '.vscode', configFileName);
        // Deep copy to ensure each instance has its own config
        this.config = JSON.parse(JSON.stringify(defaultConfig));
    }
    /**
     * Initialize the comments manager
     */
    async initialize() {
        await this.loadComments();
        this.setupFileWatcher();
    }
    /**
     * Load comments from the JSON file
     */
    async loadComments() {
        try {
            if ((0, pipeline_core_1.safeExists)(this.configPath)) {
                const readResult = (0, pipeline_core_1.safeReadFile)(this.configPath);
                if (readResult.success && readResult.data) {
                    const parsed = JSON.parse(readResult.data);
                    this.config = this.validateConfig(parsed);
                }
                else {
                    this.config = this.getDefaultConfig();
                }
            }
            else {
                this.config = this.getDefaultConfig();
            }
            this.fireEvent({
                type: 'comments-loaded',
                comments: this.config.comments
            });
            return this.config;
        }
        catch (error) {
            this.logger.error('Comments', 'Error loading comments', error instanceof Error ? error : undefined);
            this.config = this.getDefaultConfig();
            return this.config;
        }
    }
    /**
     * Save comments to the JSON file
     */
    async saveComments() {
        try {
            // Ensure .vscode directory exists
            const configDir = path.dirname(this.configPath);
            (0, pipeline_core_1.ensureDirectoryExists)(configDir);
            const content = JSON.stringify(this.config, null, 2);
            const result = (0, pipeline_core_1.safeWriteFile)(this.configPath, content);
            if (!result.success) {
                throw result.error || new Error('Failed to write comments file');
            }
        }
        catch (error) {
            this.logger.error('Comments', 'Error saving comments', error instanceof Error ? error : undefined);
            throw error;
        }
    }
    /**
     * Generate a unique comment ID
     */
    generateId(prefix = 'comment') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    /**
     * Get the ID prefix for generated comment IDs
     * Override in subclass to customize (e.g., 'comment', 'diff_comment')
     */
    getCommentIdPrefix() {
        return 'comment';
    }
    /**
     * Update an existing comment
     */
    async updateComment(commentId, updates) {
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
        let eventType = 'comment-updated';
        if (updates.status !== undefined && updates.status !== previousStatus) {
            if (updates.status === 'resolved') {
                eventType = 'comment-resolved';
            }
            else if (previousStatus === 'resolved') {
                eventType = 'comment-reopened';
            }
        }
        this.fireEvent({
            type: eventType,
            comment,
            filePath: comment.filePath
        });
        return comment;
    }
    /**
     * Delete a comment
     */
    async deleteComment(commentId) {
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
        });
        return true;
    }
    /**
     * Mark a comment as resolved
     */
    async resolveComment(commentId) {
        return this.updateComment(commentId, { status: 'resolved' });
    }
    /**
     * Reopen a resolved comment
     */
    async reopenComment(commentId) {
        return this.updateComment(commentId, { status: 'open' });
    }
    /**
     * Resolve all open comments
     */
    async resolveAllComments() {
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
            });
        }
        return count;
    }
    /**
     * Delete all comments
     */
    async deleteAllComments() {
        const count = this.config.comments.length;
        if (count > 0) {
            this.config.comments = [];
            await this.saveComments();
            this.fireEvent({
                type: 'comments-loaded',
                comments: []
            });
        }
        return count;
    }
    /**
     * Get all comments
     */
    getAllComments() {
        return [...this.config.comments];
    }
    /**
     * Get comments for a specific file
     */
    getCommentsForFile(filePath) {
        const relativePath = this.getRelativePath(filePath);
        return this.config.comments.filter(c => c.filePath === relativePath);
    }
    /**
     * Get all open comments
     */
    getOpenComments() {
        return this.config.comments.filter(c => c.status === 'open');
    }
    /**
     * Get all resolved comments
     */
    getResolvedComments() {
        return this.config.comments.filter(c => c.status === 'resolved');
    }
    /**
     * Get a comment by ID
     */
    getComment(commentId) {
        return this.config.comments.find(c => c.id === commentId);
    }
    /**
     * Get current settings
     */
    getSettings() {
        return this.config.settings || this.getDefaultSettings();
    }
    /**
     * Update settings
     */
    async updateSettings(settings) {
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
    getAbsolutePath(relativePath) {
        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }
        return path.join(this.workspaceRoot, relativePath);
    }
    /**
     * Get a relative path from an absolute path
     */
    getRelativePath(filePath) {
        if (!path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.relative(this.workspaceRoot, filePath);
    }
    /**
     * Get the configuration file path
     */
    getConfigPath() {
        return this.configPath;
    }
    /**
     * Check if there are any comments
     */
    hasComments() {
        return this.config.comments.length > 0;
    }
    /**
     * Get the count of open comments
     */
    getOpenCommentCount() {
        return this.config.comments.filter(c => c.status === 'open').length;
    }
    /**
     * Get the count of resolved comments
     */
    getResolvedCommentCount() {
        return this.config.comments.filter(c => c.status === 'resolved').length;
    }
    /**
     * Get files that have comments
     */
    getFilesWithComments() {
        const files = new Set();
        for (const comment of this.config.comments) {
            files.add(comment.filePath);
        }
        return Array.from(files).sort();
    }
    /**
     * Get comments grouped by file.
     * Comments within each file are sorted by line number.
     * Subclasses can override getLineNumber to customize sorting.
     */
    getCommentsGroupedByFile() {
        const grouped = new Map();
        for (const comment of this.config.comments) {
            const existing = grouped.get(comment.filePath) || [];
            existing.push(comment);
            grouped.set(comment.filePath, existing);
        }
        // Sort comments within each file by line number
        for (const [, comments] of grouped) {
            comments.sort((a, b) => {
                const aLine = this.getStartLine(a);
                const bLine = this.getStartLine(b);
                if (aLine !== bLine) {
                    return aLine - bLine;
                }
                return a.selection.startColumn - b.selection.startColumn;
            });
        }
        return grouped;
    }
    /**
     * Get the start line number from a comment.
     * Subclasses can override this to handle different selection types.
     */
    getStartLine(comment) {
        return comment.selection.startLine ??
            comment.selection.newStartLine ??
            comment.selection.oldStartLine ??
            0;
    }
    /**
     * Get comment count for a file
     */
    getCommentCountForFile(filePath) {
        const relativePath = this.getRelativePath(filePath);
        return this.config.comments.filter(c => c.filePath === relativePath).length;
    }
    /**
     * Setup file watcher for external changes
     */
    setupFileWatcher() {
        if (!this.fileWatcherFactory) {
            return; // No watcher in pure Node.js environments
        }
        this.fileWatcher = this.fileWatcherFactory(this.configPath);
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
            });
        });
    }
    /**
     * Fire a comment event
     */
    fireEvent(eventData) {
        this._onDidChangeComments.fire(eventData);
    }
    /**
     * Add a comment to the config and save
     */
    async addCommentToConfig(newComment) {
        this.config.comments.push(newComment);
        await this.saveComments();
        this.fireEvent({
            type: 'comment-added',
            comment: newComment,
            filePath: newComment.filePath
        });
        return newComment;
    }
    /**
     * Dispose of resources
     */
    dispose() {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this._onDidChangeComments.dispose();
    }
    /**
     * Helper method for validating config structure.
     * Subclasses can use this in their validateConfig implementation.
     */
    validateConfigStructure(config, defaultSettings) {
        const validated = {
            version: typeof config.version === 'number' ? config.version : 1,
            comments: [],
            settings: {
                ...defaultSettings,
                ...config.settings
            }
        };
        if (Array.isArray(config.comments)) {
            for (const comment of config.comments) {
                if (this.isValidComment(comment)) {
                    validated.comments.push(comment);
                }
                else {
                    console.warn('Skipping invalid comment:', comment);
                }
            }
        }
        return validated;
    }
    /**
     * Safely create anchor with error handling
     * @param content Content string (or undefined)
     * @param selection Selection object
     * @param additionalContext Optional context
     * @returns Anchor or undefined if creation fails or content is undefined
     */
    tryCreateAnchor(content, selection, additionalContext) {
        if (!content) {
            return undefined;
        }
        try {
            return this.createAnchorFromContent(content, selection, additionalContext);
        }
        catch (error) {
            console.warn('Failed to create anchor for comment:', error);
            return undefined;
        }
    }
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
    createCommentBase(filePath, selection, selectedText, comment, author, tags) {
        const now = new Date().toISOString();
        const relativePath = this.getRelativePath(filePath);
        return {
            id: this.generateId(this.getCommentIdPrefix()),
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
    }
}
exports.CommentsManagerBase = CommentsManagerBase;
//# sourceMappingURL=comments-manager-base.js.map