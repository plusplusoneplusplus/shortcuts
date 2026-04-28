/**
 * @vitest-environment jsdom
 *
 * Tests for hooks/useLinkHandlers.ts
 *
 * Covers:
 * - Default state (all disabled)
 * - Fetching server config on mount
 * - setHandlerEnabled() updates state and PATCHes preferences
 * - getLinkHandlersConfig() returns current snapshot for non-React code
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('useLinkHandlers', () => {
    beforeEach(async () => {
        vi.resetModules();
        mockFetch.mockReset();
        vi.doMock('../../../../../src/server/spa/client/react/utils/config', () => ({
            getApiBase: () => '/api',
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('starts with an empty config (all handlers disabled)', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ linkHandlers: {} }),
        });
        const { useLinkHandlers } = await import(
            '../../../../../src/server/spa/client/react/hooks/useLinkHandlers'
        );
        const { result } = renderHook(() => useLinkHandlers());
        const [config] = result.current;
        // Before or after fetch, no handler should be true
        expect(config.teams).not.toBe(true);
        expect(config.vscode).not.toBe(true);
        expect(config.onenote).not.toBe(true);
    });

    it('loads server config on mount', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ linkHandlers: { teams: true } }),
        });
        const { useLinkHandlers } = await import(
            '../../../../../src/server/spa/client/react/hooks/useLinkHandlers'
        );
        const { result } = renderHook(() => useLinkHandlers());
        await waitFor(() => {
            const [config] = result.current;
            expect(config.teams).toBe(true);
        });
    });

    it('does not crash when server returns no linkHandlers field', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({}),
        });
        const { useLinkHandlers } = await import(
            '../../../../../src/server/spa/client/react/hooks/useLinkHandlers'
        );
        const { result } = renderHook(() => useLinkHandlers());
        // Should stay empty (no throw)
        await waitFor(() => {
            const [config] = result.current;
            expect(typeof config).toBe('object');
        });
    });

    it('setHandlerEnabled updates config and calls PATCH', async () => {
        mockFetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // GET preferences
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // PATCH preferences

        const { useLinkHandlers } = await import(
            '../../../../../src/server/spa/client/react/hooks/useLinkHandlers'
        );
        const { result } = renderHook(() => useLinkHandlers());

        await act(async () => {
            const [, setHandlerEnabled] = result.current;
            setHandlerEnabled('teams', true);
        });

        const [config] = result.current;
        expect(config.teams).toBe(true);

        // Should have PATCHed preferences
        const patchCall = mockFetch.mock.calls.find(
            c => c[1]?.method === 'PATCH'
        );
        expect(patchCall).toBeDefined();
        const patchBody = JSON.parse(patchCall![1].body);
        expect(patchBody.linkHandlers.teams).toBe(true);
    });

    it('setHandlerEnabled can disable a handler', async () => {
        mockFetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ linkHandlers: { teams: true } }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

        const { useLinkHandlers } = await import(
            '../../../../../src/server/spa/client/react/hooks/useLinkHandlers'
        );
        const { result } = renderHook(() => useLinkHandlers());

        await waitFor(() => {
            expect(result.current[0].teams).toBe(true);
        });

        await act(async () => {
            result.current[1]('teams', false);
        });

        expect(result.current[0].teams).toBe(false);
    });
});

describe('getLinkHandlersConfig', () => {
    beforeEach(async () => {
        vi.resetModules();
        mockFetch.mockReset();
        vi.doMock('../../../../../src/server/spa/client/react/utils/config', () => ({
            getApiBase: () => '/api',
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the current module-level config snapshot', async () => {
        mockFetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ linkHandlers: { onenote: true } }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

        const { useLinkHandlers, getLinkHandlersConfig } = await import(
            '../../../../../src/server/spa/client/react/hooks/useLinkHandlers'
        );
        const { result } = renderHook(() => useLinkHandlers());

        await waitFor(() => {
            expect(result.current[0].onenote).toBe(true);
        });

        // getLinkHandlersConfig() should reflect the same state
        expect(getLinkHandlersConfig().onenote).toBe(true);
    });
});
