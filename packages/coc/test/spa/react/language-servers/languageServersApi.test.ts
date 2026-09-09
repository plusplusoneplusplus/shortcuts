/**
 * languageServersApi — workspace-scoped routing and request shape.
 *
 * Language-server configuration belongs to the host that owns the files. These
 * tests pin that every call is addressed to the owning workspace's client, so a
 * remote clone never reads or writes the local host's configuration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import {
    languageServersApi,
    parseLanguageServerRejection,
} from '../../../../src/server/spa/client/react/features/language-servers/languageServersApi';

const REMOTE_WS = 'ws-remote-lsp';
const REMOTE_BASE = 'http://127.0.0.1:4002';
const LOCAL_WS = 'ws-local-lsp';

const CONFIG = {
    enabled: false,
    definitions: [],
    effective: [],
    startable: [],
    status: 'missing' as const,
    warnings: [],
};

interface Call { url: string; method: string; body: unknown }

function makeFetchSpy(calls: Call[], responder?: (url: string) => Partial<Response> | undefined) {
    return vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        const custom = responder?.(url);
        if (custom) {
            return Promise.resolve(custom as Response);
        }
        return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => CONFIG,
            text: async () => JSON.stringify(CONFIG),
        } as Response);
    });
}

describe('languageServersApi', () => {
    let calls: Call[];

    beforeEach(() => {
        calls = [];
        resetCloneRegistryForTests();
        vi.stubGlobal('fetch', makeFetchSpy(calls));
    });

    afterEach(() => {
        resetCloneRegistryForTests();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('reads and writes a remote clone config against the owning host', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        await languageServersApi.get(REMOTE_WS);
        await languageServersApi.update(REMOTE_WS, { enabled: true });

        expect(calls).toHaveLength(2);
        for (const call of calls) {
            expect(call.url.startsWith(REMOTE_BASE)).toBe(true);
            expect(call.url).toContain(`/workspaces/${REMOTE_WS}/language-servers`);
        }
        expect(calls[1].method).toBe('PATCH');
        expect(calls[1].body).toEqual({ enabled: true });
    });

    it('keeps a local (unregistered) workspace on the local origin', async () => {
        await languageServersApi.get(LOCAL_WS);

        expect(calls[0].url.startsWith(REMOTE_BASE)).toBe(false);
        expect(calls[0].url).toContain(`/workspaces/${LOCAL_WS}/language-servers`);
    });

    it('does not leak one workspace config request onto another workspace host', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        await languageServersApi.get(REMOTE_WS);
        await languageServersApi.get(LOCAL_WS);

        expect(calls[0].url.startsWith(REMOTE_BASE)).toBe(true);
        expect(calls[1].url.startsWith(REMOTE_BASE)).toBe(false);
    });

    it('sends a replace as PUT with the submitted definitions', async () => {
        const definitions = [{
            id: 'fixture',
            displayName: 'Fixture',
            languageIds: ['plaintext'],
            filePatterns: ['**/*.txt'],
            command: 'fixture-server',
            args: ['--stdio'],
            rootMarkers: ['.git'],
        }];

        await languageServersApi.replace(LOCAL_WS, { enabled: true, definitions });

        expect(calls[0].method).toBe('PUT');
        expect(calls[0].body).toEqual({ enabled: true, definitions });
    });

    it('surfaces a rejected write as field errors plus the last valid config', async () => {
        const rejection = {
            error: 'Invalid language-server configuration',
            errors: [{ field: 'definitions.0.command', message: 'command is required' }],
            config: { enabled: true, definitions: [] },
        };
        vi.stubGlobal('fetch', makeFetchSpy(calls, () => ({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => rejection,
            text: async () => JSON.stringify(rejection),
        })));

        const error = await languageServersApi.replace(LOCAL_WS, { enabled: true }).catch((e: unknown) => e);

        expect(parseLanguageServerRejection(error)).toEqual({
            errors: [{ field: 'definitions.0.command', message: 'command is required' }],
            config: { enabled: true, definitions: [] },
        });
    });
});
