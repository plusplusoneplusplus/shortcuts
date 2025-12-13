/**
 * Webview logic module exports
 * 
 * This module exports all testable business logic for the webview.
 * These functions can be:
 * 1. Unit tested in Node.js
 * 2. Imported into the webview bundle for browser use
 */

// Comment state management
export {
    filterCommentsByStatus,
    sortCommentsByLine,
    sortCommentsByColumnDescending,
    groupCommentsByLine,
    getCommentsForLine,
    blockHasComments,
    countCommentsByStatus,
    findCommentById,
    updateCommentStatus,
    updateCommentText,
    deleteComment,
    resolveAllComments,
    getSelectionCoverageForLine
} from './comment-state';

// Selection utilities
export {
    SelectionPositionWithText,
    calculateColumnIndices,
    getHighlightColumnsForLine,
    createPlainToHtmlMapping,
    applyCommentHighlightToRange
} from './selection-utils';

// Markdown rendering
export {
    MarkdownLineResult,
    escapeHtml,
    applyInlineMarkdown,
    resolveImagePath,
    applyMarkdownHighlighting
} from './markdown-renderer';

// Cursor management
export {
    CursorPosition,
    MockNode,
    NODE_TYPES,
    calculateColumnOffset,
    findLineElement,
    getLineNumber,
    findTextNodeAtColumn,
    getCursorPositionFromSelection,
    adjustCursorAfterInsertion,
    adjustCursorAfterDeletion,
    validateCursorPosition,
    compareCursorPositions,
    isCursorInRange
} from './cursor-management';

// Content extraction
export {
    ContentExtractionResult,
    ExtractionContext,
    DEFAULT_SKIP_CLASSES,
    createExtractionContext,
    shouldSkipElement,
    isBlockElement,
    isLineContentElement,
    isLineRowElement,
    isBlockContentElement,
    isBrElement,
    processTextNode,
    addNewLine,
    extractBlockText,
    extractTableText,
    hasMeaningfulContentAfterBr,
    processNode,
    extractPlainTextContent,
    applyInsertion,
    applyDeletion,
    getTotalCharacterCount,
    positionToOffset,
    offsetToPosition
} from './content-extraction';

// Re-export line mapping utilities from webview-utils
export {
    ParsedTable,
    SelectionPosition,
    calculateTableCellLineNumber,
    calculateCodeBlockLineNumber,
    parseTableWithLineNumbers,
    parseTableRowCells,
    isTableSeparatorLine,
    parseTableAlignmentsFromSeparator,
    getTableRowLineNumbers,
    findTableRowAtLine,
    calculateColumnIndices as calculateColumnIndicesForLine,
    getSelectionCoverageForLine as getSelectionCoverageForLineFromUtils,
    MockTableRow,
    getLineFromTableCellLogic,
    getWebviewTableCellLineFunction,
    getWebviewCodeBlockLineFunction
} from '../webview-utils';

