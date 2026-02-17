/**
 * Selection utilities for line number calculations and DOM operations
 *
 * Re-exports from pipeline-core (extracted in commits 001-003).
 * This file preserves the original import paths for webview-scripts consumers.
 * Uses subpath import for browser-safe webview bundling.
 */
export {
    SelectionPositionWithText,
    applyCommentHighlightToRange,
    calculateColumnIndices,
    createPlainToHtmlMapping,
    getHighlightColumnsForLine
} from '@plusplusoneplusplus/pipeline-core/editor/rendering';

