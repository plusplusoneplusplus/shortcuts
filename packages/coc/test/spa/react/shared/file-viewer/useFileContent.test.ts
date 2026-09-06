/**
 * Tests for the shared `useFileContent` state machine.
 *
 * PreviewPane's suite already covers this through the DOM; what is only
 * reachable here is the hook's own contract — the abort-on-key-change ordering,
 * the oversize cut, and save's return value — plus the read-only buffer case
 * that no host exercises directly today.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileContent, MAX_FILE_VIEW_SIZE } from '../../../../../src/server/spa/client/react/shared/file-viewer/useFileContent';
import type { FileBlob } from '../../../../../src/server/spa/client/react/shared/file-viewer/types';

const text = (content: string): FileBlob => ({ content, encoding: 'utf-8', mimeType: 'text/plain' });

describe('useFileContent', () => {
    it('loads, exposes the blob, and seeds the edit buffer', async () => {
        const read = vi.fn().mockResolvedValue(text('hello'));
        const { result } = renderHook(() => useFileContent({ key: 'a', read }));

        expect(result.current.loading).toBe(true);
        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.status).toBe('ready');
        expect(result.current.blob).toEqual(text('hello'));
        expect(result.current.editedContent).toBe('hello');
        expect(result.current.isDirty).toBe(false);
    });

    it('reports a read failure and recovers on retry', async () => {
        const read = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce(text('ok'));
        const onError = vi.fn();
        const { result } = renderHook(() => useFileContent({ key: 'a', read, onError }));

        await waitFor(() => expect(result.current.error).toBe('boom'));
        expect(result.current.status).toBe('error');
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));

        act(() => { result.current.retry(); });
        await waitFor(() => expect(result.current.displayBlob).toEqual(text('ok')));
        expect(result.current.error).toBeNull();
    });

    it('falls back to a generic message when the error has none', async () => {
        const read = vi.fn().mockRejectedValue(new Error(''));
        const { result } = renderHook(() => useFileContent({ key: 'a', read }));
        await waitFor(() => expect(result.current.error).toBe('Failed to load file'));
    });

    it('aborts the in-flight read and drops its result when the key changes', async () => {
        const seen: AbortSignal[] = [];
        let resolveFirst: ((b: FileBlob) => void) | undefined;
        const read = vi.fn((signal: AbortSignal) => {
            seen.push(signal);
            return seen.length === 1
                ? new Promise<FileBlob>((resolve) => { resolveFirst = resolve; })
                : Promise.resolve(text('second'));
        });

        const { result, rerender } = renderHook(
            ({ key }) => useFileContent({ key, read }),
            { initialProps: { key: 'a' } },
        );
        rerender({ key: 'b' });
        await waitFor(() => expect(result.current.editedContent).toBe('second'));

        expect(seen[0].aborted).toBe(true);
        await act(async () => { resolveFirst?.(text('first')); });
        expect(result.current.editedContent).toBe('second');
    });

    it('truncates oversized text and leaves the raw blob intact', async () => {
        const big = 'x'.repeat(MAX_FILE_VIEW_SIZE + 10);
        const read = vi.fn().mockResolvedValue(text(big));
        const { result } = renderHook(() => useFileContent({ key: 'a', read }));

        await waitFor(() => expect(result.current.isOversized).toBe(true));
        expect(result.current.displayBlob?.content).toHaveLength(MAX_FILE_VIEW_SIZE);
        expect(result.current.blob?.content).toHaveLength(MAX_FILE_VIEW_SIZE + 10);
    });

    it('does not seed or truncate the edit buffer for binary content', async () => {
        const read = vi.fn().mockResolvedValue({ content: 'AAAA', encoding: 'base64', mimeType: 'image/png' } as FileBlob);
        const { result } = renderHook(() => useFileContent({ key: 'a', read }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.editedContent).toBe('');
        expect(result.current.isOversized).toBe(false);
        expect(result.current.displayBlob).toEqual(result.current.blob);
    });

    it('tracks edits and writes them through, clearing dirty on success', async () => {
        const write = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useFileContent({ key: 'a', read: vi.fn().mockResolvedValue(text('one')), write }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.onChange('two'); });
        expect(result.current.isDirty).toBe(true);
        expect(result.current.displayBlob?.content).toBe('two');

        let saved: boolean | undefined;
        await act(async () => { saved = await result.current.save(); });
        expect(saved).toBe(true);
        expect(write).toHaveBeenCalledWith('two');
        expect(result.current.isDirty).toBe(false);
        expect(result.current.isSaving).toBe(false);
    });

    it('surfaces a failed write as an error and stays dirty', async () => {
        const write = vi.fn().mockRejectedValue(new Error('disk full'));
        const { result } = renderHook(() => useFileContent({ key: 'a', read: vi.fn().mockResolvedValue(text('one')), write }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.onChange('two'); });
        let saved: boolean | undefined;
        await act(async () => { saved = await result.current.save(); });
        expect(saved).toBe(false);
        expect(result.current.error).toBe('disk full');
        expect(result.current.isDirty).toBe(true);
    });

    it('ignores edits and refuses to save when no write is injected', async () => {
        const { result } = renderHook(() => useFileContent({ key: 'a', read: vi.fn().mockResolvedValue(text('one')) }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.onChange('two'); });
        expect(result.current.isDirty).toBe(false);
        expect(result.current.editedContent).toBe('one');

        let saved: boolean | undefined;
        await act(async () => { saved = await result.current.save(); });
        expect(saved).toBe(false);
    });

    it('discards a dirty buffer when the key changes', async () => {
        const read = vi.fn()
            .mockResolvedValueOnce(text('one'))
            .mockResolvedValueOnce(text('other'));
        const write = vi.fn();
        const { result, rerender } = renderHook(
            ({ key }) => useFileContent({ key, read, write }),
            { initialProps: { key: 'a' } },
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => { result.current.onChange('edited'); });
        expect(result.current.isDirty).toBe(true);

        rerender({ key: 'b' });
        await waitFor(() => expect(result.current.editedContent).toBe('other'));
        expect(result.current.isDirty).toBe(false);
    });

    it('does not refetch when only the read identity changes', async () => {
        const read = vi.fn().mockResolvedValue(text('one'));
        const { result, rerender } = renderHook(() => useFileContent({ key: 'a', read: (s) => read(s) }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        rerender();
        rerender();
        expect(read).toHaveBeenCalledTimes(1);
    });
});
