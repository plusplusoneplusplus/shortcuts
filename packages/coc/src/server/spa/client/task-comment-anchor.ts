/**
 * Task Comment Anchor
 *
 * Browser-compatible comment anchoring and relocation logic.
 * Ported from the extension's shared/anchor-utils.ts and
 * markdown-comments/comment-anchor.ts with all pipeline-core
 * text-matching utilities inlined (no Node.js dependencies).
 *
 * The 5-strategy relocation pipeline:
 *   1. Exact text match (single occurrence)  — confidence 1.0
 *   2. Context-disambiguated exact match      — confidence ≥ threshold
 *   3. Fuzzy matching near original location  — confidence ≥ threshold
 *   4. Context-only matching                  — confidence 0.5
 *   5. Line fallback                          — confidence 0.2
 */

import type {
    CommentAnchor,
    CommentSelection,
    AnchorRelocationResult,
} from './task-comments-types';

// ============================================================================
// Configuration
// ============================================================================

/** Configuration for anchor matching operations. */
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

/** Default anchor matching configuration. */
export const DEFAULT_ANCHOR_CONFIG: AnchorMatchConfig = {
    contextCharsBefore: 100,
    contextCharsAfter: 100,
    minSimilarityThreshold: 0.6,
    maxLineSearchDistance: 50,
};

// ============================================================================
// Text Utilities (inlined from pipeline-core/utils/text-matching)
// ============================================================================

/** Split content into lines (handles \r\n and \n). */
export function splitIntoLines(content: string): string[] {
    return content.split(/\r?\n/);
}

/**
 * Convert 1-based line/column to 0-based character offset.
 * Each line is followed by a single '\n' character.
 */
export function getCharOffset(lines: string[], line: number, column: number): number {
    let offset = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) {
        offset += lines[i].length + 1; // +1 for newline
    }
    offset += Math.min(column - 1, lines[line - 1]?.length || 0);
    return offset;
}

/** Convert 0-based character offset to 1-based line/column. */
export function offsetToLineColumn(
    content: string,
    offset: number
): { line: number; column: number } {
    const lines = splitIntoLines(content);
    let currentOffset = 0;

    for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i].length + 1; // +1 for newline
        if (currentOffset + lineLength > offset) {
            return { line: i + 1, column: offset - currentOffset + 1 };
        }
        currentOffset += lineLength;
    }

    // Past end of content — return last position
    return {
        line: lines.length,
        column: (lines[lines.length - 1]?.length || 0) + 1,
    };
}

/**
 * Generate a simple hash for text content (djb2 algorithm).
 * Returns a base-36 string for compactness.
 */
export function hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
}

// ============================================================================
// Matching Utilities (inlined from pipeline-core/utils/text-matching)
// ============================================================================

/** Find all occurrences of a substring; returns array of start offsets. */
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

/** Compute Levenshtein distance between two strings (space-optimised 2-row DP). */
export function levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;

    let prevRow = new Array(n + 1);
    let currRow = new Array(n + 1);

    for (let j = 0; j <= n; j++) {
        prevRow[j] = j;
    }

    for (let i = 1; i <= m; i++) {
        currRow[0] = i;
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                currRow[j] = prevRow[j - 1];
            } else {
                currRow[j] = 1 + Math.min(prevRow[j], currRow[j - 1], prevRow[j - 1]);
            }
        }
        [prevRow, currRow] = [currRow, prevRow];
    }

    return prevRow[n];
}

/** Calculate similarity ratio between two strings (0 = different, 1 = identical). */
export function calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) {
        return 1;
    }
    if (str1.length === 0 || str2.length === 0) {
        return 0;
    }
    const distance = levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    return 1 - distance / maxLength;
}

