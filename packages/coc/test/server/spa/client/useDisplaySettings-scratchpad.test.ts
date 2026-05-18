/**
 * @vitest-environment jsdom
 *
 * Tests for scratchpadEnabled field in useDisplaySettings / fetchDisplaySettings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock config module before importing useDisplaySettings
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
    isTerminalEnabled: () => false,
    isNotesEnabled: () => false,
    isMyWorkEnabled: () => false,
    isMyLifeEnabled: () => false,
    isScratchpadEnabled: () => false,
    isVimNavigationEnabled: () => false,
    isWorkflowsEnabled: () => false,
    isPullRequestsEnabled: () => false,
    getScratchpadLayout: () => 'horizontal',
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('useDisplaySettings — scratchpadEnabled', () => {
    beforeEach(async () => {
        vi.resetModules();
        mockFetch.mockReset();
        // Re-mock after resetModules
        vi.doMock('../../../../src/server/spa/client/react/utils/config', () => ({
            getApiBase: () => '/api',
    isRalphEnabled: () => false,
            isTerminalEnabled: () => false,
            isNotesEnabled: () => false,
            isMyWorkEnabled: () => false,
            isMyLifeEnabled: () => false,
            isScratchpadEnabled: () => false,
            isVimNavigationEnabled: () => false,
            isWorkflowsEnabled: () => false,
            isPullRequestsEnabled: () => false,
            getScratchpadLayout: () => 'horizontal',
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('defaults scratchpadEnabled to false', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ resolved: {} }),
        });
        const { useDisplaySettings } = await import('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings');
        const { result } = renderHook(() => useDisplaySettings());
        expect(result.current.scratchpadEnabled).toBe(false);
    });

    it('returns scratchpadEnabled=true from resolved config', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                resolved: {
                    scratchpad: { enabled: true },
                },
            }),
        });
        const { useDisplaySettings } = await import('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings');
        const { result } = renderHook(() => useDisplaySettings());
        await waitFor(() => {
            expect(result.current.scratchpadEnabled).toBe(true);
        });
    });

    it('returns scratchpadEnabled=false when scratchpad absent in resolved', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                resolved: {
                    terminal: { enabled: true },
                },
            }),
        });
        const { useDisplaySettings } = await import('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings');
        const { result } = renderHook(() => useDisplaySettings());
        await waitFor(() => {
            expect(result.current.terminalEnabled).toBe(true);
        });
        expect(result.current.scratchpadEnabled).toBe(false);
    });
});
