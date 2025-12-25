/**
 * Comment Anchor Module
 * 
 * Provides anchor-based tracking for comment locations.
 * When document content changes, anchors allow relocating comments
 * by matching surrounding context using fuzzy matching algorithms.
 * 
 * Uses shared anchor utilities from ../shared/anchor-utils.ts
 */

import { AnchorRelocationResult, CommentAnchor, CommentSelection } from './types';
import {
    AnchorMatchConfig,
    createAnchorData,
    DEFAULT_ANCHOR_MATCH_CONFIG,
    extractTextFromSelection,
    hashText,
    needsRelocationCheck,
    relocateAnchorPosition
} from '../shared/anchor-utils';

// Re-export shared functions for backward compatibility
export {
    hashText,
    extractTextFromSelection
};
export {
    calculateSimilarity,
    findAllOccurrences,
    findFuzzyMatch,
    getCharOffset,
    levenshteinDistance,
    normalizeText,
    offsetToLineColumn,
    scoreMatch,
    splitIntoLines
} from '../shared/text-matching';

/**
 * Configuration for anchor creation and matching
 * Re-exported from shared module for backward compatibility
 */
export type AnchorConfig = AnchorMatchConfig;

/**
 * Default anchor configuration
 * Re-exported from shared module for backward compatibility
 */
export const DEFAULT_ANCHOR_CONFIG: AnchorConfig = DEFAULT_ANCHOR_MATCH_CONFIG;

/**
 * Extract text from document content given a selection
 */
export function extractSelectedText(content: string, selection: CommentSelection): string {
    return extractTextFromSelection(
        content,
        selection.startLine,
        selection.endLine,
        selection.startColumn,
        selection.endColumn
    );
}

/**
 * Create an anchor from document content and selection
 */
export function createAnchor(
    content: string,
    selection: CommentSelection,
    config: AnchorConfig = DEFAULT_ANCHOR_CONFIG
): CommentAnchor {
    const anchorData = createAnchorData(
        content,
        selection.startLine,
        selection.endLine,
        selection.startColumn,
        selection.endColumn,
        config
    );

    return {
        selectedText: anchorData.selectedText,
        contextBefore: anchorData.contextBefore,
        contextAfter: anchorData.contextAfter,
        originalLine: anchorData.originalLine,
        textHash: anchorData.textHash
    };
}

/**
 * Relocate a comment anchor in updated content
 */
export function relocateAnchor(
    content: string,
    anchor: CommentAnchor,
    config: AnchorConfig = DEFAULT_ANCHOR_CONFIG
): AnchorRelocationResult {
    const result = relocateAnchorPosition(content, anchor, config);

    if (result.found && result.startLine !== undefined) {
        return {
            found: true,
            selection: {
                startLine: result.startLine,
                startColumn: result.startColumn!,
                endLine: result.endLine!,
                endColumn: result.endColumn!
            },
            confidence: result.confidence,
            reason: result.reason
        };
    }

    return {
        found: false,
        confidence: result.confidence,
        reason: result.reason
    };
}

/**
 * Check if an anchor needs relocation (content has changed)
 */
export function needsRelocation(
    content: string,
    anchor: CommentAnchor,
    currentSelection: CommentSelection
): boolean {
    return needsRelocationCheck(
        content,
        anchor,
        currentSelection.startLine,
        currentSelection.endLine,
        currentSelection.startColumn,
        currentSelection.endColumn
    );
}

/**
 * Update an anchor with new content (after successful relocation)
 */
export function updateAnchor(
    content: string,
    selection: CommentSelection,
    existingAnchor?: CommentAnchor,
    config: AnchorConfig = DEFAULT_ANCHOR_CONFIG
): CommentAnchor {
    const newAnchor = createAnchor(content, selection, config);

    // Preserve original line from existing anchor if available
    if (existingAnchor) {
        // Keep the original line for reference
        return {
            ...newAnchor,
            originalLine: existingAnchor.originalLine
        };
    }

    return newAnchor;
}

/**
 * Batch relocate multiple anchors in a document
 * More efficient than individual relocations
 */
export function batchRelocateAnchors(
    content: string,
    anchors: Array<{ id: string; anchor: CommentAnchor; currentSelection: CommentSelection }>,
    config: AnchorConfig = DEFAULT_ANCHOR_CONFIG
): Map<string, AnchorRelocationResult> {
    const results = new Map<string, AnchorRelocationResult>();

    for (const { id, anchor, currentSelection } of anchors) {
        // Check if relocation is needed
        if (!needsRelocation(content, anchor, currentSelection)) {
            results.set(id, {
                found: true,
                selection: currentSelection,
                confidence: 1.0,
                reason: 'exact_match'
            });
        } else {
            results.set(id, relocateAnchor(content, anchor, config));
        }
    }

    return results;
}
