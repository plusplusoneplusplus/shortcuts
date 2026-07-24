/**
 * Rendering module exports
 *
 * Pure TypeScript rendering primitives for markdown content.
 * These functions have no DOM or editor-host dependencies, so they are
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
    MarkdownRenderInlineOptions,
    applyInlineMarkdown,
    applyMarkdownHighlighting,
    applySourceModeHighlighting,
    applySourceModeInlineHighlighting,
    escapeHtml,
    generateAnchorId,
    resolveImagePath
} from './markdown-renderer';

export {
    DEFAULT_HTML_EMBED_HEIGHT,
    MAX_HTML_EMBED_HEIGHT,
    MIN_HTML_EMBED_HEIGHT,
    isEmbeddableHtmlPath,
    parseHtmlEmbedTitle,
    type HtmlEmbedOptions,
} from './html-embed';

export {
    DEFAULT_MAP_EMBED_HEIGHT,
    MAX_MAP_EMBED_HEIGHT,
    MIN_MAP_EMBED_HEIGHT,
    isEmbeddableMapUrl,
} from './map-embed';

export {
    DEFAULT_PDF_EMBED_HEIGHT,
    MAX_PDF_EMBED_HEIGHT,
    MIN_PDF_EMBED_HEIGHT,
    isPdfUrl,
} from './pdf-embed';

export {
    isYouTubeUrl,
    parseYouTubeVideoId,
    youTubeEmbedUrl,
} from './youtube-embed';

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
