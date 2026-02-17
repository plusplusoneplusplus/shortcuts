/**
 * Cursor management utilities for the webview editor
 *
 * Re-exports from pipeline-core (extracted in commits 001-003).
 * This file preserves the original import paths for webview-scripts consumers.
 * Uses subpath import for browser-safe webview bundling.
 */
export {
    CursorPosition,
    MockNode,
    NODE_TYPES,
    TextNodeReference,
    adjustCursorAfterDeletion,
    adjustCursorAfterInsertion,
    calculateColumnOffset,
    compareCursorPositions,
    findLineElement,
    findTextNodeAtColumn,
    getCursorPositionFromSelection,
    getLineNumber,
    isCursorInRange,
    restoreCursorAfterContentChange,
    validateCursorPosition
} from '@plusplusoneplusplus/pipeline-core/editor/rendering';