/** Normalise text for comparison (trim, unify line endings). */
export function normalizeText(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

// ============================================================================
// Context & Scoring
// ============================================================================

/** Extract context surrounding a selection. */
export function extractContext(
    content: string,
    startOffset: number,
    endOffset: number,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_CONFIG
): { contextBefore: string; contextAfter: string } {
    const contextBeforeStart = Math.max(0, startOffset - config.contextCharsBefore);
    const contextBefore = content.substring(contextBeforeStart, startOffset);

    const contextAfterEnd = Math.min(content.length, endOffset + config.contextCharsAfter);
    const contextAfter = content.substring(endOffset, contextAfterEnd);

    return { contextBefore, contextAfter };
}

/** Base anchor shape used by scoring (matches CommentAnchor). */
interface BaseMatchAnchor {
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
    originalLine: number;
    textHash: string;
}

/** Score a candidate match by comparing surrounding context. */
export function scoreMatch(
    content: string,
    matchOffset: number,
    matchLength: number,
    anchor: BaseMatchAnchor,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_CONFIG
): number {
    const contextBeforeStart = Math.max(0, matchOffset - config.contextCharsBefore);
    const actualContextBefore = content.substring(contextBeforeStart, matchOffset);

    const matchEnd = matchOffset + matchLength;
    const contextAfterEnd = Math.min(content.length, matchEnd + config.contextCharsAfter);
    const actualContextAfter = content.substring(matchEnd, contextAfterEnd);

    const beforeSimilarity = calculateSimilarity(
        normalizeText(anchor.contextBefore),
        normalizeText(actualContextBefore)
    );
    const afterSimilarity = calculateSimilarity(
        normalizeText(anchor.contextAfter),
        normalizeText(actualContextAfter)
    );

    // Weighted: 40% context-before + 40% context-after + 20% constant base
    return beforeSimilarity * 0.4 + afterSimilarity * 0.4 + 0.2;
}

/**
 * Find text using fuzzy matching within a search range.
 * Returns the best match offset and similarity score, or null.
 */
export function findFuzzyMatch(
    content: string,
    searchText: string,
    startLine: number,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_CONFIG
): { offset: number; similarity: number } | null {
    const lines = splitIntoLines(content);
    const normalizedSearchText = normalizeText(searchText);

    if (!normalizedSearchText) {
        return null;
    }

    const minLine = Math.max(0, startLine - 1 - config.maxLineSearchDistance);
    const maxLine = Math.min(lines.length - 1, startLine - 1 + config.maxLineSearchDistance);

    let bestMatch: { offset: number; similarity: number } | null = null;

    for (let lineIdx = minLine; lineIdx <= maxLine; lineIdx++) {
        const windowEnd = Math.min(
            maxLine,
            lineIdx + Math.ceil(normalizedSearchText.split('\n').length) + 1
        );

        let windowOffset = 0;
        for (let i = 0; i < lineIdx; i++) {
            windowOffset += lines[i].length + 1;
        }

        let windowText = '';
        for (let i = lineIdx; i <= windowEnd; i++) {
            if (i > lineIdx) {
                windowText += '\n';
            }
            windowText += lines[i];
        }

        const normalizedWindow = normalizeText(windowText);

        // Try exact match first
        const exactIndex = normalizedWindow.indexOf(normalizedSearchText);
        if (exactIndex !== -1) {
            const leadingWhitespace = windowText.length - windowText.trimStart().length;
            return { offset: windowOffset + exactIndex + leadingWhitespace, similarity: 1.0 };
        }

        // Fuzzy matching via sliding window
        if (normalizedWindow.length >= normalizedSearchText.length * 0.5) {
            for (
                let i = 0;
                i <= normalizedWindow.length - Math.floor(normalizedSearchText.length * 0.5);
                i++
            ) {
                const substringLength = Math.min(
                    normalizedSearchText.length * 1.5,
                    normalizedWindow.length - i
                );
                const substring = normalizedWindow.substring(i, i + substringLength);
                const similarity = calculateSimilarity(normalizedSearchText, substring);

                if (
                    similarity >= config.minSimilarityThreshold &&
                    (!bestMatch || similarity > bestMatch.similarity)
                ) {
                    bestMatch = { offset: windowOffset + i, similarity };
                }
            }
        }
    }

    return bestMatch;
}

// ============================================================================
// Anchor Creation
// ============================================================================

/** Extract text from document content given line/column positions. */
export function extractTextFromSelection(
    content: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number
): string {
    const lines = splitIntoLines(content);

    if (startLine === endLine) {
        const line = lines[startLine - 1] || '';
        return line.substring(startColumn - 1, endColumn - 1);
    }

    const result: string[] = [];
    for (let i = startLine - 1; i <= endLine - 1 && i < lines.length; i++) {
        const line = lines[i];
        if (i === startLine - 1) {
            result.push(line.substring(startColumn - 1));
        } else if (i === endLine - 1) {
            result.push(line.substring(0, endColumn - 1));
        } else {
            result.push(line);
        }
    }
    return result.join('\n');
}

/** Create anchor data from content and selection coordinates. */
export function createAnchorData(
    content: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_CONFIG
): CommentAnchor {
    const lines = splitIntoLines(content);
    const startOffset = getCharOffset(lines, startLine, startColumn);
    const endOffset = getCharOffset(lines, endLine, endColumn);

    const selectedText = extractTextFromSelection(content, startLine, endLine, startColumn, endColumn);
    const { contextBefore, contextAfter } = extractContext(content, startOffset, endOffset, config);

    return {
        selectedText,
        contextBefore,
        contextAfter,
        originalLine: startLine,
        textHash: hashText(selectedText),
    };
}

/**
 * Create a {@link CommentAnchor} from document content and a selection.
 */
export function createAnchor(
    content: string,
    selection: CommentSelection,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_CONFIG
): CommentAnchor {
    return createAnchorData(
        content,
        selection.startLine,
        selection.endLine,
        selection.startColumn,
        selection.endColumn,
        config
    );
}

// ============================================================================
// Relocation
// ============================================================================

/**
 * Relocate an anchor in updated content using the 5-strategy pipeline.
 */
export function relocateAnchor(
    content: string,
    anchor: CommentAnchor,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_CONFIG
): AnchorRelocationResult {
    // Handle empty content
    if (!content || content.trim().length === 0) {
        return { found: false, confidence: 0, reason: 'not_found' };
    }

    // Strategy 1: Exact text match (single occurrence)
    const exactMatches = findAllOccurrences(content, anchor.selectedText);

    if (exactMatches.length === 1) {
        const offset = exactMatches[0];
        const { line: startLine, column: startColumn } = offsetToLineColumn(content, offset);
        const { line: endLine, column: endColumn } = offsetToLineColumn(
            content,
            offset + anchor.selectedText.length
        );
        return {
            found: true,
            selection: { startLine, startColumn, endLine, endColumn },
            confidence: 1.0,
            reason: 'exact_match',
        };
    }

    // Strategy 2: Context-disambiguated exact match (multiple occurrences)
    if (exactMatches.length > 1) {
        let bestMatch: { offset: number; score: number } | null = null;
        for (const matchOffset of exactMatches) {
            const score = scoreMatch(content, matchOffset, anchor.selectedText.length, anchor, config);
            if (!bestMatch || score > bestMatch.score) {
                bestMatch = { offset: matchOffset, score };
            }
        }
        if (bestMatch && bestMatch.score >= config.minSimilarityThreshold) {
            const { line: startLine, column: startColumn } = offsetToLineColumn(content, bestMatch.offset);
            const { line: endLine, column: endColumn } = offsetToLineColumn(
                content,
                bestMatch.offset + anchor.selectedText.length
            );
            return {
                found: true,
                selection: { startLine, startColumn, endLine, endColumn },
                confidence: bestMatch.score,
                reason: 'context_match',
            };
        }
    }

    // Strategy 3: Fuzzy matching near original location
    const fuzzyMatch = findFuzzyMatch(content, anchor.selectedText, anchor.originalLine, config);
    if (fuzzyMatch && fuzzyMatch.similarity >= config.minSimilarityThreshold) {
        const { line: startLine, column: startColumn } = offsetToLineColumn(content, fuzzyMatch.offset);
        const { line: endLine, column: endColumn } = offsetToLineColumn(
            content,
            fuzzyMatch.offset + anchor.selectedText.length
        );
        return {
            found: true,
            selection: { startLine, startColumn, endLine, endColumn },
            confidence: fuzzyMatch.similarity,
            reason: 'fuzzy_match',
        };
    }

    // Strategy 4: Context-only matching (text changed but context remains)
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
                    selection: { startLine, startColumn, endLine, endColumn },
                    confidence: 0.5,
                    reason: 'context_match',
                };
            }
        }
    }

    // Strategy 5: Line fallback
    const lines = splitIntoLines(content);
    if (anchor.originalLine <= lines.length) {
        const line = lines[anchor.originalLine - 1];
        return {
            found: true,
            selection: {
                startLine: anchor.originalLine,
                endLine: anchor.originalLine,
                startColumn: 1,
                endColumn: line.length + 1,
            },
            confidence: 0.2,
            reason: 'line_fallback',
        };
    }

    // Could not relocate
    return { found: false, confidence: 0, reason: 'not_found' };
}

