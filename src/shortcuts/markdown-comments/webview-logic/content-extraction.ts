/**
 * Content extraction utilities for the webview editor
 *
 * Re-exports from pipeline-core (extracted in commits 001-003).
 * This file preserves the original import paths for webview-scripts consumers.
 * Uses subpath import for browser-safe webview bundling.
 */
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
} from '@plusplusoneplusplus/pipeline-core/editor/rendering';
