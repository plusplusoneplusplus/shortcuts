/**
 * Diff Anchor Module
 * 
 * Provides anchor-based tracking for diff comment locations.
 * When document content changes, anchors allow relocating comments
 * by matching surrounding context using fuzzy matching algorithms.
 * 
 * Uses shared anchor utilities from ../shared/anchor-utils.ts
 */

import {
    DEFAULT_DIFF_ANCHOR_CONFIG,
    DiffAnchor,
    DiffAnchorConfig,
    DiffAnchorRelocationResult,
    DiffSelection,
    DiffSide
} from './types';

import {
    createAnchorData,
    extractTextFromSelection,
    hashText,
    needsRelocationCheck,
    relocateAnchorPosition
} from '../shared/anchor-utils';

// Re-export shared functions for backward compatibility and public API
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
} from '../shared';

/**
 * Extract text from document content given line range
 */
export function extractSelectedText(
    content: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number
): string {
    return extractTextFromSelection(content, startLine, endLine, startColumn, endColumn);
}

/**
 * Create an anchor from content and selection
 */
export function createDiffAnchor(
    content: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    side: DiffSide,
    config: DiffAnchorConfig = DEFAULT_DIFF_ANCHOR_CONFIG
): DiffAnchor {
    const anchorData = createAnchorData(content, startLine, endLine, startColumn, endColumn, config);

    return {
        selectedText: anchorData.selectedText,
        contextBefore: anchorData.contextBefore,
        contextAfter: anchorData.contextAfter,
        originalLine: anchorData.originalLine,
        textHash: anchorData.textHash,
        side: side
    };
}

/**
 * Create a DiffSelection from line/column numbers
 */
function createSelectionFromLines(
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    side: DiffSide
): DiffSelection {
    if (side === 'old') {
        return {
            side,
            oldStartLine: startLine,
            oldEndLine: endLine,
            newStartLine: null,
            newEndLine: null,
            startColumn,
            endColumn
        };
    } else if (side === 'new') {
        return {
            side,
            oldStartLine: null,
            oldEndLine: null,
            newStartLine: startLine,
            newEndLine: endLine,
            startColumn,
            endColumn
        };
    } else {
        // 'both' - same lines on both sides (context lines)
        return {
            side,
            oldStartLine: startLine,
            oldEndLine: endLine,
            newStartLine: startLine,
            newEndLine: endLine,
            startColumn,
            endColumn
        };
    }
}

/**
 * Relocate a diff anchor in updated content
 */
export function relocateDiffAnchor(
    content: string,
    anchor: DiffAnchor,
    side: DiffSide,
    config: DiffAnchorConfig = DEFAULT_DIFF_ANCHOR_CONFIG
): DiffAnchorRelocationResult {
    const result = relocateAnchorPosition(content, anchor, config);

    if (result.found && result.startLine !== undefined) {
        const selection = createSelectionFromLines(
            result.startLine,
            result.endLine!,
            result.startColumn!,
            result.endColumn!,
            side
        );

        return {
            found: true,
            selection,
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
export function needsDiffRelocation(
    content: string,
    anchor: DiffAnchor,
    currentStartLine: number,
    currentEndLine: number,
    currentStartColumn: number,
    currentEndColumn: number
): boolean {
    return needsRelocationCheck(
        content,
        anchor,
        currentStartLine,
        currentEndLine,
        currentStartColumn,
        currentEndColumn
    );
}

/**
 * Update an anchor with new content (after successful relocation)
 */
export function updateDiffAnchor(
    content: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    side: DiffSide,
    existingAnchor?: DiffAnchor,
    config: DiffAnchorConfig = DEFAULT_DIFF_ANCHOR_CONFIG
): DiffAnchor {
    const newAnchor = createDiffAnchor(content, startLine, endLine, startColumn, endColumn, side, config);

    // Preserve original line from existing anchor if available
    if (existingAnchor) {
        return {
            ...newAnchor,
            originalLine: existingAnchor.originalLine
        };
    }

    return newAnchor;
}
