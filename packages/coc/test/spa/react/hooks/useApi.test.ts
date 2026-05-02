import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';
import { fetchApi } from '../../../../src/server/spa/client/react/hooks/useApi';

describe('useApi — fetchApi', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        resetSpaCocClientForTests();
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true })) as typeof fetch;
    });

    afterEach(() => {
        resetSpaCocClientForTests();
        delete (window as any).__DASHBOARD_CONFIG__;
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('keeps legacy JSON parsing and API base path behavior', async () => {
        await expect(fetchApi('/health')).resolves.toEqual({ ok: true });

        expect(globalThis.fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({}));
    });

    it('forwards RequestInit as a raw request without JSON double-encoding', async () => {
        const controller = new AbortController();

        await fetchApi('/widgets', {
            method: 'PATCH',
            headers: { 'Content-Type': 'text/plain', 'X-Test': 'yes' },
            body: 'raw-body',
            signal: controller.signal,
        });

        const init = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
        expect(globalThis.fetch).toHaveBeenCalledWith('/api/widgets', expect.any(Object));
        expect(init.method).toBe('PATCH');
        expect(init.body).toBe('raw-body');
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.headers).toEqual({
            'Content-Type': 'text/plain',
            'x-test': 'yes',
        });
    });

    it('preserves legacy error messages for API failures', () => {
        globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(
            { error: 'Missing' },
            { status: 404, statusText: 'Not Found' },
        )) as typeof fetch;

        return expect(fetchApi('/missing')).rejects.toThrow('API error: 404 Not Found');
    });

    it('preserves legacy network rejection behavior', () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch;

        return expect(fetchApi('/health')).rejects.toThrow('offline');
    });
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
}
