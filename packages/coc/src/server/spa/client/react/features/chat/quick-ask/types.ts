/**
 * Shared types for the Quick Ask side-notes feature (client side).
 * The persisted shape mirrors the server `ChatSideNote`.
 */

/** Selection anchor with fuzzy-relocation context. */
export interface QuickAskAnchor {
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
    fingerprint: string;
}

/** A persisted side-note as returned by the server. */
export interface ChatSideNote {
    id: string;
    processId: string;
    turnIndex: number;
    anchor: QuickAskAnchor;
    question?: string;
    answer: string;
    label: string;
    model?: string;
    createdAt: string;
}

/**
 * Client-side view of a side-note, including transient optimistic states that
 * are never persisted (`asking`, `error`).
 */
export interface ClientSideNote extends ChatSideNote {
    /** Lifecycle state for optimistic UI. `ready` items come from the server. */
    status: 'asking' | 'ready' | 'error';
    /** Error text when `status === 'error'`. */
    error?: string;
}

/**
 * One turn of a Quick Ask thread (multi-turn follow-up, notes/paper surfaces).
 * Turn 0 is the original ask; later turns are follow-ups. `question` is optional
 * on the first turn (default explain-this) but present on every follow-up.
 * `status` mirrors {@link ClientSideNote.status} per turn so each row can show
 * its own spinner / answer / inline error.
 */
export interface QuickAskTurn {
    question?: string;
    answer: string;
    status: 'asking' | 'ready' | 'error';
    error?: string;
}

/**
 * A captured text selection inside an assistant turn, ready to become a
 * side-note lookup.
 */
export interface QuickAskSelection {
    turnIndex: number;
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
    /** Viewport rect of the selection (for pill placement). */
    rect: { top: number; left: number; bottom: number; right: number };
}
