/**
 * Types and interfaces for the Markdown Comments feature
 */

/**
 * Comment status
 */
export type CommentStatus = 'open' | 'resolved' | 'pending';

/**
 * Selection range within a markdown file
 */
export interface CommentSelection {
    /** 1-based line number where selection starts */
    startLine: number;
    /** 1-based column number where selection starts */
    startColumn: number;
    /** 1-based line number where selection ends */
    endLine: number;
    /** 1-based column number where selection ends */
    endColumn: number;
}

/**
 * A single markdown comment
 */
export interface MarkdownComment {
    /** Unique identifier (UUID) */
    id: string;
    /** Relative path to .md file */
    filePath: string;
    /** Selection range in the file */
    selection: CommentSelection;
    /** The actual selected text (for reference) */
    selectedText: string;
    /** User's comment content */
    comment: string;
    /** Current status of the comment */
    status: CommentStatus;
    /** ISO timestamp when created */
    createdAt: string;
    /** ISO timestamp when last updated */
    updatedAt: string;
    /** Optional author name */
    author?: string;
    /** Optional tags for categorization */
    tags?: string[];
}

/**
 * Settings for comments display
 */
export interface CommentsSettings {
    /** Whether to show resolved comments */
    showResolved: boolean;
    /** Highlight color for comments (CSS color) */
    highlightColor: string;
    /** Highlight color for resolved comments (CSS color) */
    resolvedHighlightColor: string;
}

/**
 * Configuration structure for markdown comments
 */
export interface CommentsConfig {
    /** Configuration version number */
    version: number;
    /** Array of all comments */
    comments: MarkdownComment[];
    /** Display settings */
    settings?: CommentsSettings;
}

/**
 * Default settings for comments
 */
export const DEFAULT_COMMENTS_SETTINGS: CommentsSettings = {
    showResolved: true,
    highlightColor: 'rgba(255, 235, 59, 0.3)',
    resolvedHighlightColor: 'rgba(76, 175, 80, 0.2)'
};

/**
 * Default empty configuration
 */
export const DEFAULT_COMMENTS_CONFIG: CommentsConfig = {
    version: 1,
    comments: [],
    settings: DEFAULT_COMMENTS_SETTINGS
};

/**
 * Comments configuration file name
 */
export const COMMENTS_CONFIG_FILE = 'md-comments.json';

/**
 * Options for prompt generation
 */
export interface PromptGenerationOptions {
    /** Include entire file in prompt */
    includeFullFileContent: boolean;
    /** Group comments by file */
    groupByFile: boolean;
    /** Include exact line numbers */
    includeLineNumbers: boolean;
    /** Custom instructions at the start */
    customPreamble?: string;
    /** Custom instructions at the end */
    customInstructions?: string;
    /** Maximum comments per prompt (split large prompts) */
    maxCommentsPerPrompt?: number;
    /** Output format */
    outputFormat: 'markdown' | 'json';
}

/**
 * Default prompt generation options
 */
export const DEFAULT_PROMPT_OPTIONS: PromptGenerationOptions = {
    includeFullFileContent: false,
    groupByFile: true,
    includeLineNumbers: true,
    outputFormat: 'markdown'
};

/**
 * Comment event types for the event emitter
 */
export type CommentEventType =
    | 'comment-added'
    | 'comment-updated'
    | 'comment-deleted'
    | 'comment-resolved'
    | 'comment-reopened'
    | 'comments-loaded';

/**
 * Comment event data
 */
export interface CommentEvent {
    type: CommentEventType;
    comment?: MarkdownComment;
    comments?: MarkdownComment[];
    filePath?: string;
}

/**
 * Tree item data for the comments panel
 */
export interface CommentTreeItemData {
    type: 'file' | 'comment';
    filePath?: string;
    comment?: MarkdownComment;
    commentCount?: number;
}
