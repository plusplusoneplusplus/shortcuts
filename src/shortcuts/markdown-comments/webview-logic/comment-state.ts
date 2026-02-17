/**
 * Comment state management utilities
 *
 * Re-exports from pipeline-core (extracted in commits 001-003).
 * This file preserves the original import paths for webview-scripts consumers.
 * Uses subpath import for browser-safe webview bundling.
 */
export {
    blockHasComments,
    countCommentsByStatus,
    deleteComment,
    filterCommentsByStatus,
    findCommentById,
    getCommentsForLine,
    getSelectionCoverageForLine,
    groupCommentsByAllCoveredLines,
    groupCommentsByLine,
    resolveAllComments,
    sortCommentsByColumnDescending,
    sortCommentsByLine,
    updateCommentStatus,
    updateCommentText
} from '@plusplusoneplusplus/pipeline-core/editor/rendering';