/**
 * Check if an anchor needs relocation (content at position has changed).
 */
export function needsRelocation(
    content: string,
    anchor: CommentAnchor,
    currentSelection: CommentSelection
): boolean {
    const currentText = extractTextFromSelection(
        content,
        currentSelection.startLine,
        currentSelection.endLine,
        currentSelection.startColumn,
        currentSelection.endColumn
    );

    if (currentText === anchor.selectedText) {
        return false;
    }

    return hashText(currentText) !== anchor.textHash;
}

/**
 * Update an anchor with new content (after successful relocation).
 * Preserves the original line from an existing anchor if provided.
 */
export function updateAnchor(
    content: string,
    selection: CommentSelection,
    existingAnchor?: CommentAnchor,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_CONFIG
): CommentAnchor {
    const newAnchor = createAnchor(content, selection, config);
    if (existingAnchor) {
        return { ...newAnchor, originalLine: existingAnchor.originalLine };
    }
    return newAnchor;
}

/**
 * Batch relocate multiple anchors in a document.
 * Skips relocation when content at the stored selection is unchanged.
 */
export function batchRelocateAnchors(
    content: string,
    anchors: Array<{ id: string; anchor: CommentAnchor; currentSelection: CommentSelection }>,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_CONFIG
): Map<string, AnchorRelocationResult> {
    const results = new Map<string, AnchorRelocationResult>();

    for (const { id, anchor, currentSelection } of anchors) {
        if (!needsRelocation(content, anchor, currentSelection)) {
            results.set(id, {
                found: true,
                selection: currentSelection,
                confidence: 1.0,
                reason: 'exact_match',
            });
        } else {
            results.set(id, relocateAnchor(content, anchor, config));
        }
    }

    return results;
}
