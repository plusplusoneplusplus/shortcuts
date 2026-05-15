/**
 * @vitest-environment jsdom
 *
 * Tests for useScratchpadEnabled hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
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

describe('useScratchpadEnabled', () => {
    beforeEach(async () => {
        vi.resetModules();
        mockFetch.mockReset();
        vi.doMock('../../../../../src/server/spa/client/react/utils/config', () => ({
            getApiBase: () => '/api',
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

    it('returns false when scratchpad is disabled', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ resolved: {} }),
        });
        const { useScratchpadEnabled } = await import('../../../../../src/server/spa/client/react/hooks/feature-flags/useScratchpadEnabled');
        const { result } = renderHook(() => useScratchpadEnabled());
        expect(result.current).toBe(false);
    });

    it('returns true when scratchpad is enabled', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                resolved: { scratchpad: { enabled: true } },
            }),
        });
        const { useScratchpadEnabled } = await import('../../../../../src/server/spa/client/react/hooks/feature-flags/useScratchpadEnabled');
        const { result } = renderHook(() => useScratchpadEnabled());
        await waitFor(() => {
            expect(result.current).toBe(true);
        });
    });
});
