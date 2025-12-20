/**
 * Diff Anchor Module
 * 
 * Provides anchor-based tracking for diff comment locations.
 * When document content changes, anchors allow relocating comments
 * by matching surrounding context using fuzzy matching algorithms.
 * 
 * Adapted from markdown-comments/comment-anchor.ts for diff-specific use cases.
 */

import {
    DEFAULT_DIFF_ANCHOR_CONFIG,
    DiffAnchor,
    DiffAnchorConfig,
    DiffAnchorRelocationResult,
    DiffSelection,
    DiffSide
} from './types';

/**
 * Generate a simple hash for text content
 * Uses a djb2-like algorithm for fast hashing
 */
export function hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching
 */
export function levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;

    // Use two rows to optimize space
    let prevRow = new Array(n + 1);
    let currRow = new Array(n + 1);

    // Initialize first row
    for (let j = 0; j <= n; j++) {
        prevRow[j] = j;
    }

    for (let i = 1; i <= m; i++) {
        currRow[0] = i;

        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                currRow[j] = prevRow[j - 1];
            } else {
                currRow[j] = 1 + Math.min(
                    prevRow[j],     // deletion
                    currRow[j - 1], // insertion
                    prevRow[j - 1]  // substitution
                );
            }
        }

        // Swap rows
        [prevRow, currRow] = [currRow, prevRow];
    }

    return prevRow[n];
}

/**
 * Calculate similarity ratio between two strings (0-1)
 * 1 = identical, 0 = completely different
 */
export function calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) {
        return 1;
    }
    if (str1.length === 0 || str2.length === 0) {
        return 0;
    }

    const distance = levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);

    return 1 - (distance / maxLength);
}

/**
 * Normalize text for comparison (trim whitespace, normalize line endings)
 */
export function normalizeText(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

/**
 * Split document content into lines
 */
export function splitIntoLines(content: string): string[] {
    return content.split(/\r?\n/);
}

/**
 * Get character offset in document for a given line and column (1-based)
 */
export function getCharOffset(lines: string[], line: number, column: number): number {
    let offset = 0;

    for (let i = 0; i < line - 1 && i < lines.length; i++) {
        offset += lines[i].length + 1; // +1 for newline
    }

    offset += Math.min(column - 1, lines[line - 1]?.length || 0);

    return offset;
}

/**
 * Convert character offset to line and column (1-based)
 */
export function offsetToLineColumn(content: string, offset: number): { line: number; column: number } {
    const lines = splitIntoLines(content);
    let currentOffset = 0;

    for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i].length + 1; // +1 for newline

        if (currentOffset + lineLength > offset) {
            return {
                line: i + 1,
                column: offset - currentOffset + 1
            };
        }

        currentOffset += lineLength;
    }

    // Return last position if offset exceeds content
    return {
        line: lines.length,
        column: (lines[lines.length - 1]?.length || 0) + 1
    };
}

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

    // Extract context before
    const contextBeforeStart = Math.max(0, startOffset - config.contextCharsBefore);
    const contextBefore = content.substring(contextBeforeStart, startOffset);

    // Extract context after
    const contextAfterEnd = Math.min(content.length, endOffset + config.contextCharsAfter);
    const contextAfter = content.substring(endOffset, contextAfterEnd);

    return {
        selectedText: selectedText,
        contextBefore: contextBefore,
        contextAfter: contextAfter,
        originalLine: startLine,
        textHash: hashText(selectedText),
        side: side
    };
}

/**
 * Find all occurrences of a substring in content
 * Returns array of start offsets
 */
export function findAllOccurrences(content: string, searchText: string): number[] {
    const occurrences: number[] = [];
    if (!searchText) {
        return occurrences;
    }

    let startIndex = 0;
    while (true) {
        const index = content.indexOf(searchText, startIndex);
        if (index === -1) {
            break;
        }
        occurrences.push(index);
        startIndex = index + 1;
    }

    return occurrences;
}

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
    // Extract context around the match
    const contextBeforeStart = Math.max(0, matchOffset - config.contextCharsBefore);
    const actualContextBefore = content.substring(contextBeforeStart, matchOffset);

    const matchEnd = matchOffset + matchLength;
    const contextAfterEnd = Math.min(content.length, matchEnd + config.contextCharsAfter);
    const actualContextAfter = content.substring(matchEnd, contextAfterEnd);

    // Calculate similarity scores
    const beforeSimilarity = calculateSimilarity(
        normalizeText(anchor.contextBefore),
        normalizeText(actualContextBefore)
    );

    const afterSimilarity = calculateSimilarity(
        normalizeText(anchor.contextAfter),
        normalizeText(actualContextAfter)
    );

    // Combined score: weighted average
    return (beforeSimilarity * 0.4) + (afterSimilarity * 0.4) + 0.2;
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
    const lines = splitIntoLines(content);
    const normalizedSearchText = normalizeText(searchText);

    if (!normalizedSearchText) {
        return null;
    }

    // Calculate search range
    const minLine = Math.max(0, startLine - 1 - config.maxLineSearchDistance);
    const maxLine = Math.min(lines.length - 1, startLine - 1 + config.maxLineSearchDistance);

    let bestMatch: { offset: number; similarity: number } | null = null;

    // Search through lines in the range
    for (let lineIdx = minLine; lineIdx <= maxLine; lineIdx++) {
        const windowStart = lineIdx;
        const windowEnd = Math.min(maxLine, lineIdx + Math.ceil(normalizedSearchText.split('\n').length) + 1);

        let windowText = '';
        let windowOffset = 0;

        for (let i = 0; i < windowStart; i++) {
            windowOffset += lines[i].length + 1;
        }

        for (let i = windowStart; i <= windowEnd; i++) {
            if (i > windowStart) {
                windowText += '\n';
            }
            windowText += lines[i];
        }

        const normalizedWindow = normalizeText(windowText);

        // First try exact match
        const exactIndex = normalizedWindow.indexOf(normalizedSearchText);
        if (exactIndex !== -1) {
            const leadingWhitespace = windowText.length - windowText.trimStart().length;
            const actualOffset = windowOffset + exactIndex + leadingWhitespace;
            return { offset: actualOffset, similarity: 1.0 };
        }

        // Try fuzzy matching
        if (normalizedWindow.length >= normalizedSearchText.length * 0.5) {
            for (let i = 0; i <= normalizedWindow.length - Math.floor(normalizedSearchText.length * 0.5); i++) {
                const substringLength = Math.min(normalizedSearchText.length * 1.5, normalizedWindow.length - i);
                const substring = normalizedWindow.substring(i, i + substringLength);

                const similarity = calculateSimilarity(normalizedSearchText, substring);

                if (similarity >= config.minSimilarityThreshold) {
                    if (!bestMatch || similarity > bestMatch.similarity) {
                        bestMatch = {
                            offset: windowOffset + i,
                            similarity: similarity
                        };
                    }
                }
            }
        }
    }

    return bestMatch;
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

