/**
 * Rendering module exports
 *
 * Pure TypeScript rendering primitives for markdown content.
 * These functions have no DOM or VS Code dependencies — they are
 * string-in, string-out transformations suitable for any environment.
 */

// Comment state management
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
} from './comment-state';

// Selection utilities
export {
    SelectionPositionWithText,
    applyCommentHighlightToRange,
    calculateColumnIndices,
    createPlainToHtmlMapping,
    getHighlightColumnsForLine
} from './selection-utils';

// Markdown rendering
export {
    MarkdownLineResult,
    applyInlineMarkdown,
    applyMarkdownHighlighting,
    applySourceModeHighlighting,
    applySourceModeInlineHighlighting,
    escapeHtml,
    generateAnchorId,
    resolveImagePath
} from './markdown-renderer';

// Cursor management
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
} from './cursor-management';

// Content extraction
export {
    ContentExtractionResult,
    DEFAULT_SKIP_CLASSES,
    ExtractionContext,
    addNewLine,
    applyDeletion,
    applyInsertion,
    createExtractionContext,
    extractBlockText,
    extractPlainTextContent,
    extractTableText,
    getTotalCharacterCount,
    hasMeaningfulContentAfterBr,
    isBlockContentElement,
    isBlockElement,
    isBrElement,
    isLineContentElement,
    isLineRowElement,
    normalizeExtractedLine,
    offsetToPosition,
    positionToOffset,
    processNode,
    processTextNode,
    shouldSkipElement
} from './content-extraction';

// Heading parser
export {
    HeadingInfo,
    buildSectionMap,
    findSectionEndLine,
    generateAnchorId as generateHeadingAnchorId,
    getHeadingAnchorId,
    getHeadingLevel,
    parseHeadings
} from './heading-parser';
