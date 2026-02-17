/**
 * Markdown parsing utilities for the Review Editor View
 *
 * Re-exports from pipeline-core (extracted in commits 001-003).
 * This file preserves the original import paths for extension consumers.
 * Uses subpath import for browser-safe bundling.
 */
export {
    // Types
    CodeBlock,
    MarkdownHighlightResult,
    MarkdownLineType,
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
    // Utilities
    getLanguageDisplayName,
} from '@plusplusoneplusplus/pipeline-core/editor/parsing';

// generateAnchorId and escapeHtml re-exported from rendering module
export { generateAnchorId, escapeHtml } from '@plusplusoneplusplus/pipeline-core/editor/rendering';
