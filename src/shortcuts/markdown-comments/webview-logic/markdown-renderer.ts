/**
 * Markdown rendering utilities
 *
 * Re-exports from pipeline-core (extracted in commits 001-003).
 * This file preserves the original import paths for webview-scripts consumers.
 * Uses subpath import for browser-safe webview bundling.
 */
export {
    MarkdownLineResult,
    escapeHtml,
    generateAnchorId,
    applyMarkdownHighlighting,
    applySourceModeHighlighting,
    applySourceModeInlineHighlighting,
    applyInlineMarkdown,
    resolveImagePath
} from '@plusplusoneplusplus/pipeline-core/editor/rendering';

