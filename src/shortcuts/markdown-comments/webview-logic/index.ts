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
    blockHasComments,
    countCommentsByStatus, deleteComment, filterCommentsByStatus, findCommentById, getCommentsForLine, getSelectionCoverageForLine, groupCommentsByAllCoveredLines, groupCommentsByLine, resolveAllComments, sortCommentsByColumnDescending, sortCommentsByLine, updateCommentStatus,
    updateCommentText
} from './comment-state';

// Selection utilities
export {
    SelectionPositionWithText, applyCommentHighlightToRange, calculateColumnIndices, createPlainToHtmlMapping, getHighlightColumnsForLine
} from './selection-utils';

// Markdown rendering
export {
    MarkdownLineResult, applyInlineMarkdown, applyMarkdownHighlighting, escapeHtml, resolveImagePath
} from './markdown-renderer';

// Cursor management
export {
    CursorPosition,
    MockNode,
    NODE_TYPES, adjustCursorAfterDeletion, adjustCursorAfterInsertion, calculateColumnOffset, compareCursorPositions, findLineElement, findTextNodeAtColumn,
    getCursorPositionFromSelection, getLineNumber, isCursorInRange, validateCursorPosition
} from './cursor-management';

// Content extraction
export {
    ContentExtractionResult, DEFAULT_SKIP_CLASSES, ExtractionContext, addNewLine, applyDeletion, applyInsertion, createExtractionContext, extractBlockText, extractPlainTextContent, extractTableText, getTotalCharacterCount, hasMeaningfulContentAfterBr, isBlockContentElement, isBlockElement, isBrElement, isLineContentElement,
    isLineRowElement, offsetToPosition, positionToOffset, processNode, processTextNode, shouldSkipElement
} from './content-extraction';

// Re-export line mapping utilities from webview-utils
export {
    MockTableRow, ParsedTable,
    SelectionPosition, calculateCodeBlockLineNumber, calculateColumnIndices as calculateColumnIndicesForLine, calculateTableCellLineNumber, findTableRowAtLine, getLineFromTableCellLogic, getSelectionCoverageForLine as getSelectionCoverageForLineFromUtils, getTableRowLineNumbers, getWebviewCodeBlockLineFunction, getWebviewTableCellLineFunction, isTableSeparatorLine,
    parseTableAlignmentsFromSeparator, parseTableRowCells, parseTableWithLineNumbers
} from '../webview-utils';

