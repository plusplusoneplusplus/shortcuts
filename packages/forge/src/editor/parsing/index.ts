/**
 * Parsing module exports
 *
 * Pure TypeScript markdown parsing and block rendering utilities.
 * These functions have no DOM or VS Code dependencies — they are
 * string-in, structured-data-out transformations suitable for any environment.
 */

// Markdown structural parser
export {
    // Types
    CodeBlock,
    MarkdownHighlightResult,
    MarkdownLineType,
    ParsedTable,
    // Code block parsing
    parseCodeBlocks,
    hasMermaidBlocks,
    parseMermaidBlocks,
    // Heading / line-level detection
    detectHeadingLevel,
    isBlockquote,
    isUnorderedListItem,
    isOrderedListItem,
    isHorizontalRule,
    isTaskListItem,
    isCodeFenceStart,
    isCodeFenceEnd,
    detectLineType,
    // Emphasis
    detectEmphasis,
    // Links & images
    extractLinks,
    extractInlineCode,
    extractImages,
    isExternalImageUrl,
    isDataUrl,
    // Table parsing
    parseTableRow,
    parseTableAlignments,
    isTableSeparator,
    isTableRow,
    parseTable,
    parseTables,
    // Utilities
    getLanguageDisplayName,
    // NOTE: generateAnchorId is intentionally omitted here to avoid
    // conflicting with the identical export from ../rendering/markdown-renderer.
    // Import it directly from './markdown-parser' if needed.
} from './markdown-parser';

// Block renderers (pure HTML string generation)
export {
    // Types
    TableRenderOptions,
    CodeBlockRenderOptions,
    // Renderers
    renderTable,
    renderCodeBlock,
    renderMermaidContainer
} from './block-renderers';
