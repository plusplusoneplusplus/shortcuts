/**
 * Anchor Utilities
 *
 * Re-exports from pipeline-core (extracted in commits 001-003).
 * This file preserves the original import paths for extension consumers.
 */

// Re-export text-matching utilities (used directly by some consumers)
export {
    AnchorMatchConfig,
    DEFAULT_ANCHOR_MATCH_CONFIG,
    extractContext,
    findAllOccurrences,
    findFuzzyMatch,
    getCharOffset,
    hashText,
    offsetToLineColumn,
    scoreMatch,
    splitIntoLines
} from '@plusplusoneplusplus/pipeline-core';

// Anchor types
export {
    BaseAnchorData,
    AnchorRelocationResult as AnchorRelocationResultBase,
} from '@plusplusoneplusplus/pipeline-core/editor/anchor-types';

// Anchor functions
export {
    extractTextFromSelection,
    createAnchorData,
    relocateAnchorPosition,
    needsRelocationCheck,
    batchRelocateAnchors
} from '@plusplusoneplusplus/pipeline-core/editor/anchor';

