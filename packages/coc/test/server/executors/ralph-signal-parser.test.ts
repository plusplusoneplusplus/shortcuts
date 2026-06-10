/**
 * Ralph Signal Parser Tests
 *
 * Unit tests for parseRalphSignal() and appendProgress().
 */

import { describe, it, expect } from 'vitest';
import { parseRalphSignal, appendProgress } from '../../../src/server/executors/ralph-signal-parser';

// ============================================================================
// parseRalphSignal — signal detection
// ============================================================================

describe('parseRalphSignal — signal detection', () => {
    it('detects RALPH_NEXT', () => {
        const response = 'I implemented the auth module.\n\nRALPH_PROGRESS:\nAuth done\n\nRALPH_NEXT';
        expect(parseRalphSignal(response).signal).toBe('RALPH_NEXT');
    });

    it('detects RALPH_COMPLETE', () => {
        const response = 'All acceptance criteria are met.\n\nRALPH_PROGRESS:\nDone\n\nRALPH_COMPLETE';
        expect(parseRalphSignal(response).signal).toBe('RALPH_COMPLETE');
    });

    it('returns NONE when neither signal is present', () => {
        const response = 'I worked on the code but forgot the signal.';
        expect(parseRalphSignal(response).signal).toBe('NONE');
    });

    it('RALPH_COMPLETE takes precedence when both are present', () => {
        const response = 'RALPH_NEXT\nRALPH_COMPLETE';
        expect(parseRalphSignal(response).signal).toBe('RALPH_COMPLETE');
    });

    it('detects adjacent duplicate Ralph signals without accepting arbitrary suffixes', () => {
        expect(parseRalphSignal('RALPH_COMPLETERALPH_COMPLETE').signal).toBe('RALPH_COMPLETE');
        expect(parseRalphSignal('RALPH_NEXTRALPH_NEXT').signal).toBe('RALPH_NEXT');
        expect(parseRalphSignal('RALPH_NEXTRALPH_COMPLETE').signal).toBe('RALPH_COMPLETE');
        expect(parseRalphSignal('RALPH_COMPLETERALPH_COMPLETED').signal).toBe('NONE');
        expect(parseRalphSignal('RALPH_COMPLETED').signal).toBe('NONE');
        expect(parseRalphSignal('prefixRALPH_COMPLETE').signal).toBe('NONE');
    });

    it('handles Windows line endings (CRLF)', () => {
        const response = 'Work done.\r\n\r\nRALPH_PROGRESS:\r\nSome progress\r\n\r\nRALPH_NEXT';
        const result = parseRalphSignal(response);
        expect(result.signal).toBe('RALPH_NEXT');
        expect(result.progress).toBe('Some progress');
    });

    it('is not fooled by partial matches like RALPH_NEXTEND', () => {
        const response = 'RALPH_NEXTEND is not the signal';
        expect(parseRalphSignal(response).signal).toBe('NONE');
    });

    it('detects signal embedded mid-response', () => {
        const response = 'Some preamble\nRALPH_NEXT\nSome trailing text';
        expect(parseRalphSignal(response).signal).toBe('RALPH_NEXT');
    });
});

// ============================================================================
// parseRalphSignal — progress extraction
// ============================================================================

describe('parseRalphSignal — progress extraction', () => {
    it('extracts progress block content', () => {
        const response = 'Done.\n\nRALPH_PROGRESS:\nCreated auth.ts, modified routes.ts\n\nRALPH_NEXT';
        const { progress } = parseRalphSignal(response);
        expect(progress).toBe('Created auth.ts, modified routes.ts');
    });

    it('extracts multi-line progress block', () => {
        const response = 'Done.\n\nRALPH_PROGRESS:\nLine 1\nLine 2\nLine 3\n\nRALPH_NEXT';
        const { progress } = parseRalphSignal(response);
        expect(progress).toBe('Line 1\nLine 2\nLine 3');
    });

    it('returns empty progress when RALPH_PROGRESS block is absent', () => {
        const response = 'Did some work.\nRALPH_NEXT';
        expect(parseRalphSignal(response).progress).toBe('');
    });

    it('trims whitespace from progress content', () => {
        const response = 'RALPH_PROGRESS:\n\n  trimmed  \n\nRALPH_NEXT';
        expect(parseRalphSignal(response).progress).toBe('trimmed');
    });

    it('handles progress followed by RALPH_COMPLETE', () => {
        const response = 'RALPH_PROGRESS:\nAll done\nRALPH_COMPLETE';
        const { progress, signal } = parseRalphSignal(response);
        expect(progress).toBe('All done');
        expect(signal).toBe('RALPH_COMPLETE');
    });

    it('stops progress extraction before adjacent duplicate Ralph signals', () => {
        const response = 'RALPH_PROGRESS:\nAll done\nRALPH_COMPLETERALPH_COMPLETE';
        const { progress, signal } = parseRalphSignal(response);
        expect(progress).toBe('All done');
        expect(signal).toBe('RALPH_COMPLETE');
    });

    it('handles response with no signal and no progress', () => {
        const result = parseRalphSignal('Just a plain response');
        expect(result.signal).toBe('NONE');
        expect(result.progress).toBe('');
    });
});

// ============================================================================
// appendProgress
// ============================================================================

describe('appendProgress', () => {
    it('returns new progress when existing is undefined', () => {
        expect(appendProgress(undefined, 'New progress')).toBe('New progress');
    });

    it('returns new progress when existing is empty string', () => {
        expect(appendProgress('', 'New progress')).toBe('New progress');
    });

    it('appends with double newline separator', () => {
        const result = appendProgress('Prior work', 'New progress');
        expect(result).toBe('Prior work\n\nNew progress');
    });

    it('returns existing unchanged when new progress is empty', () => {
        expect(appendProgress('Prior work', '')).toBe('Prior work');
    });

    it('returns empty string when both are empty/undefined', () => {
        expect(appendProgress(undefined, '')).toBe('');
    });

    it('accumulates multiple iterations correctly', () => {
        const iter1 = appendProgress(undefined, 'Auth done');
        const iter2 = appendProgress(iter1, 'Routes done');
        const iter3 = appendProgress(iter2, 'Tests done');
        expect(iter3).toBe('Auth done\n\nRoutes done\n\nTests done');
    });
});
