/**
 * Comment Anchor Module
 * 
 * Provides anchor-based tracking for comment locations.
 * When document content changes, anchors allow relocating comments
 * by matching surrounding context using fuzzy matching algorithms.
 */

import { AnchorRelocationResult, CommentAnchor, CommentSelection } from './types';
import {
    AnchorMatchConfig,
    calculateSimilarity as sharedCalculateSimilarity,
    DEFAULT_ANCHOR_MATCH_CONFIG,
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

// Re-export shared functions for backward compatibility
export const hashText = sharedHashText;
export const levenshteinDistance = sharedLevenshteinDistance;
export const calculateSimilarity = sharedCalculateSimilarity;
export const normalizeText = sharedNormalizeText;
export const splitIntoLines = sharedSplitIntoLines;
export const getCharOffset = sharedGetCharOffset;
export const offsetToLineColumn = sharedOffsetToLineColumn;

/**
 * Extract text from document content given a selection
 */
export function extractSelectedText(content: string, selection: CommentSelection): string {
    const lines = splitIntoLines(content);

    if (selection.startLine === selection.endLine) {
        // Single line selection
        const line = lines[selection.startLine - 1] || '';
        return line.substring(selection.startColumn - 1, selection.endColumn - 1);
    }

    // Multi-line selection
    const result: string[] = [];

    for (let i = selection.startLine - 1; i <= selection.endLine - 1 && i < lines.length; i++) {
        const line = lines[i];

        if (i === selection.startLine - 1) {
            // First line: from startColumn to end
            result.push(line.substring(selection.startColumn - 1));
        } else if (i === selection.endLine - 1) {
            // Last line: from start to endColumn
            result.push(line.substring(0, selection.endColumn - 1));
        } else {
            // Middle lines: entire line
            result.push(line);
        }
    }

    return result.join('\n');
}

/**
 * Create an anchor from document content and selection
 */
export function createAnchor(
    content: string,
    selection: CommentSelection,
    config: AnchorConfig = DEFAULT_ANCHOR_CONFIG
): CommentAnchor {
    const lines = splitIntoLines(content);
    const startOffset = getCharOffset(lines, selection.startLine, selection.startColumn);
    const endOffset = getCharOffset(lines, selection.endLine, selection.endColumn);

    const selectedText = extractSelectedText(content, selection);

    // Use shared context extraction
    const { contextBefore, contextAfter } = extractContext(content, startOffset, endOffset, config);

    return {
        selectedText: selectedText,
        contextBefore: contextBefore,
        contextAfter: contextAfter,
        originalLine: selection.startLine,
        textHash: hashText(selectedText)
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
    anchor: CommentAnchor,
    config: AnchorConfig = DEFAULT_ANCHOR_CONFIG
): number {
    return sharedScoreMatch(content, matchOffset, matchLength, anchor, config);
}

/**
 * Find text using fuzzy matching within a search range
 * Returns the best match offset and similarity score
 */
export function findFuzzyMatch(
    content: string,
    searchText: string,
    startLine: number,
    config: AnchorConfig = DEFAULT_ANCHOR_CONFIG
): { offset: number; similarity: number } | null {
    return sharedFindFuzzyMatch(content, searchText, startLine, config);
}

/**
 * Relocate a comment anchor in updated content
 */
export function relocateAnchor(
    content: string,
    anchor: CommentAnchor,
    config: AnchorConfig = DEFAULT_ANCHOR_CONFIG
): AnchorRelocationResult {
    // Strategy 1: Try exact text match first
    const exactMatches = findAllOccurrences(content, anchor.selectedText);

    if (exactMatches.length === 1) {
        // Single exact match - high confidence
        const offset = exactMatches[0];
        const { line: startLine, column: startColumn } = offsetToLineColumn(content, offset);
        const { line: endLine, column: endColumn } = offsetToLineColumn(content, offset + anchor.selectedText.length);

        return {
            found: true,
            selection: { startLine, startColumn, endLine, endColumn },
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

            return {
                found: true,
                selection: { startLine, startColumn, endLine, endColumn },
                confidence: bestMatch.score,
                reason: 'context_match'
            };
        }
    }

    // Strategy 2: Try fuzzy matching near original location
    const fuzzyMatch = findFuzzyMatch(content, anchor.selectedText, anchor.originalLine, config);

    if (fuzzyMatch && fuzzyMatch.similarity >= config.minSimilarityThreshold) {
        // Estimate the end offset based on original text length
        const estimatedLength = anchor.selectedText.length;
        const { line: startLine, column: startColumn } = offsetToLineColumn(content, fuzzyMatch.offset);
        const { line: endLine, column: endColumn } = offsetToLineColumn(content, fuzzyMatch.offset + estimatedLength);

        return {
            found: true,
            selection: { startLine, startColumn, endLine, endColumn },
            confidence: fuzzyMatch.similarity,
            reason: 'fuzzy_match'
        };
    }

    // Strategy 3: Context-only matching (when text is completely changed but context remains)
    // Try to find the context before + after pattern
    const contextPattern = anchor.contextBefore.slice(-30) + '.*' + anchor.contextAfter.slice(0, 30);
    if (anchor.contextBefore.length > 10 && anchor.contextAfter.length > 10) {
        const beforeEnd = anchor.contextBefore.slice(-30);
        const afterStart = anchor.contextAfter.slice(0, 30);

        const beforeIndex = content.indexOf(beforeEnd);
        if (beforeIndex !== -1) {
            const afterIndex = content.indexOf(afterStart, beforeIndex + beforeEnd.length);
            if (afterIndex !== -1 && afterIndex - beforeIndex - beforeEnd.length < 500) {
                // Found context pattern
                const matchStart = beforeIndex + beforeEnd.length;
                const matchEnd = afterIndex;

                const { line: startLine, column: startColumn } = offsetToLineColumn(content, matchStart);
                const { line: endLine, column: endColumn } = offsetToLineColumn(content, matchEnd);

                return {
                    found: true,
                    selection: { startLine, startColumn, endLine, endColumn },
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
        return {
            found: true,
            selection: {
                startLine: anchor.originalLine,
                startColumn: 1,
                endLine: anchor.originalLine,
                endColumn: line.length + 1
            },
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
 * Check if an anchor needs relocation (content has changed)
 */
export function needsRelocation(
    content: string,
    anchor: CommentAnchor,
    currentSelection: CommentSelection
): boolean {
    // Extract current text at the stored selection
    const currentText = extractSelectedText(content, currentSelection);

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
