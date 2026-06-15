/**
 * AC-07 — per-tab remote routing through the workspace→baseUrl lookup registry.
 *
 * Each in-scope tab's NON-React data service (explorer, notes) must send a remote
 * clone's clone-scoped REST to that clone's server (its baseUrl), and a local
 * clone's to the default origin client — with NO local fallthrough for remote
 * clones. We mock the client factory so each clone resolves to a tagged stub and
 * assert the call landed on the right one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock the client factory layer ────────────────────────────────────────────
// getSpaCocClient → the LOCAL stub; getCocClientFor(baseUrl) → a per-baseUrl stub.
// Each stub records which baseUrl handled a call so tests can assert routing.

interface StubClient {
    baseUrl: string;
    explorer: Record<string, ReturnType<typeof vi.fn>>;
    notes: Record<string, ReturnType<typeof vi.fn>>;
    processes: Record<string, ReturnType<typeof vi.fn>>;
}

const stubsByBaseUrl = new Map<string, StubClient>();

function makeStub(baseUrl: string): StubClient {
    return {
        baseUrl,
        explorer: {
            tree: vi.fn(async () => ({ baseUrl })),
            writeBlob: vi.fn(async () => ({ success: true, baseUrl })),
            readTrustedBlob: vi.fn(async () => ({ baseUrl })),
        },
        notes: {
            getTree: vi.fn(async () => ({ baseUrl })),
            saveContent: vi.fn(async () => ({ baseUrl })),
        },
        processes: {
            sendMessage: vi.fn(async () => ({ baseUrl })),
            promoteToRalph: vi.fn(async () => ({ baseUrl })),
        },
    };
}

const LOCAL = makeStub('LOCAL');

function clientFor(baseUrl?: string): StubClient {
    if (!baseUrl) return LOCAL;
    let stub = stubsByBaseUrl.get(baseUrl);
    if (!stub) {
        stub = makeStub(baseUrl);
        stubsByBaseUrl.set(baseUrl, stub);
    }
    return stub;
}

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => LOCAL,
    getCocClientFor: (baseUrl?: string) => clientFor(baseUrl),
    // notesApi imports these error translators; keep them passthrough.
    translateSpaCocClientError: (e: unknown) => { throw e; },
    getSpaCocClientErrorMessage: () => 'err',
}));

// Config: notesApi reads isCommitChatLensEnabled; cloneRegistry reads getApiBase.
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isCommitChatLensEnabled: () => false,
    getApiBase: () => '/api',
}));

// Import after mocks.
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
    getCocClientForWorkspace,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { explorerApi } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi';
import { notesApi } from '../../../../src/server/spa/client/react/features/notes/notesApi';

const REMOTE_WS = 'remote-ws';
const REMOTE_URL = 'http://127.0.0.1:4000';
const LOCAL_WS = 'local-ws';

beforeEach(() => {
    resetCloneRegistryForTests();
    stubsByBaseUrl.clear();
    LOCAL.explorer.tree.mockClear();
    LOCAL.explorer.writeBlob.mockClear();
    LOCAL.notes.getTree.mockClear();
    LOCAL.notes.saveContent.mockClear();
    registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_URL }]);
});

afterEach(() => {
    resetCloneRegistryForTests();
});

// ── Explorer tab ──────────────────────────────────────────────────────────────

describe('Explorer tab routing', () => {
    it('reads a remote clone tree from the remote server (not local)', async () => {
        await explorerApi.tree(REMOTE_WS);
        expect(clientFor(REMOTE_URL).explorer.tree).toHaveBeenCalledWith(REMOTE_WS, undefined);
        expect(LOCAL.explorer.tree).not.toHaveBeenCalled();
    });

    it('writes a remote clone blob to the remote server (write action)', async () => {
        await explorerApi.writeBlob(REMOTE_WS, 'a.txt', 'hi');
        expect(clientFor(REMOTE_URL).explorer.writeBlob).toHaveBeenCalledWith(REMOTE_WS, 'a.txt', 'hi');
        expect(LOCAL.explorer.writeBlob).not.toHaveBeenCalled();
    });

    it('reads a LOCAL clone tree from the default origin client', async () => {
        await explorerApi.tree(LOCAL_WS);
        expect(LOCAL.explorer.tree).toHaveBeenCalledWith(LOCAL_WS, undefined);
        // The remote server stub must NOT have been created/used for a local id.
        expect(stubsByBaseUrl.has(REMOTE_URL)).toBe(false);
    });
});

// ── Notes tab ───────────────────────────────────────────────────────────────

describe('Notes tab routing', () => {
    it('reads a remote clone note tree from the remote server', async () => {
        await notesApi.getTree(REMOTE_WS);
        expect(clientFor(REMOTE_URL).notes.getTree).toHaveBeenCalledWith(REMOTE_WS, undefined);
        expect(LOCAL.notes.getTree).not.toHaveBeenCalled();
    });

    it('saves a remote clone note to the remote server (write action)', async () => {
        await notesApi.saveContent(REMOTE_WS, 'n.md', 'body');
        expect(clientFor(REMOTE_URL).notes.saveContent).toHaveBeenCalledWith(REMOTE_WS, 'n.md', 'body', undefined, undefined);
        expect(LOCAL.notes.saveContent).not.toHaveBeenCalled();
    });

    it('reads a LOCAL clone note tree from the default origin client', async () => {
        await notesApi.getTree(LOCAL_WS);
        expect(LOCAL.notes.getTree).toHaveBeenCalledWith(LOCAL_WS, undefined);
    });
});

// ── WRITE-action seam shared by the Activity tab (useSendMessage) ──────────────

describe('Activity write-action routing (getCocClientForWorkspace)', () => {
    it('routes a remote clone chat send to the remote server', async () => {
        await getCocClientForWorkspace(REMOTE_WS).processes.sendMessage('proc-1', { content: 'hi' } as never);
        expect(clientFor(REMOTE_URL).processes.sendMessage).toHaveBeenCalled();
        expect(LOCAL.processes.sendMessage).not.toHaveBeenCalled();
    });

    it('routes a remote clone Ralph promotion to the remote server', async () => {
        await getCocClientForWorkspace(REMOTE_WS).processes.promoteToRalph('proc-1', {} as never);
        expect(clientFor(REMOTE_URL).processes.promoteToRalph).toHaveBeenCalled();
        expect(LOCAL.processes.promoteToRalph).not.toHaveBeenCalled();
    });

    it('routes a LOCAL clone chat send to the default origin client', async () => {
        await getCocClientForWorkspace(LOCAL_WS).processes.sendMessage('proc-1', { content: 'hi' } as never);
        expect(LOCAL.processes.sendMessage).toHaveBeenCalled();
    });
});
