/**
 * Notes Comments — shared type definitions.
 *
 * Pure types, no runtime dependencies. Safe to import from server and client code.
 */

/** Anchor that locates a comment within a note's text content. */
export interface TextAnchor {
    /** The exact text that was highlighted when the comment was created. */
    quotedText: string;
    /** ~50 characters of context before the highlighted text. */
    prefix: string;
    /** ~50 characters of context after the highlighted text. */
    suffix: string;
}

/** A single comment within a thread. */
export interface Comment {
    /** UUID v4 identifier. */
    id: string;
    /** Plain-text comment body. */
    content: string;
    /** ISO 8601 creation timestamp. */
    createdAt: string;
    /** ISO 8601 timestamp of last edit, if edited. */
    updatedAt?: string;
}

/** A comment thread anchored to a text selection. */
export interface CommentThread {
    /** UUID v4 identifier. */
    id: string;
    /** Thread lifecycle status. */
    status: 'open' | 'resolved';
    /** ISO 8601 creation timestamp. */
    createdAt: string;
    /** ISO 8601 timestamp when resolved, if resolved. */
    resolvedAt?: string;
    /** Text anchor that locates this thread in the note. */
    anchor: TextAnchor;
    /** Ordered list of comments (oldest first). */
    comments: Comment[];
}

/** Sidecar file format — persisted as `<note-path>.comments.json`. */
export interface NoteSidecar {
    /** Schema version for future migrations. */
    version: 1;
    /** Map of thread ID → CommentThread. */
    threads: Record<string, CommentThread>;
}

/** Create an empty sidecar object with no threads. */
export function createEmptySidecar(): NoteSidecar {
    return { version: 1, threads: {} };
}
