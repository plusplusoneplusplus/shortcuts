/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChatHistoryPagingEnabled } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatHistoryPagingEnabled';
import { applyRuntimeConfigPatch as patchRuntimeConfig, DASHBOARD_CONFIG_UPDATED_EVENT } from '../../../../src/server/spa/client/react/utils/config';

afterEach(() => {
    cleanup();
    patchRuntimeConfig({ chatHistoryPagingEnabled: false });
    vi.unstubAllGlobals();
});
describe('owning server paging capability', () => {
    it('defaults off locally and follows live runtime updates', () => {
        const { result } = renderHook(() => useChatHistoryPagingEnabled());
        expect(result.current).toBe(false);
        act(() => patchRuntimeConfig({ chatHistoryPagingEnabled: true }));
        expect(result.current).toBe(true);
        act(() => patchRuntimeConfig({ chatHistoryPagingEnabled: false }));
        expect(result.current).toBe(false);
    });
    it('waits for the owner endpoint, does not copy local flags and re-probes a false capability on config updates', async () => {
        patchRuntimeConfig({ chatHistoryPagingEnabled: true });
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: { chatHistoryPagingEnabled: false } }) });
        vi.stubGlobal('fetch', fetch);
        const { result } = renderHook(() => useChatHistoryPagingEnabled('http://localhost:4999'));
        expect(result.current).toBeNull();
        await waitFor(() => expect(result.current).toBe(false));
        expect(fetch).toHaveBeenCalledWith('http://localhost:4999/api/config/runtime', { signal: expect.any(AbortSignal) });
        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ features: { chatHistoryPagingEnabled: true } }) });
        act(() => window.dispatchEvent(new CustomEvent('coc-remote-ws-message', { detail: { baseUrl: 'http://localhost:4999', message: { type: 'config-changed' } } })));
        await waitFor(() => expect(result.current).toBe(true));
        expect(fetch).toHaveBeenCalledTimes(2);
    });
    it('does not permanently cache failures and ignores another owner notifications', async () => {
        const fetch = vi.fn().mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue({ ok: true, json: async () => ({ features: { chatHistoryPagingEnabled: true } }) });
        vi.stubGlobal('fetch', fetch);
        const { result } = renderHook(() => useChatHistoryPagingEnabled('http://localhost:4999'));
        await waitFor(() => expect(result.current).toBe(false));
        act(() => window.dispatchEvent(new CustomEvent('coc-remote-ws-message', { detail: { baseUrl: 'http://localhost:4998', message: { type: 'config-changed' } } })));
        expect(fetch).toHaveBeenCalledTimes(1);
        act(() => window.dispatchEvent(new Event(DASHBOARD_CONFIG_UPDATED_EVENT)));
        await waitFor(() => expect(result.current).toBe(true));
    });
    it('aborts owner probes and drops late results on owner switch', async () => {
        let resolve!: (value: unknown) => void;
        const fetch = vi.fn().mockReturnValueOnce(new Promise(r => { resolve = r; }))
            .mockResolvedValue({ ok: true, json: async () => ({ features: { chatHistoryPagingEnabled: false } }) });
        vi.stubGlobal('fetch', fetch);
        const { result, rerender } = renderHook(({ owner }) => useChatHistoryPagingEnabled(owner), { initialProps: { owner: 'http://localhost:4999' } });
        const signal = fetch.mock.calls[0][1].signal;
        rerender({ owner: 'http://localhost:4998' });
        expect(signal.aborted).toBe(true);
        expect(result.current).toBeNull();
        await waitFor(() => expect(result.current).toBe(false));
        await act(async () => resolve({ ok: true, json: async () => ({ features: { chatHistoryPagingEnabled: true } }) }));
        expect(result.current).toBe(false);
    });
    it('unresolved remote owners never probe the local server', () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const { result } = renderHook(() => useChatHistoryPagingEnabled(undefined, false));
        expect(result.current).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
    it('rechecks an unavailable capability on the next chat on the same owner', async () => {
        const fetch = vi.fn().mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue({ ok: true, json: async () => ({ features: { chatHistoryPagingEnabled: true } }) });
        vi.stubGlobal('fetch', fetch);
        const { result, rerender } = renderHook(({ chat }) => useChatHistoryPagingEnabled('http://localhost:4999', true, chat), { initialProps: { chat: 'first' } });
        await waitFor(() => expect(result.current).toBe(false));
        rerender({ chat: 'second' });
        expect(result.current).toBeNull();
        await waitFor(() => expect(result.current).toBe(true));
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});
