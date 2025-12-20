/**
 * Base State Management for Webviews
 * 
 * Provides common state management patterns for webview scripts.
 */

/**
 * Base comment interface that both markdown and diff comments share
 */
export interface BaseComment {
    id: string;
    comment: string;
    selectedText: string;
    status: 'open' | 'resolved';
    createdAt: string;
    updatedAt?: string;
}

/**
 * Base settings interface
 */
export interface BaseSettings {
    showResolved: boolean;
}

/**
 * Interaction state for preventing click-to-close during resize/drag
 */
export interface InteractionState {
    isInteracting: boolean;
    interactionEndTimeout: ReturnType<typeof setTimeout> | null;
}

/**
 * Create initial interaction state
 */
export function createInteractionState(): InteractionState {
    return {
        isInteracting: false,
        interactionEndTimeout: null
    };
}

/**
 * Start an interaction (resize/drag) that should prevent click-to-close
 */
export function startInteraction(state: InteractionState): void {
    if (state.interactionEndTimeout) {
        clearTimeout(state.interactionEndTimeout);
        state.interactionEndTimeout = null;
    }
    state.isInteracting = true;
}

/**
 * End an interaction with a small delay to prevent click events
 */
export function endInteraction(state: InteractionState): void {
    state.interactionEndTimeout = setTimeout(() => {
        state.isInteracting = false;
        state.interactionEndTimeout = null;
    }, 100);
}

/**
 * Filter comments by line range
 */
export function filterCommentsByLineRange<T extends BaseComment>(
    comments: T[],
    lineNum: number,
    getStartLine: (comment: T) => number,
    getEndLine: (comment: T) => number
): T[] {
    return comments.filter(c =>
        getStartLine(c) <= lineNum &&
        getEndLine(c) >= lineNum
    );
}

/**
 * Filter visible comments based on settings
 */
export function filterVisibleComments<T extends BaseComment>(
    comments: T[],
    showResolved: boolean
): T[] {
    if (showResolved) {
        return comments;
    }
    return comments.filter(c => c.status !== 'resolved');
}

/**
 * Find a comment by ID
 */
export function findCommentById<T extends BaseComment>(
    comments: T[],
    id: string
): T | undefined {
    return comments.find(c => c.id === id);
}

