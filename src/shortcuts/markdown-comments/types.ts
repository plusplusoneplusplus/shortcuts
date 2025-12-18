/**
 * Types and interfaces for the Markdown Comments feature
 */

/**
 * Comment status
 */
export type CommentStatus = 'open' | 'resolved' | 'pending';

/**
 * Comment type - distinguishes between user comments and different AI response types
 */
export type CommentType = 'user' | 'ai-suggestion' | 'ai-clarification' | 'ai-critique' | 'ai-question';

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
 * Anchor context for robust comment location tracking
 * Stores surrounding context to enable fuzzy matching after content changes
 */
export interface CommentAnchor {
    /** The exact selected/commented text */
    selectedText: string;
    /** Text appearing before the selection (up to N lines/characters) */
    contextBefore: string;
    /** Text appearing after the selection (up to N lines/characters) */
    contextAfter: string;
    /** Original line number when the comment was created (for fallback) */
    originalLine: number;
    /** Hash/fingerprint of the selected text for quick comparison */
    textHash: string;
}

/**
 * Result of anchor relocation attempt
 */
export interface AnchorRelocationResult {
    /** Whether the anchor was successfully relocated */
    found: boolean;
    /** The new selection if found */
    selection?: CommentSelection;
    /** Confidence score of the match (0-1) */
    confidence: number;
    /** Reason for the result */
    reason: 'exact_match' | 'fuzzy_match' | 'context_match' | 'line_fallback' | 'not_found';
}

/**
 * Mermaid diagram context for comments on diagrams
 */
export interface MermaidContext {
    /** The mermaid block identifier */
    diagramId: string;
    /** Specific node ID if commenting on a node */
    nodeId?: string;
    /** Display label of the node */
    nodeLabel?: string;
    /** Edge ID if commenting on an edge/link */
    edgeId?: string;
    /** Display label of the edge */
    edgeLabel?: string;
    /** Source node ID for the edge */
    edgeSourceNode?: string;
    /** Target node ID for the edge */
    edgeTargetNode?: string;
    /** Type of diagram (flowchart, sequence, etc.) */
    diagramType?: string;
    /** Element type discriminator */
    elementType?: 'node' | 'edge';
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
    /** Type of the comment (user or ai) - defaults to 'user' */
    type?: CommentType;
    /** ISO timestamp when created */
    createdAt: string;
    /** ISO timestamp when last updated */
    updatedAt: string;
    /** Optional author name */
    author?: string;
    /** Optional tags for categorization */
    tags?: string[];
    /** Optional mermaid diagram context */
    mermaidContext?: MermaidContext;
    /** Optional anchor for robust location tracking after content changes */
    anchor?: CommentAnchor;
}

/**
 * Check if a comment is a user comment (not an AI-generated comment).
 * Used for filtering prompts to only include human-added comments.
 * 
 * @param comment - The comment to check
 * @returns true if the comment is a user comment (type is undefined or 'user')
 */
export function isUserComment(comment: MarkdownComment): boolean {
    return !comment.type || comment.type === 'user';
}

/**
 * Settings for comments display
 */
export interface CommentsSettings {
    /** Whether to show resolved comments */
    showResolved: boolean;
    /** Highlight color for user comments (CSS color) */
    highlightColor: string;
    /** Highlight color for resolved comments (CSS color) */
    resolvedHighlightColor: string;
    /** Highlight color for AI suggestion comments (CSS color) */
    aiSuggestionHighlightColor: string;
    /** Highlight color for AI clarification comments (CSS color) */
    aiClarificationHighlightColor: string;
    /** Highlight color for AI critique comments (CSS color) */
    aiCritiqueHighlightColor: string;
    /** Highlight color for AI question comments (CSS color) */
    aiQuestionHighlightColor: string;
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
    highlightColor: 'rgba(255, 235, 59, 0.3)',           // Yellow for user comments
    resolvedHighlightColor: 'rgba(76, 175, 80, 0.2)',   // Green for resolved
    aiSuggestionHighlightColor: 'rgba(33, 150, 243, 0.3)',    // Blue for AI suggestions
    aiClarificationHighlightColor: 'rgba(156, 39, 176, 0.3)', // Purple for AI clarifications
    aiCritiqueHighlightColor: 'rgba(255, 152, 0, 0.3)',       // Orange for AI critiques
    aiQuestionHighlightColor: 'rgba(0, 188, 212, 0.3)'        // Cyan for AI questions
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

/**
 * AI tool types for clarification requests
 */
export type AIToolType = 'copilot-cli' | 'clipboard';

/**
 * AI instruction types for different kinds of queries
 */
export type AIInstructionType = 'clarify' | 'go-deeper' | 'custom';

/**
 * Document context for AI clarification requests
 */
export interface ClarificationContext {
    /** The selected text to clarify */
    selectedText: string;
    /** Selection line range */
    selectionRange: {
        startLine: number;
        endLine: number;
    };
    /** File being reviewed */
    filePath: string;
    /** Surrounding lines for context */
    surroundingContent: string;
    /** Nearest heading above selection */
    nearestHeading: string | null;
    /** All document headings for structure */
    headings: string[];
    /** Type of AI instruction */
    instructionType: AIInstructionType;
    /** Custom instruction text (only used when instructionType is 'custom') */
    customInstruction?: string;
}

/**
 * Configuration for AI clarification feature
 */
export interface AIClarificationConfig {
    /** Which AI tool to use */
    tool: AIToolType;
}

/**
 * Status of a clarification process
 */
export type ClarificationProcessStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * A tracked clarification process
 */
export interface ClarificationProcess {
    /** Unique identifier */
    id: string;
    /** Preview of the prompt (first ~50 chars) */
    promptPreview: string;
    /** Full prompt text */
    fullPrompt: string;
    /** Current status */
    status: ClarificationProcessStatus;
    /** When the process started */
    startTime: Date;
    /** When the process ended (if finished) */
    endTime?: Date;
    /** Error message if failed */
    error?: string;
    /** The clarification result if completed */
    result?: string;
}
