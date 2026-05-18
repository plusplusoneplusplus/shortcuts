import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getWorkspacePreferences, patchWorkspacePreferences } from
    '../../../../src/server/spa/client/react/hooks/preferences/preferencesApi';

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
}));

describe('getWorkspacePreferences', () => {
    const mockFetch = vi.fn();
    beforeEach(() => { globalThis.fetch = mockFetch; });
    afterEach(() => { vi.resetAllMocks(); });

    it('returns parsed preferences on 200', async () => {
        const prefs = { filesViewMode: 'tree' };
        mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => prefs });
        const result = await getWorkspacePreferences('ws-abc');
        expect(result).toEqual(prefs);
        expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/ws-abc/preferences', {});
    });

    it('throws on non-ok response', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
        await expect(getWorkspacePreferences('ws-abc')).rejects.toThrow('404');
    });

    it('encodes workspaceId in URL', async () => {
        const prefs = {};
        mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => prefs });
        await getWorkspacePreferences('ws/with spaces');
        expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/ws%2Fwith%20spaces/preferences', {});
    });
});

describe('patchWorkspacePreferences', () => {
    const mockFetch = vi.fn();
    beforeEach(() => { globalThis.fetch = mockFetch; });
    afterEach(() => { vi.resetAllMocks(); });

    it('sends PATCH with JSON body and correct headers', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
        await patchWorkspacePreferences('ws-abc', { filesViewMode: 'flat' });
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/workspaces/ws-abc/preferences',
            expect.objectContaining({
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filesViewMode: 'flat' }),
            })
        );
    });

    it('resolves void on success', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
        await expect(patchWorkspacePreferences('ws-abc', {})).resolves.toBeUndefined();
    });

    it('throws on non-ok response', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });
        await expect(patchWorkspacePreferences('ws-abc', {})).rejects.toThrow('500');
    });
});
