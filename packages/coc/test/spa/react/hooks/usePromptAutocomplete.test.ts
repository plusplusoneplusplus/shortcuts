/* @vitest-environment jsdom */
/**
 * Tests for usePromptAutocomplete — debounced inline ghost-text fetcher.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePromptAutocomplete } from '../../../../src/server/spa/client/react/hooks/usePromptAutocomplete';

const promptCompletion = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        suggestions: {
            promptCompletion: (...args: any[]) => promptCompletion(...args),
        },
    }),
}));

beforeEach(() => {
    promptCompletion.mockReset();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('usePromptAutocomplete', () => {
    it('returns no completion when enabled=false', async () => {
        promptCompletion.mockResolvedValue({ completion: 'XYZ' });
        const { result } = renderHook(() =>
            usePromptAutocomplete({ text: 'fix the ', cursorPos: 8, enabled: false }),
        );
        await act(async () => { vi.runAllTimers(); });
        expect(result.current.completion).toBe('');
        expect(promptCompletion).not.toHaveBeenCalled();
    });

    it('returns no completion when prefix is shorter than minPrefixLen', async () => {
        promptCompletion.mockResolvedValue({ completion: 'XYZ' });
        const { result } = renderHook(() =>
            usePromptAutocomplete({ text: 'hi', cursorPos: 2, enabled: true }),
        );
        await act(async () => { vi.runAllTimers(); });
        expect(result.current.completion).toBe('');
        expect(promptCompletion).not.toHaveBeenCalled();
    });

    it('returns no completion on whitespace-only input', async () => {
        promptCompletion.mockResolvedValue({ completion: 'XYZ' });
        const { result } = renderHook(() =>
            usePromptAutocomplete({ text: '     ', cursorPos: 5, enabled: true }),
        );
        await act(async () => { vi.runAllTimers(); });
        expect(result.current.completion).toBe('');
        expect(promptCompletion).not.toHaveBeenCalled();
    });

    it('returns no completion when cursor is not at end of text', async () => {
        promptCompletion.mockResolvedValue({ completion: 'XYZ' });
        const { result } = renderHook(() =>
            usePromptAutocomplete({ text: 'hello world', cursorPos: 5, enabled: true }),
        );
        await act(async () => { vi.runAllTimers(); });
        expect(result.current.completion).toBe('');
        expect(promptCompletion).not.toHaveBeenCalled();
    });

    it('debounces fetches: rapid typing of 5 chars → 1 fetch', async () => {
        promptCompletion.mockResolvedValue({ completion: 'XYZ' });
        const { rerender } = renderHook(
            ({ text }) => usePromptAutocomplete({ text, cursorPos: text.length, enabled: true }),
            { initialProps: { text: 'fix' } },
        );
        // Rapid keystrokes within the debounce window.
        rerender({ text: 'fix ' });
        rerender({ text: 'fix t' });
        rerender({ text: 'fix th' });
        rerender({ text: 'fix the' });
        rerender({ text: 'fix the ' });
        await act(async () => { vi.runAllTimers(); });
        expect(promptCompletion).toHaveBeenCalledTimes(1);
        expect(promptCompletion).toHaveBeenCalledWith({
            prefix: 'fix the ',
            workspaceId: undefined,
            processId: undefined,
            surface: undefined,
            mode: 'hybrid',
        });
    });

    it('drops stale fetch results when text changes mid-flight', async () => {
        let resolveFirst: (v: any) => void = () => {};
        promptCompletion.mockImplementationOnce(
            () => new Promise((r) => { resolveFirst = r; }),
        );
        promptCompletion.mockResolvedValueOnce({ completion: 'NEW' });

        const { rerender, result } = renderHook(
            ({ text }) => usePromptAutocomplete({ text, cursorPos: text.length, enabled: true }),
            { initialProps: { text: 'fix the ' } },
        );
        await act(async () => { vi.runAllTimers(); });
        // First fetch is in flight; type more.
        rerender({ text: 'fix the bu' });
        await act(async () => { vi.runAllTimers(); });
        // Now resolve the stale first fetch — it must be ignored.
        await act(async () => {
            resolveFirst({ completion: 'STALE' });
            await Promise.resolve();
        });
        expect(result.current.completion).toBe('NEW');
    });

    it('accept() returns text + completion', async () => {
        promptCompletion.mockResolvedValue({ completion: 'bug now' });
        const { result } = renderHook(() =>
            usePromptAutocomplete({ text: 'fix the ', cursorPos: 8, enabled: true }),
        );
        await act(async () => {
            vi.runAllTimers();
            // Drain microtasks so the promise body runs and setCompletion fires.
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(result.current.completion).toBe('bug now');
        expect(result.current.accept()).toBe('fix the bug now');
    });

    it('accept() returns text unchanged when no completion', () => {
        const { result } = renderHook(() =>
            usePromptAutocomplete({ text: 'hi', cursorPos: 2, enabled: true }),
        );
        expect(result.current.accept()).toBe('hi');
    });

    it('dismiss() clears completion and suppresses re-fetch for the same text', async () => {
        promptCompletion.mockResolvedValue({ completion: 'bug' });
        const { result, rerender } = renderHook(
            ({ text }) => usePromptAutocomplete({ text, cursorPos: text.length, enabled: true }),
            { initialProps: { text: 'fix the ' } },
        );
        await act(async () => {
            vi.runAllTimers();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(result.current.completion).toBe('bug');

        act(() => { result.current.dismiss(); });
        expect(result.current.completion).toBe('');

        // Re-render with same text — should NOT re-fetch.
        promptCompletion.mockClear();
        rerender({ text: 'fix the ' });
        await act(async () => {
            vi.runAllTimers();
            await Promise.resolve();
        });
        expect(promptCompletion).not.toHaveBeenCalled();
        expect(result.current.completion).toBe('');

        // Typing more text should resume suggestions.
        rerender({ text: 'fix the more' });
        await act(async () => {
            vi.runAllTimers();
            await Promise.resolve();
        });
        expect(promptCompletion).toHaveBeenCalled();
    });

    it('clears completion silently when fetch throws', async () => {
        promptCompletion.mockRejectedValue(new Error('network'));
        const { result } = renderHook(() =>
            usePromptAutocomplete({ text: 'fix the ', cursorPos: 8, enabled: true }),
        );
        await act(async () => { vi.runAllTimers(); await Promise.resolve(); });
        expect(result.current.completion).toBe('');
    });

    it('passes workspace, process, surface, and mode context', async () => {
        promptCompletion.mockResolvedValue({ completion: 'tests' });
        renderHook(() =>
            usePromptAutocomplete({
                text: 'fix the ',
                cursorPos: 8,
                enabled: true,
                workspaceId: 'ws1',
                processId: 'p1',
                surface: 'follow-up',
                mode: 'ai',
            }),
        );
        await act(async () => { vi.runAllTimers(); await Promise.resolve(); });
        expect(promptCompletion).toHaveBeenCalledWith({
            prefix: 'fix the ',
            workspaceId: 'ws1',
            processId: 'p1',
            surface: 'follow-up',
            mode: 'ai',
        });
    });
});
