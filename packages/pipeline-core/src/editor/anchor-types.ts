/**
 * Anchor Types
 *
 * Platform-agnostic interfaces for anchor-based comment location tracking.
 * Used by both the VS Code extension and the CoC standalone server.
 */

/**
 * Base anchor data created from a text selection.
 * Stores enough context to relocate the selection after content changes.
 */
export interface BaseAnchorData {
    /** The exact selected/commented text */
    selectedText: string;
    /** Text appearing before the selection */
    contextBefore: string;
    /** Text appearing after the selection */
    contextAfter: string;
    /** Original line number when the anchor was created (for fallback) */
    originalLine: number;
    /** Hash/fingerprint of the selected text for quick comparison */
    textHash: string;
}

/** Strategy used to relocate an anchor */
export type AnchorRelocationStrategy =
    | 'exact_match'
    | 'fuzzy_match'
    | 'context_match'
    | 'line_fallback'
    | 'not_found';

/**
 * Result of an anchor relocation attempt.
 * Contains the new position (if found) and metadata about the match quality.
 */
export interface AnchorRelocationResult {
    /** Whether the anchor was successfully relocated */
    found: boolean;
    /** New start line (1-based), present when found */
    startLine?: number;
    /** New end line (1-based), present when found */
    endLine?: number;
    /** New start column (1-based), present when found */
    startColumn?: number;
    /** New end column (1-based), present when found */
    endColumn?: number;
    /** Confidence score of the match (0-1) */
    confidence: number;
    /** Strategy that produced this result */
    reason: AnchorRelocationStrategy;
}
