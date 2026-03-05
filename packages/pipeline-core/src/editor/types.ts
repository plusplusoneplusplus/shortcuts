/**
 * Core domain types for the Markdown Review Editor.
 *
 * These are platform-agnostic duplicates of the types originally defined
 * in src/shortcuts/markdown-comments/types.ts.  A follow-up commit will
 * update the extension to import from pipeline-core and delete the originals.
 */

// ---------------------------------------------------------------------------
// Comment enums
// ---------------------------------------------------------------------------

/** Status of a comment */
export type CommentStatus = 'open' | 'resolved' | 'pending';

/** Distinguishes user comments from different AI response types */
export type CommentType = 'user' | 'ai-suggestion' | 'ai-clarification' | 'ai-critique' | 'ai-question';

// ---------------------------------------------------------------------------
// Selection & positioning
// ---------------------------------------------------------------------------

/** Selection range within a markdown file (all values are 1-based) */
export interface CommentSelection {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

/**
 * Anchor context for robust comment location tracking.
 * Stores surrounding context to enable fuzzy matching after content changes.
 */
export interface CommentAnchor {
    /** The exact selected / commented text */
    selectedText: string;
    /** Text appearing before the selection */
    contextBefore: string;
    /** Text appearing after the selection */
    contextAfter: string;
    /** Original line number when the comment was created (fallback) */
    originalLine: number;
    /** Hash / fingerprint of the selected text for quick comparison */
    textHash: string;
}

// ---------------------------------------------------------------------------
// Mermaid context
// ---------------------------------------------------------------------------

/** Mermaid diagram context for comments on diagrams */
export interface MermaidContext {
    diagramId: string;
    nodeId?: string;
    nodeLabel?: string;
    edgeId?: string;
    edgeLabel?: string;
    edgeSourceNode?: string;
    edgeTargetNode?: string;
    diagramType?: string;
    elementType?: 'node' | 'edge';
}

// ---------------------------------------------------------------------------
// Comment
// ---------------------------------------------------------------------------

/** A single markdown comment */
export interface MarkdownComment {
    id: string;
    filePath: string;
    selection: CommentSelection;
    selectedText: string;
    comment: string;
    status: CommentStatus;
    type?: CommentType;
    createdAt: string;
    updatedAt: string;
    author?: string;
    tags?: string[];
    mermaidContext?: MermaidContext;
    anchor?: CommentAnchor;
}

/**
 * Check if a comment is a user comment (not AI-generated).
 */
export function isUserComment(comment: MarkdownComment): boolean {
    return !comment.type || comment.type === 'user';
}

// ---------------------------------------------------------------------------
// Diff comment selection & context
// ---------------------------------------------------------------------------

/**
 * Selection range within a rendered diff view.
 * `diffLineStart`/`diffLineEnd` are 0-based indices into the rendered diff line array.
 * `oldLine*` / `newLine*` carry the corresponding source-file line numbers when known.
 */
export interface DiffCommentSelection {
    /** 0-based start index into the rendered diff line array */
    diffLineStart: number;
    /** 0-based end index into the rendered diff line array (inclusive) */
    diffLineEnd: number;
    /** Which side of the diff the selection lives on */
    side: 'added' | 'removed' | 'context';
    /** Corresponding start line in the old (left) file, if applicable */
    oldLineStart?: number;
    /** Corresponding end line in the old (left) file, if applicable */
    oldLineEnd?: number;
    /** Corresponding start line in the new (right) file, if applicable */
    newLineStart?: number;
    /** Corresponding end line in the new (right) file, if applicable */
    newLineEnd?: number;
    /** 0-based start column within the line */
    startColumn: number;
    /** 0-based end column within the line */
    endColumn: number;
}

/**
 * Identifies the diff that a comment belongs to.
 * `oldRef` / `newRef` follow the same string conventions as the git CLI
 * (commit hash, branch name, "HEAD", "INDEX", etc.).
 */
export interface DiffCommentContext {
    /** Stable repository identifier (e.g. remote URL or local root path) */
    repositoryId: string;
    /** Repo-relative file path */
    filePath: string;
    /** Base ref for the diff (left side) */
    oldRef: string;
    /** Target ref for the diff (right side) */
    newRef: string;
    /** Resolved commit hash when the comment was created (for durability) */
    commitHash?: string;
}

// ---------------------------------------------------------------------------
// Diff comment
// ---------------------------------------------------------------------------

/**
 * A reply to a diff comment.
 */
export interface DiffCommentReply {
    /** Unique identifier (UUID). */
    id: string;
    /** Author name. */
    author: string;
    /** Reply text content. */
    text: string;
    /** ISO timestamp when created. */
    createdAt: string;
    /** Whether this reply was generated by AI. */
    isAI?: boolean;
}

/**
 * A comment attached to a specific location in a git diff view.
 */
export interface DiffComment {
    /** Unique identifier (UUID). */
    id: string;
    /** The diff context this comment belongs to. */
    context: DiffCommentContext;
    /** Selection range within the rendered diff. */
    selection: DiffCommentSelection;
    /** The actual selected text. */
    selectedText: string;
    /** User's comment content. */
    comment: string;
    /** Current status. */
    status: 'open' | 'resolved' | 'pending';
    /** ISO timestamp when created. */
    createdAt: string;
    /** ISO timestamp when last updated. */
    updatedAt: string;
    /** Optional author name. */
    author?: string;
    /** Optional tags. */
    tags?: string[];
    /** Threaded replies to this comment. */
    replies?: DiffCommentReply[];
    /** AI-generated clarification response. */
    aiResponse?: string;
    /**
     * True when the comment was created on a working-tree diff.
     * Working-tree diffs are transient, so these comments are considered ephemeral.
     */
    ephemeral?: boolean;
}

// ---------------------------------------------------------------------------
// Settings & configuration
// ---------------------------------------------------------------------------

/** Settings for comments display */
export interface CommentsSettings {
    showResolved: boolean;
    highlightColor: string;
    resolvedHighlightColor: string;
    aiSuggestionHighlightColor: string;
    aiClarificationHighlightColor: string;
    aiCritiqueHighlightColor: string;
    aiQuestionHighlightColor: string;
}

/** Configuration structure for markdown comments */
export interface CommentsConfig {
    version: number;
    comments: MarkdownComment[];
    settings?: CommentsSettings;
}

/** Default settings for comments */
export const DEFAULT_COMMENTS_SETTINGS: CommentsSettings = {
    showResolved: true,
    highlightColor: 'rgba(255, 235, 59, 0.3)',
    resolvedHighlightColor: 'rgba(76, 175, 80, 0.2)',
    aiSuggestionHighlightColor: 'rgba(33, 150, 243, 0.3)',
    aiClarificationHighlightColor: 'rgba(156, 39, 176, 0.3)',
    aiCritiqueHighlightColor: 'rgba(255, 152, 0, 0.3)',
    aiQuestionHighlightColor: 'rgba(0, 188, 212, 0.3)'
};

/** Default empty configuration */
export const DEFAULT_COMMENTS_CONFIG: CommentsConfig = {
    version: 1,
    comments: [],
    settings: DEFAULT_COMMENTS_SETTINGS
};
