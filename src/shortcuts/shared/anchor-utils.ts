/**
 * Anchor Utilities
 * 
 * Provides shared anchor-based tracking for comment locations.
 * When document content changes, anchors allow relocating comments
 * by matching surrounding context using fuzzy matching algorithms.
 * 
 * This module consolidates common anchor functionality used by both
 * markdown-comments and git-diff-comments.
 */

import {
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
} from './text-matching';

// Re-export commonly used functions
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
};

/**
 * Base anchor interface
 */
export interface BaseAnchorData {
    /** The exact selected/commented text */
    selectedText: string;
    /** Text appearing before the selection */
    contextBefore: string;
    /** Text appearing after the selection */
    contextAfter: string;
    /** Original line number when the anchor was created (for fallback) */
    originalLine: number;
    /** Hash/fingerprint of the selected text for quick comparison */
    textHash: string;
}

/**
 * Result of anchor relocation attempt
 */
export interface AnchorRelocationResultBase {
    /** Whether the anchor was successfully relocated */
    found: boolean;
    /** Confidence score of the match (0-1) */
    confidence: number;
    /** Reason for the result */
    reason: 'exact_match' | 'fuzzy_match' | 'context_match' | 'line_fallback' | 'not_found';
}

/**
 * Extract text from document content given line and column positions
 */
export function extractTextFromSelection(
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
 * Create anchor data from content and selection
 */
export function createAnchorData(
    content: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_MATCH_CONFIG
): BaseAnchorData {
    const lines = splitIntoLines(content);
    const startOffset = getCharOffset(lines, startLine, startColumn);
    const endOffset = getCharOffset(lines, endLine, endColumn);

    const selectedText = extractTextFromSelection(content, startLine, endLine, startColumn, endColumn);

    // Use shared context extraction
    const { contextBefore, contextAfter } = extractContext(content, startOffset, endOffset, config);

    return {
        selectedText,
        contextBefore,
        contextAfter,
        originalLine: startLine,
        textHash: hashText(selectedText)
    };
}

/**
 * Relocate anchor position in updated content using 5-strategy pipeline:
 * 1. Exact text match (single occurrence)
 * 2. Context-disambiguated exact match (multiple occurrences)
 * 3. Fuzzy matching near original location
 * 4. Context-only matching
 * 5. Line fallback
 * 
 * Returns line/column positions that can be used to create selection objects.
 */
export function relocateAnchorPosition(
    content: string,
    anchor: BaseAnchorData,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_MATCH_CONFIG
): AnchorRelocationResultBase & { 
    startLine?: number; 
    endLine?: number; 
    startColumn?: number; 
    endColumn?: number;
} {
    // Handle empty content
    if (!content || content.trim().length === 0) {
        return {
            found: false,
            confidence: 0,
            reason: 'not_found'
        };
    }

    // Strategy 1: Try exact text match first
    const exactMatches = findAllOccurrences(content, anchor.selectedText);

    if (exactMatches.length === 1) {
        // Single exact match - high confidence
        const offset = exactMatches[0];
        const { line: startLine, column: startColumn } = offsetToLineColumn(content, offset);
        const { line: endLine, column: endColumn } = offsetToLineColumn(content, offset + anchor.selectedText.length);

        return {
            found: true,
            startLine,
            endLine,
            startColumn,
            endColumn,
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
                startLine,
                endLine,
                startColumn,
                endColumn,
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

        return {
            found: true,
            startLine,
            endLine,
            startColumn,
            endColumn,
            confidence: fuzzyMatch.similarity,
            reason: 'fuzzy_match'
        };
    }

    // Strategy 3: Context-only matching (when text is completely changed but context remains)
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

                return {
                    found: true,
                    startLine,
                    endLine,
                    startColumn,
                    endColumn,
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
            startLine: anchor.originalLine,
            endLine: anchor.originalLine,
            startColumn: 1,
            endColumn: line.length + 1,
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
 * Check if an anchor needs relocation (content at position has changed)
 */
export function needsRelocationCheck(
    content: string,
    anchor: BaseAnchorData,
    currentStartLine: number,
    currentEndLine: number,
    currentStartColumn: number,
    currentEndColumn: number
): boolean {
    // Extract current text at the stored selection
    const currentText = extractTextFromSelection(
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

