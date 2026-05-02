import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchApi } from '../../../src/server/spa/client/react/hooks/useApi';
import { resetSpaCocClientForTests } from '../../../src/server/spa/client/react/api/cocClient';

describe('fetchApi', () => {
    beforeEach(() => {
        resetSpaCocClientForTests();
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/custom-api', wsPath: '/ws' };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete (window as any).__DASHBOARD_CONFIG__;
        resetSpaCocClientForTests();
    });

    it('uses the dashboard API base through the shared CoC client', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
            headers: { 'content-type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchApi('/health')).resolves.toEqual({ ok: true });

        expect(fetchMock).toHaveBeenCalledWith('/custom-api/health', {});
    });

    it('passes RequestInit method, body, headers, and signal through without reserializing', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();

        await expect(fetchApi('/preferences', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ theme: 'dark' }),
            signal: controller.signal,
        })).resolves.toBeUndefined();

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.method).toBe('PATCH');
        expect(init.body).toBe(JSON.stringify({ theme: 'dark' }));
        expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });
});
