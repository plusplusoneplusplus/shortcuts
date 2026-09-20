/* @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { flagMock } = vi.hoisted(() => ({ flagMock: vi.fn() }));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    DASHBOARD_CONFIG_UPDATED_EVENT: 'dashboard-config-updated',
    isChatProviderSwitchingEnabled: () => flagMock(),
}));

import {
    __resetChatProviderSwitchingFlagCache,
    useChatProviderSwitchingEnabled,
} from '../../../src/server/spa/client/react/hooks/feature-flags/useChatProviderSwitchingEnabled';

const originalFetch = globalThis.fetch;

function runtimeResponse(features: Record<string, unknown>) {
    return { ok: true, json: async () => ({ features }) };
}

describe('useChatProviderSwitchingEnabled', () => {
    beforeEach(() => {
        flagMock.mockReset();
        flagMock.mockReturnValue(false);
        __resetChatProviderSwitchingFlagCache();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        delete (window as { __DASHBOARD_CONFIG__?: unknown }).__DASHBOARD_CONFIG__;
    });

    it('tracks live local admin changes', () => {
        const { result } = renderHook(() => useChatProviderSwitchingEnabled());
        expect(result.current).toBe(false);
        flagMock.mockReturnValue(true);
        act(() => window.dispatchEvent(new Event('dashboard-config-updated')));
        expect(result.current).toBe(true);
    });

    it('reads capability from the owning remote server and configured API base', async () => {
        (window as { __DASHBOARD_CONFIG__?: { apiBasePath?: string } }).__DASHBOARD_CONFIG__ = { apiBasePath: '/coc-api' };
        globalThis.fetch = vi.fn(async () => runtimeResponse({ chatProviderSwitchingEnabled: true })) as unknown as typeof fetch;
        const { result } = renderHook(() => useChatProviderSwitchingEnabled('https://remote/'));
        await waitFor(() => expect(result.current).toBe(true));
        expect(globalThis.fetch).toHaveBeenCalledWith('https://remote/coc-api/config/runtime');
    });

    it('treats older and unreachable remote servers as unsupported', async () => {
        globalThis.fetch = vi.fn(async () => runtimeResponse({})) as unknown as typeof fetch;
        const old = renderHook(() => useChatProviderSwitchingEnabled('https://old'));
        await waitFor(() => expect(old.result.current).toBe(false));

        globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
        const down = renderHook(() => useChatProviderSwitchingEnabled('https://down'));
        await waitFor(() => expect(down.result.current).toBe(false));
    });

    it('keeps different owning servers isolated and caches each answer', async () => {
        globalThis.fetch = vi.fn(async (input: string | URL | Request) => runtimeResponse({
            chatProviderSwitchingEnabled: String(input).startsWith('https://a/'),
        })) as unknown as typeof fetch;

        const a = renderHook(() => useChatProviderSwitchingEnabled('https://a'));
        await waitFor(() => expect(a.result.current).toBe(true));
        a.unmount();
        const aAgain = renderHook(() => useChatProviderSwitchingEnabled('https://a'));
        expect(aAgain.result.current).toBe(true);

        const b = renderHook(() => useChatProviderSwitchingEnabled('https://b'));
        await waitFor(() => expect(b.result.current).toBe(false));
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
});
