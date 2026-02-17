/**
 * Heading parsing utilities for the markdown review editor
 *
 * Re-exports from pipeline-core (extracted in commits 001-003).
 * This file preserves the original import paths for webview-scripts consumers.
 * Uses subpath import for browser-safe webview bundling.
 */
export {
    HeadingInfo,
    buildSectionMap,
    findSectionEndLine,
    generateHeadingAnchorId as generateAnchorId,
    getHeadingAnchorId,
    getHeadingLevel,
    parseHeadings
} from '@plusplusoneplusplus/pipeline-core/editor/rendering';
