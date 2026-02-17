/**
 * Anchor Utilities
 *
 * Provides shared anchor-based tracking for comment locations.
 * When document content changes, anchors allow relocating comments
 * by matching surrounding context using fuzzy matching algorithms.
 *
 * Implements a 5-strategy relocation pipeline:
 * 1. Exact text match — single occurrence → confidence 1.0
 * 2. Context-disambiguated exact match — multiple occurrences, scored by context
 * 3. Fuzzy match near original line — Levenshtein similarity within search distance
 * 4. Context-only match — match context strings without selected text → confidence 0.5
 * 5. Line fallback — return to original line → confidence 0.2
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
} from '../utils/text-matching';

// Re-export config types for consumers that use anchor as a browser-safe entry point
export { AnchorMatchConfig, DEFAULT_ANCHOR_MATCH_CONFIG } from '../utils/text-matching';

import type { BaseAnchorData, AnchorRelocationResult } from './anchor-types';
export type { BaseAnchorData, AnchorRelocationResult } from './anchor-types';

/**
 * Extract text from document content given line and column positions (1-based).
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

/**
 * Create anchor data from content and a selection range (1-based).
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
 * Relocate an anchor position in updated content using the 5-strategy pipeline.
 */
export function relocateAnchorPosition(
    content: string,
    anchor: BaseAnchorData,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_MATCH_CONFIG
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

    // Strategy 3: Fuzzy matching near original location
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

    // Strategy 4: Context-only matching
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

    // Strategy 5: Line fallback
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

    return { found: false, confidence: 0, reason: 'not_found' };
}

/**
 * Check if an anchor needs relocation (content at stored position has changed).
 */
export function needsRelocationCheck(
    content: string,
    anchor: BaseAnchorData,
    currentStartLine: number,
    currentEndLine: number,
    currentStartColumn: number,
    currentEndColumn: number
): boolean {
    const currentText = extractTextFromSelection(
        content,
        currentStartLine,
        currentEndLine,
        currentStartColumn,
        currentEndColumn
    );

    if (currentText === anchor.selectedText) {
        return false;
    }

    if (hashText(currentText) !== anchor.textHash) {
        return true;
    }

    return false;
}

/**
 * Relocate multiple anchors in a single pass over the same content.
 * Each anchor is identified by its key in the input map.
 */
export function batchRelocateAnchors(
    content: string,
    anchors: Map<string, BaseAnchorData>,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_MATCH_CONFIG
): Map<string, AnchorRelocationResult> {
    const results = new Map<string, AnchorRelocationResult>();
    for (const [key, anchor] of anchors) {
        results.set(key, relocateAnchorPosition(content, anchor, config));
    }
    return results;
}
