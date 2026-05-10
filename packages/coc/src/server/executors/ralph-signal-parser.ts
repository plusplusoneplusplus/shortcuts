/**
 * Ralph Signal Parser
 *
 * Pure, stateless helper for extracting Ralph loop control signals and
 * accumulated progress from an AI response string.
 *
 * The AI is instructed to end every response with:
 *
 *   RALPH_PROGRESS:
 *   <learnings / file paths / what remains>
 *
 *   Then exactly one of:
 *   RALPH_COMPLETE
 *   RALPH_NEXT
 *
 * This module makes no assumptions about line endings or surrounding whitespace.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Types
// ============================================================================

export type RalphSignal = 'RALPH_NEXT' | 'RALPH_COMPLETE' | 'NONE';

export interface RalphParseResult {
    /** Loop control signal detected in the response. */
    signal: RalphSignal;
    /**
     * Content of the RALPH_PROGRESS: block, trimmed.
     * Empty string when no block was found.
     */
    progress: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Parse a Ralph AI response to extract the loop signal and progress block.
 *
 * Algorithm:
 * 1. Scan for `RALPH_PROGRESS:` marker; capture everything after it until a
 *    terminal signal or end of string.
 * 2. Detect `RALPH_NEXT` or `RALPH_COMPLETE` anywhere in the response
 *    (they may appear before or after the progress block).
 */
export function parseRalphSignal(response: string): RalphParseResult {
    const normalised = response.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // ── Signal detection ──────────────────────────────────────────────────
    const hasComplete = /\bRALPH_COMPLETE\b/.test(normalised);
    const hasNext = /\bRALPH_NEXT\b/.test(normalised);

    // RALPH_COMPLETE takes precedence when both are somehow present
    const signal: RalphSignal = hasComplete ? 'RALPH_COMPLETE'
        : hasNext ? 'RALPH_NEXT'
        : 'NONE';

    // ── Progress block extraction ──────────────────────────────────────────
    // Match everything after `RALPH_PROGRESS:` up to the next signal keyword
    // or end of string.
    const progressMatch = /RALPH_PROGRESS:\s*\n?([\s\S]*?)(?=\bRALPH_(?:NEXT|COMPLETE)\b|$)/
        .exec(normalised);

    const progress = progressMatch ? progressMatch[1].trim() : '';

    return { signal, progress };
}

/**
 * Append new progress to existing accumulated progress.
 * Returns the existing text unchanged when newProgress is empty.
 */
export function appendProgress(existing: string | undefined, newProgress: string): string {
    if (!newProgress) return existing ?? '';
    if (!existing) return newProgress;
    return `${existing}\n\n${newProgress}`;
}
