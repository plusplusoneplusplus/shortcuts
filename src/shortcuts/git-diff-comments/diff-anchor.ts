/**
 * Diff Anchor Module
 * 
 * Provides anchor-based tracking for diff comment locations.
 * When document content changes, anchors allow relocating comments
 * by matching surrounding context using fuzzy matching algorithms.
 * 
 * Uses shared text-matching utilities from ../shared/text-matching.ts
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
    calculateSimilarity as sharedCalculateSimilarity,
    extractContext,
    findAllOccurrences as sharedFindAllOccurrences,
    findFuzzyMatch as sharedFindFuzzyMatch,
    getCharOffset as sharedGetCharOffset,
    hashText as sharedHashText,
    levenshteinDistance as sharedLevenshteinDistance,
    normalizeText as sharedNormalizeText,
    offsetToLineColumn as sharedOffsetToLineColumn,
    scoreMatch as sharedScoreMatch,
    splitIntoLines as sharedSplitIntoLines
} from '../shared/text-matching';

// Re-export shared functions for backward compatibility and public API
export const hashText = sharedHashText;
export const levenshteinDistance = sharedLevenshteinDistance;
export const calculateSimilarity = sharedCalculateSimilarity;
export const normalizeText = sharedNormalizeText;
export const splitIntoLines = sharedSplitIntoLines;
export const getCharOffset = sharedGetCharOffset;
export const offsetToLineColumn = sharedOffsetToLineColumn;

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
    const lines = splitIntoLines(content);

    if (startLine === endLine) {
        // Single line selection
        const line = lines[startLine - 1] || '';
        return line.substring(startColumn - 1, endColumn - 1);
    }

    // Multi-line selection
    const result: string[] = [];

    for (let i = startLine - 1; i <= endLine - 1 && i < lines.length; i++) {
        const line = lines[i];

        if (i === startLine - 1) {
            // First line: from startColumn to end
            result.push(line.substring(startColumn - 1));
        } else if (i === endLine - 1) {
            // Last line: from start to endColumn
            result.push(line.substring(0, endColumn - 1));
        } else {
            // Middle lines: entire line
            result.push(line);
        }
    }

    return result.join('\n');
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
    const lines = splitIntoLines(content);
    const startOffset = getCharOffset(lines, startLine, startColumn);
    const endOffset = getCharOffset(lines, endLine, endColumn);

    const selectedText = extractSelectedText(content, startLine, endLine, startColumn, endColumn);

    // Use shared context extraction
    const { contextBefore, contextAfter } = extractContext(content, startOffset, endOffset, config);

    return {
        selectedText: selectedText,
        contextBefore: contextBefore,
        contextAfter: contextAfter,
        originalLine: startLine,
        textHash: hashText(selectedText),
        side: side
    };
}

// Re-export shared functions for backward compatibility
export const findAllOccurrences = sharedFindAllOccurrences;

/**
 * Score a potential match based on context similarity
 */
export function scoreMatch(
    content: string,
    matchOffset: number,
    matchLength: number,
    anchor: DiffAnchor,
    config: DiffAnchorConfig = DEFAULT_DIFF_ANCHOR_CONFIG
): number {
    return sharedScoreMatch(content, matchOffset, matchLength, anchor, config);
}

/**
 * Find text using fuzzy matching within a search range
 */
