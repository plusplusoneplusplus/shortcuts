/**
 * Text Matching Utilities
 * 
 * Provides common text matching and manipulation functions used by
 * anchor systems in both markdown-comments and git-diff-comments.
 * 
 * These pure functions handle:
 * - Text hashing (djb2 algorithm)
 * - Levenshtein distance calculation
 * - Similarity scoring
 * - Text normalization
 * - Line/offset conversions
 */

/**
 * Configuration for anchor matching operations
 */
export interface AnchorMatchConfig {
    /** Number of characters to capture before the selection */
    contextCharsBefore: number;
    /** Number of characters to capture after the selection */
    contextCharsAfter: number;
    /** Minimum similarity threshold for fuzzy matching (0-1) */
    minSimilarityThreshold: number;
    /** Maximum line distance to search when relocating */
    maxLineSearchDistance: number;
}

/**
 * Default anchor matching configuration
 */
export const DEFAULT_ANCHOR_MATCH_CONFIG: AnchorMatchConfig = {
    contextCharsBefore: 100,
    contextCharsAfter: 100,
    minSimilarityThreshold: 0.6,
    maxLineSearchDistance: 50
};

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
 * Base anchor interface for context-based text matching
 */
export interface BaseMatchAnchor {
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
 * Score a potential match based on context similarity
 */
export function scoreMatch(
    content: string,
    matchOffset: number,
    matchLength: number,
    anchor: BaseMatchAnchor,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_MATCH_CONFIG
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
    // Context is very important, so we weight it heavily
    return (beforeSimilarity * 0.4) + (afterSimilarity * 0.4) + 0.2;
}

/**
 * Find text using fuzzy matching within a search range
 * Returns the best match offset and similarity score
 */
export function findFuzzyMatch(
    content: string,
    searchText: string,
    startLine: number,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_MATCH_CONFIG
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
        // Build a window of text to search (include neighboring lines for multi-line matches)
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

        // Try to find the search text or similar text in this window
        const normalizedWindow = normalizeText(windowText);

        // First try exact match
        const exactIndex = normalizedWindow.indexOf(normalizedSearchText);
        if (exactIndex !== -1) {
            // Calculate actual offset accounting for potential trimming
            const leadingWhitespace = windowText.length - windowText.trimStart().length;
            const actualOffset = windowOffset + exactIndex + leadingWhitespace;

            return { offset: actualOffset, similarity: 1.0 };
        }

        // Try fuzzy matching by sliding window
        if (normalizedWindow.length >= normalizedSearchText.length * 0.5) {
            // Check subsequences
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
 * Extract context around a selection for anchor creation
 */
export function extractContext(
    content: string,
    startOffset: number,
    endOffset: number,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_MATCH_CONFIG
): { contextBefore: string; contextAfter: string } {
    // Extract context before
    const contextBeforeStart = Math.max(0, startOffset - config.contextCharsBefore);
    const contextBefore = content.substring(contextBeforeStart, startOffset);

    // Extract context after
    const contextAfterEnd = Math.min(content.length, endOffset + config.contextCharsAfter);
    const contextAfter = content.substring(endOffset, contextAfterEnd);

    return { contextBefore, contextAfter };
}

