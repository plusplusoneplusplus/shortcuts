/**
 * AC-01 — the folder browser, the repo scan, and workspace registration must be
 * able to target a remote CoC server instead of the page origin.
 *
 * Each function takes an optional `baseUrl`: omitting it has to keep hitting the
 * page origin byte-for-byte (that is what every existing caller relies on),
 * while passing an online remote's `effectiveUrl` sends the request straight to
 * that box. The assertions look at the URL actually fetched, so they pin the
 * routing rather than the plumbing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    browseWorkspaceFolders,
    discoverWorkspaces,
    registerWorkspace,
} from '../../../../src/server/spa/client/react/repos/repositoryService';
import { resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';

const REMOTE = 'http://127.0.0.1:4000';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    resetSpaCocClientForTests();
    fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ folders: [], repos: [], workspace: { id: 'ws' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    resetSpaCocClientForTests();
});

function requestedUrl(): string {
    const [input] = fetchMock.mock.calls[0];
    return typeof input === 'string' ? input : String((input as Request).url ?? input);
}

function requestedMethod(): string | undefined {
    const [input, init] = fetchMock.mock.calls[0];
    return (init as RequestInit | undefined)?.method ?? (input as Request | undefined)?.method;
}

describe('browseWorkspaceFolders routing', () => {
    it('browses the page origin when no baseUrl is given', async () => {
        await browseWorkspaceFolders('~');

        expect(requestedUrl()).toBe('/api/fs/browse?path=%7E');
    });

    it('browses the remote server when a baseUrl is given', async () => {
        await browseWorkspaceFolders('~', REMOTE);

        expect(requestedUrl()).toBe(`${REMOTE}/api/fs/browse?path=%7E`);
    });
});

describe('discoverWorkspaces routing', () => {
    it('scans the page origin when no baseUrl is given', async () => {
        await discoverWorkspaces('/home/me/src');

        expect(requestedUrl()).toBe('/api/workspaces/discover?path=%2Fhome%2Fme%2Fsrc');
    });

    it('scans the remote server when a baseUrl is given', async () => {
        await discoverWorkspaces('/home/me/src', REMOTE);

        expect(requestedUrl()).toBe(`${REMOTE}/api/workspaces/discover?path=%2Fhome%2Fme%2Fsrc`);
    });
});

describe('registerWorkspace routing', () => {
    it('registers against the page origin when no baseUrl is given', async () => {
        await registerWorkspace({ name: 'repo', rootPath: '/home/me/src/repo' });

        expect(requestedUrl()).toBe('/api/workspaces');
        expect(requestedMethod()).toBe('POST');
    });

    it('registers against the remote server when a baseUrl is given', async () => {
        await registerWorkspace({ name: 'repo', rootPath: '/home/me/src/repo' }, REMOTE);

        expect(requestedUrl()).toBe(`${REMOTE}/api/workspaces`);
        expect(requestedMethod()).toBe('POST');
    });

    it('sends the same body regardless of the target server', async () => {
        await registerWorkspace({ name: 'repo', rootPath: '/home/me/src/repo' }, REMOTE);

        const [, init] = fetchMock.mock.calls[0];
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({
            name: 'repo',
            rootPath: '/home/me/src/repo',
        });
    });
});
