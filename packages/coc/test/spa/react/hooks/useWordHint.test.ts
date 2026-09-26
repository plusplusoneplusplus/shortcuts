/* @vitest-environment jsdom */
/**
 * Tests for useWordHint — lazy-loaded client-side English word hint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
    __resetWordHintForTesting,
    mergeGhostSources,
    useWordHint,
} from '../../../../src/server/spa/client/react/hooks/useWordHint';

beforeEach(() => {
    __resetWordHintForTesting();
});

describe('useWordHint', () => {
    it('lazy-loads the dictionary and then hints', async () => {
        const { result } = renderHook(() => useWordHint({ text: 'see you tomo', cursorPos: 12, enabled: true }));
        expect(result.current.completion).toBe('');
        await waitFor(() => expect(result.current.completion).toBe('rrow'));
        expect(result.current.accept()).toBe('see you tomorrow');
    });

    it('returns empty when disabled', async () => {
        const { result, rerender } = renderHook(
            ({ enabled }) => useWordHint({ text: 'tomo', cursorPos: 4, enabled }),
            { initialProps: { enabled: true } },
        );
        await waitFor(() => expect(result.current.completion).toBe('rrow'));
        rerender({ enabled: false });
        expect(result.current.completion).toBe('');
    });

    it('dismiss() holds until the text changes', async () => {
        const { result, rerender } = renderHook(
            ({ text }) => useWordHint({ text, cursorPos: text.length, enabled: true }),
            { initialProps: { text: 'tomo' } },
        );
        await waitFor(() => expect(result.current.completion).toBe('rrow'));
        act(() => result.current.dismiss());
        expect(result.current.completion).toBe('');
        rerender({ text: 'tomo' });
        expect(result.current.completion).toBe('');
        rerender({ text: 'yest' });
        expect(result.current.completion).toBe('erday');
        rerender({ text: 'tomo' });
        expect(result.current.completion).toBe('rrow');
    });
});

const source = (text: string, completion: string) => ({
    completion,
    accept: vi.fn(() => text + completion),
    dismiss: vi.fn(),
});

describe('mergeGhostSources', () => {
    it('lets the first non-empty source win and dismisses all', () => {
        const server = source('tomo', '');
        const word = source('tomo', 'rrow');
        const ghost = mergeGhostSources('tomo', server, word);
        expect(ghost.completion).toBe('rrow');
        expect(ghost.accept()).toBe('tomorrow');
        expect(word.accept).toHaveBeenCalled();
        expect(server.accept).not.toHaveBeenCalled();
        ghost.dismiss();
        expect(server.dismiss).toHaveBeenCalled();
        expect(word.dismiss).toHaveBeenCalled();
    });

    it('prefers the server completion when both exist', () => {
        const server = source('tomo', 'rrow is fine');
        const ghost = mergeGhostSources('tomo', server, source('tomo', 'rrow'));
        expect(ghost.completion).toBe('rrow is fine');
        expect(ghost.accept()).toBe('tomorrow is fine');
        expect(server.accept).toHaveBeenCalled();
    });

    it('accept() returns the text unchanged when there is no completion', () => {
        expect(mergeGhostSources('tomo', source('tomo', '')).accept()).toBe('tomo');
    });
});
