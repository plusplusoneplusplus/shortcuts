/**
 * @vitest-environment jsdom
 *
 * Tests for hooks/useLinkHandlers.ts
 *
 * Covers:
 * - Default state (all enabled)
 * - Fetching server config on mount via cocClient
 * - setHandlerEnabled() updates state and patches preferences
 * - getLinkHandlersConfig() returns current snapshot for non-React code
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    preferences: {
        getGlobal: vi.fn(),
        patchGlobal: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: mocks.preferences }),
}));

describe('useLinkHandlers', () => {
    beforeEach(async () => {
        vi.resetModules();
        mocks.preferences.getGlobal.mockReset();
        mocks.preferences.patchGlobal.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('starts with all built-in handlers enabled', async () => {
        mocks.preferences.getGlobal.mockResolvedValueOnce({ linkHandlers: {} });
        const { useLinkHandlers } = await import(
            '../../../../../src/server/spa/client/react/hooks/useLinkHandlers'
        );
        const { result } = renderHook(() => useLinkHandlers());
        await waitFor(() => {
            const [config] = result.current;
            expect(config.teams).toBe(true);
            expect(config.vscode).toBe(true);
            expect(config.onenote).toBe(true);
        });
    });

    it('loads server config on mount and preserves enabled defaults for missing handlers', async () => {
        mocks.preferences.getGlobal.mockResolvedValueOnce({ linkHandlers: { teams: false } });
        const { useLinkHandlers } = await import(
            '../../../../../src/server/spa/client/react/hooks/useLinkHandlers'
        );
        const { result } = renderHook(() => useLinkHandlers());
        await waitFor(() => {
            const [config] = result.current;
            expect(config.teams).toBe(false);
            expect(config.vscode).toBe(true);
            expect(config.onenote).toBe(true);
        });
    });

    it('does not crash when server returns no linkHandlers field', async () => {
        mocks.preferences.getGlobal.mockResolvedValueOnce({});
        const { useLinkHandlers } = await import(
            '../../../../../src/server/spa/client/react/hooks/useLinkHandlers'
        );
        const { result } = renderHook(() => useLinkHandlers());
        // Should keep defaults (no throw)
        await waitFor(() => {
            const [config] = result.current;
            expect(config.teams).toBe(true);
            expect(config.vscode).toBe(true);
            expect(config.onenote).toBe(true);
        });
    });

    it('setHandlerEnabled updates config and calls patchGlobal', async () => {
        mocks.preferences.getGlobal.mockResolvedValueOnce({});
        mocks.preferences.patchGlobal.mockResolvedValueOnce({});

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

        // Should have patched preferences
        expect(mocks.preferences.patchGlobal).toHaveBeenCalled();
        const patchArg = mocks.preferences.patchGlobal.mock.calls[0][0];
        expect(patchArg.linkHandlers.teams).toBe(true);
    });

    it('setHandlerEnabled can disable a handler', async () => {
        mocks.preferences.getGlobal.mockResolvedValueOnce({ linkHandlers: { teams: true } });
        mocks.preferences.patchGlobal.mockResolvedValueOnce({});

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
        mocks.preferences.getGlobal.mockReset();
        mocks.preferences.patchGlobal.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the current module-level config snapshot', async () => {
        mocks.preferences.getGlobal.mockResolvedValueOnce({ linkHandlers: { onenote: true } });
        mocks.preferences.patchGlobal.mockResolvedValueOnce({});

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
