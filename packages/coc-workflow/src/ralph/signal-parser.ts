import type { RalphParseResult, RalphSignal } from './types';

/**
 * Parse a Ralph AI response to extract the loop signal and progress block.
 *
 * The helper is intentionally stateless and normalizes line endings so callers
 * can use it from server adapters, tests, or package consumers.
 */
export function parseRalphSignal(response: string): RalphParseResult {
    const normalised = response.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const hasComplete = /\bRALPH_COMPLETE\b/.test(normalised);
    const hasNext = /\bRALPH_NEXT\b/.test(normalised);
    const signal: RalphSignal = hasComplete ? 'RALPH_COMPLETE'
        : hasNext ? 'RALPH_NEXT'
        : 'NONE';

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
    if (!newProgress) {
        return existing ?? '';
    }
    if (!existing) {
        return newProgress;
    }
    return `${existing}\n\n${newProgress}`;
}
