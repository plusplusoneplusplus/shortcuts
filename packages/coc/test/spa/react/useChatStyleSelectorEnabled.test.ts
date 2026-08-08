/**
 * Tests for useChatStyleSelectorEnabled — the target-server-aware Style flag.
 *
 * Two paths: a local workspace reads the live dashboard config and reacts to
 * admin edits without a reload; a remote clone asks the server that owns it, so
 * one server's experiment never leaks into a clone owned by another.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { flagMock } = vi.hoisted(() => ({ flagMock: vi.fn() }));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    DASHBOARD_CONFIG_UPDATED_EVENT: 'dashboard-config-updated',
    isChatStyleSelectorEnabled: () => flagMock(),
}));

import {
    useChatStyleSelectorEnabled,
    __resetChatStyleSelectorFlagCache,
} from '../../../src/server/spa/client/react/hooks/feature-flags/useChatStyleSelectorEnabled';

const originalFetch = globalThis.fetch;

function mockFetch(impl: (url: string) => Promise<unknown> | unknown) {
    const spy = vi.fn((url: string) => Promise.resolve(impl(url)));
    globalThis.fetch = spy as unknown as typeof fetch;
    return spy;
}

function runtimeResponse(features: Record<string, unknown>) {
    return { ok: true, json: async () => ({ features }) };
}

describe('useChatStyleSelectorEnabled — local workspace', () => {
    beforeEach(() => {
        flagMock.mockReset();
        __resetChatStyleSelectorFlagCache();
    });

    it('is off by default', () => {
        flagMock.mockReturnValue(false);
        const { result } = renderHook(() => useChatStyleSelectorEnabled());
        expect(result.current).toBe(false);
    });

    it('is on when the admin setting is enabled', () => {
        flagMock.mockReturnValue(true);
        const { result } = renderHook(() => useChatStyleSelectorEnabled());
        expect(result.current).toBe(true);
    });

    it('turns on live when an admin enables it, with no reload', () => {
        flagMock.mockReturnValue(false);
        const { result } = renderHook(() => useChatStyleSelectorEnabled());
        expect(result.current).toBe(false);

        flagMock.mockReturnValue(true);
        act(() => { window.dispatchEvent(new Event('dashboard-config-updated')); });
        expect(result.current).toBe(true);
    });

    it('turns off live when an admin disables it', () => {
        flagMock.mockReturnValue(true);
        const { result } = renderHook(() => useChatStyleSelectorEnabled());
        expect(result.current).toBe(true);

        flagMock.mockReturnValue(false);
        act(() => { window.dispatchEvent(new Event('dashboard-config-updated')); });
        expect(result.current).toBe(false);
    });

    it('never hits the network without an API base', () => {
        const fetchSpy = mockFetch(() => runtimeResponse({ chatStyleSelectorEnabled: true }));
        flagMock.mockReturnValue(false);
        renderHook(() => useChatStyleSelectorEnabled());
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('useChatStyleSelectorEnabled — remote clone', () => {
    beforeEach(() => {
        flagMock.mockReset();
        flagMock.mockReturnValue(true);
        __resetChatStyleSelectorFlagCache();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('follows the owning server when that server has the feature on', async () => {
        mockFetch(() => runtimeResponse({ chatStyleSelectorEnabled: true }));
        const { result } = renderHook(() => useChatStyleSelectorEnabled('https://remote/api'));
        await waitFor(() => expect(result.current).toBe(true));
    });

    it('stays off when the owning server has the feature off, even though the local server has it on', async () => {
        mockFetch(() => runtimeResponse({ chatStyleSelectorEnabled: false }));
        const { result } = renderHook(() => useChatStyleSelectorEnabled('https://remote/api'));
        await waitFor(() => expect(result.current).toBe(false));
        // Give the effect a chance to resolve incorrectly before asserting again.
        expect(result.current).toBe(false);
    });

    it('treats an older server that does not publish the flag as unsupported', async () => {
        mockFetch(() => runtimeResponse({ gitWorktreeExecutionEnabled: true }));
        const { result } = renderHook(() => useChatStyleSelectorEnabled('https://old/api'));
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('treats an unreachable server as unsupported', async () => {
        globalThis.fetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
        const { result } = renderHook(() => useChatStyleSelectorEnabled('https://down/api'));
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('treats a non-OK response as unsupported', async () => {
        mockFetch(() => ({ ok: false, status: 404, json: async () => ({}) }));
        const { result } = renderHook(() => useChatStyleSelectorEnabled('https://404/api'));
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('is off while the remote answer is still in flight, so the chip never flashes', () => {
        globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
        const { result } = renderHook(() => useChatStyleSelectorEnabled('https://slow/api'));
        expect(result.current).toBe(false);
    });

    it('caches the answer per API base instead of re-fetching on every mount', async () => {
        const fetchSpy = mockFetch(() => runtimeResponse({ chatStyleSelectorEnabled: true }));
        const first = renderHook(() => useChatStyleSelectorEnabled('https://remote/api'));
        await waitFor(() => expect(first.result.current).toBe(true));
        first.unmount();

        const second = renderHook(() => useChatStyleSelectorEnabled('https://remote/api'));
        expect(second.result.current).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('asks each server separately', async () => {
        const fetchSpy = mockFetch((url: string) =>
            runtimeResponse({ chatStyleSelectorEnabled: url.startsWith('https://a/') }));

        const a = renderHook(() => useChatStyleSelectorEnabled('https://a/api'));
        await waitFor(() => expect(a.result.current).toBe(true));

        const b = renderHook(() => useChatStyleSelectorEnabled('https://b/api'));
        await waitFor(() => expect(b.result.current).toBe(false));

        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
});
