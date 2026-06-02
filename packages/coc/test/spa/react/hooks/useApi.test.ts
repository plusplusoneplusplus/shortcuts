import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';
import { fetchApi, fetchAgentApi, getAgentApiBase } from '../../../../src/server/spa/client/react/hooks/useApi';
import { setCurrentAgentId } from '../../../../src/server/spa/client/react/utils/config';

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

describe('useApi — getAgentApiBase', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        setCurrentAgentId(null);
        delete (window as any).__DASHBOARD_CONFIG__;
        globalThis.fetch = originalFetch;
    });

    it('returns raw api base (no agent prefix) in normal mode even when agentId is provided', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', containerMode: false };
        expect(getAgentApiBase('agent-1')).toBe('/api');
    });

    it('prefixes with /agent/:id in container mode', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', containerMode: true };
        expect(getAgentApiBase('agent-1')).toBe('/api/agent/agent-1');
    });

    it('does not double-nest when _currentAgentId is already set (regression for the container-mode URL bug)', () => {
        // Bug: getApiBase() returned '/api/agent/agent-1' when _currentAgentId was set,
        // then getAgentApiBase() appended '/agent/agent-1' again → '/api/agent/agent-1/agent/agent-1'.
        // Fix: getAgentApiBase() uses getRawApiBase() ('/api') so the result is always '/api/agent/:id'.
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', containerMode: true };
        setCurrentAgentId('agent-1');

        expect(getAgentApiBase('agent-1')).toBe('/api/agent/agent-1');
    });

    it('different target agent than current agent also avoids double-nesting', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', containerMode: true };
        setCurrentAgentId('agent-A');

        expect(getAgentApiBase('agent-B')).toBe('/api/agent/agent-B');
    });

    it('encodes special characters in agentId', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', containerMode: true };
        expect(getAgentApiBase('agent/with/slashes')).toBe('/api/agent/agent%2Fwith%2Fslashes');
    });

    it('falls back to getApiBase (with agent prefix) when no agentId provided and current agent is set', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', containerMode: true };
        setCurrentAgentId('agent-1');
        // No agentId → falls through to getApiBase() which returns '/api/agent/agent-1'
        expect(getAgentApiBase()).toBe('/api/agent/agent-1');
    });

    it('falls back to plain api base when no agentId provided and no current agent in container mode', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', containerMode: true };
        expect(getAgentApiBase()).toBe('/api');
    });
});

describe('useApi — fetchAgentApi', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(jsonResponse({ result: 'ok' })),
        ) as typeof fetch;
    });

    afterEach(() => {
        setCurrentAgentId(null);
        delete (window as any).__DASHBOARD_CONFIG__;
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('routes to /api/agent/:id/:path in container mode', async () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', containerMode: true };

        await fetchAgentApi('agent-1', '/workspaces');

        expect(globalThis.fetch).toHaveBeenCalledWith('/api/agent/agent-1/workspaces', expect.any(Object));
    });

    it('does not produce double-nested URL when _currentAgentId is set', async () => {
        // This is the critical regression test for the git-tab bug:
        // selecting a repo dispatches SET_CURRENT_AGENT (_currentAgentId = 'agent-1'),
        // then fetchRepos calls fetchAgentApi('agent-1', '/git-info/batch').
        // Before the fix the URL was /api/agent/agent-1/agent/agent-1/git-info/batch.
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', containerMode: true };
        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(jsonResponse({ result: 'ok' })),
        ) as typeof fetch;
        setCurrentAgentId('agent-1');
        // Wait for the config-reload fetch triggered by setCurrentAgentId
        await new Promise(r => setTimeout(r, 10));

        await fetchAgentApi('agent-1', '/git-info/batch', { method: 'POST', body: '{}' });

        // First call is the runtime config reload; the fetchAgentApi call is the last
        const calls = vi.mocked(globalThis.fetch).mock.calls;
        const calledUrl = calls[calls.length - 1][0] as string;
        expect(calledUrl).toBe('/api/agent/agent-1/git-info/batch');
        expect(calledUrl).not.toContain('/agent/agent-1/agent/');
    });

    it('returns undefined for 204 No Content', async () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', containerMode: true };
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 })) as typeof fetch;

        await expect(fetchAgentApi('agent-1', '/noop')).resolves.toBeUndefined();
    });

    it('throws on non-ok response', async () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', containerMode: true };
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response('{}', { status: 404, statusText: 'Not Found' }),
        ) as typeof fetch;

        await expect(fetchAgentApi('agent-1', '/missing')).rejects.toThrow('API error: 404');
    });
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
}
