import type { RalphParseResult, RalphSignal } from './types';

const RALPH_SIGNAL_TOKENS = ['RALPH_COMPLETE', 'RALPH_NEXT'] as const;
type DetectableRalphSignal = typeof RALPH_SIGNAL_TOKENS[number];

/**
 * Parse a Ralph AI response to extract the loop signal and progress block.
 *
 * The helper is intentionally stateless and normalizes line endings so callers
 * can use it from server adapters, tests, or package consumers.
 */
export function parseRalphSignal(response: string): RalphParseResult {
    const normalised = response.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const signals = detectRalphSignals(normalised);

    const signal: RalphSignal = signals.has('RALPH_COMPLETE') ? 'RALPH_COMPLETE'
        : signals.has('RALPH_NEXT') ? 'RALPH_NEXT'
        : 'NONE';

    const progress = extractRalphProgress(normalised);

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

function extractRalphProgress(response: string): string {
    const markerMatch = /RALPH_PROGRESS:\s*\n?/.exec(response);
    if (!markerMatch) {
        return '';
    }

    const progressStart = markerMatch.index + markerMatch[0].length;
    const signalStart = findNextRalphSignalRunIndex(response, progressStart);
    const progressEnd = signalStart === -1 ? response.length : signalStart;
    return response.slice(progressStart, progressEnd).trim();
}

function detectRalphSignals(response: string): Set<DetectableRalphSignal> {
    const signals = new Set<DetectableRalphSignal>();
    for (let index = 0; index < response.length; index += 1) {
        if (!hasSignalPrefixBoundary(response, index)) {
            continue;
        }
        const run = parseRalphSignalRun(response, index);
        if (!run) {
            continue;
        }
        for (const signal of run.signals) {
            signals.add(signal);
        }
        index = Math.max(index, run.end - 1);
    }
    return signals;
}

function findNextRalphSignalRunIndex(response: string, fromIndex: number): number {
    for (let index = fromIndex; index < response.length; index += 1) {
        if (!hasSignalPrefixBoundary(response, index)) {
            continue;
        }
        if (parseRalphSignalRun(response, index)) {
            return index;
        }
    }
    return -1;
}

function parseRalphSignalRun(response: string, startIndex: number): { signals: DetectableRalphSignal[]; end: number } | undefined {
    const signals: DetectableRalphSignal[] = [];
    let cursor = startIndex;

    while (cursor < response.length) {
        const signal = RALPH_SIGNAL_TOKENS.find(token => response.startsWith(token, cursor));
        if (!signal) {
            return undefined;
        }
        signals.push(signal);
        cursor += signal.length;

        if (cursor >= response.length || !isSignalIdentifierChar(response[cursor])) {
            return { signals, end: cursor };
        }
    }

    return signals.length ? { signals, end: cursor } : undefined;
}

function hasSignalPrefixBoundary(response: string, index: number): boolean {
    return index === 0 || !isSignalIdentifierChar(response[index - 1]);
}

function isSignalIdentifierChar(char: string | undefined): boolean {
    return char !== undefined && /[A-Za-z0-9_]/.test(char);
}