export function findFuzzyMatch(
    content: string,
    searchText: string,
    startLine: number,
    config: DiffAnchorConfig = DEFAULT_DIFF_ANCHOR_CONFIG
): { offset: number; similarity: number } | null {
    return sharedFindFuzzyMatch(content, searchText, startLine, config);
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
    // Strategy 1: Try exact text match first
    const exactMatches = findAllOccurrences(content, anchor.selectedText);

    if (exactMatches.length === 1) {
        // Single exact match - high confidence
        const offset = exactMatches[0];
        const { line: startLine, column: startColumn } = offsetToLineColumn(content, offset);
        const { line: endLine, column: endColumn } = offsetToLineColumn(content, offset + anchor.selectedText.length);

        const selection = createSelectionFromLines(startLine, endLine, startColumn, endColumn, side);

        return {
            found: true,
            selection,
            confidence: 1.0,
            reason: 'exact_match'
        };
    }

    if (exactMatches.length > 1) {
        // Multiple exact matches - use context to disambiguate
        let bestMatch: { offset: number; score: number } | null = null;

        for (const matchOffset of exactMatches) {
            const score = scoreMatch(content, matchOffset, anchor.selectedText.length, anchor, config);

            if (!bestMatch || score > bestMatch.score) {
                bestMatch = { offset: matchOffset, score };
            }
        }

        if (bestMatch && bestMatch.score >= config.minSimilarityThreshold) {
            const { line: startLine, column: startColumn } = offsetToLineColumn(content, bestMatch.offset);
            const { line: endLine, column: endColumn } = offsetToLineColumn(content, bestMatch.offset + anchor.selectedText.length);

            const selection = createSelectionFromLines(startLine, endLine, startColumn, endColumn, side);

            return {
                found: true,
                selection,
                confidence: bestMatch.score,
                reason: 'context_match'
            };
        }
    }

    // Strategy 2: Try fuzzy matching near original location
    const fuzzyMatch = findFuzzyMatch(content, anchor.selectedText, anchor.originalLine, config);

    if (fuzzyMatch && fuzzyMatch.similarity >= config.minSimilarityThreshold) {
        const estimatedLength = anchor.selectedText.length;
        const { line: startLine, column: startColumn } = offsetToLineColumn(content, fuzzyMatch.offset);
        const { line: endLine, column: endColumn } = offsetToLineColumn(content, fuzzyMatch.offset + estimatedLength);

        const selection = createSelectionFromLines(startLine, endLine, startColumn, endColumn, side);

        return {
            found: true,
            selection,
            confidence: fuzzyMatch.similarity,
            reason: 'fuzzy_match'
        };
    }

    // Strategy 3: Context-only matching
    if (anchor.contextBefore.length > 10 && anchor.contextAfter.length > 10) {
        const beforeEnd = anchor.contextBefore.slice(-30);
        const afterStart = anchor.contextAfter.slice(0, 30);

        const beforeIndex = content.indexOf(beforeEnd);
        if (beforeIndex !== -1) {
            const afterIndex = content.indexOf(afterStart, beforeIndex + beforeEnd.length);
            if (afterIndex !== -1 && afterIndex - beforeIndex - beforeEnd.length < 500) {
                const matchStart = beforeIndex + beforeEnd.length;
                const matchEnd = afterIndex;

                const { line: startLine, column: startColumn } = offsetToLineColumn(content, matchStart);
                const { line: endLine, column: endColumn } = offsetToLineColumn(content, matchEnd);

                const selection = createSelectionFromLines(startLine, endLine, startColumn, endColumn, side);

                return {
                    found: true,
                    selection,
                    confidence: 0.5,
                    reason: 'context_match'
                };
            }
        }
    }

    // Strategy 4: Fall back to original line if it exists
    const lines = splitIntoLines(content);
    if (anchor.originalLine <= lines.length) {
        const line = lines[anchor.originalLine - 1];
        const selection = createSelectionFromLines(
            anchor.originalLine,
            anchor.originalLine,
            1,
            line.length + 1,
            side
        );

        return {
            found: true,
            selection,
            confidence: 0.2,
            reason: 'line_fallback'
        };
    }

    // Strategy 5: Could not relocate
    return {
        found: false,
        confidence: 0,
        reason: 'not_found'
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
    // Extract current text at the stored selection
    const currentText = extractSelectedText(
        content,
        currentStartLine,
        currentEndLine,
        currentStartColumn,
        currentEndColumn
    );

    // If the text matches, no relocation needed
    if (currentText === anchor.selectedText) {
        return false;
    }

    // If hashes don't match, relocation is needed
    if (hashText(currentText) !== anchor.textHash) {
        return true;
    }

    return false;
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

