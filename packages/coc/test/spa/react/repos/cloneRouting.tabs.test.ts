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
import { renderHook } from '@testing-library/react';

// ── Mock the client factory layer ────────────────────────────────────────────
// getSpaCocClient → the LOCAL stub; getCocClientFor(baseUrl) → a per-baseUrl stub.
// Each stub records which baseUrl handled a call so tests can assert routing.

interface StubClient {
    baseUrl: string;
    explorer: Record<string, ReturnType<typeof vi.fn>>;
    notes: Record<string, ReturnType<typeof vi.fn>>;
    processes: Record<string, ReturnType<typeof vi.fn>>;
    workspaces: Record<string, ReturnType<typeof vi.fn>>;
    queue: Record<string, ReturnType<typeof vi.fn>>;
    seenState: Record<string, ReturnType<typeof vi.fn>>;
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
            listGroupPins: vi.fn(async () => []),
        },
        // Activity-tab conversation LIST domains (the path that regressed).
        workspaces: {
            history: vi.fn(async () => ({ items: [], hasMore: false, baseUrl })),
        },
        queue: {
            list: vi.fn(async () => ({ tasks: [], baseUrl })),
        },
        seenState: {
            getMap: vi.fn(async () => ({})),
            getUnseenCount: vi.fn(async () => ({ unseenCount: 0 })),
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
import { useCocClient } from '../../../../src/server/spa/client/react/repos/cloneRouting';
import { fetchSeenMap, fetchUnseenCount } from '../../../../src/server/spa/client/react/hooks/preferences/seenStateApi';

const REMOTE_WS = 'remote-ws';
const REMOTE_URL = 'http://127.0.0.1:4000';
const LOCAL_WS = 'local-ws';

function clearAllMocks(stub: StubClient): void {
    for (const domain of [stub.explorer, stub.notes, stub.processes, stub.workspaces, stub.queue, stub.seenState]) {
        for (const fn of Object.values(domain)) fn.mockClear();
    }
}

beforeEach(() => {
    resetCloneRegistryForTests();
    stubsByBaseUrl.clear();
    clearAllMocks(LOCAL);
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

// ── Activity conversation LIST routing (RepoChatTab / ChatListPane path) ───────
// REGRESSION: the conversation LIST + queue fetch used getSpaCocClient() (LOCAL)
// even for a remote clone, leaving the Activity tab empty. RepoChatTab now resolves
// the list client via useCocClient(workspaceId); these assert that resolution.

describe('Activity conversation-list routing (useCocClient)', () => {
    it('loads the conversation history + queue + group-pins from the REMOTE server for a remote clone', async () => {
        const { result } = renderHook(() => useCocClient(REMOTE_WS));
        const client = result.current as unknown as StubClient;

        await client.workspaces.history(REMOTE_WS, { limit: 100, offset: 0 });
        await client.queue.list({ repoId: REMOTE_WS });
        await client.processes.listGroupPins(REMOTE_WS);

        const remote = clientFor(REMOTE_URL);
        expect(remote.workspaces.history).toHaveBeenCalledWith(REMOTE_WS, { limit: 100, offset: 0 });
        expect(remote.queue.list).toHaveBeenCalledWith({ repoId: REMOTE_WS });
        expect(remote.processes.listGroupPins).toHaveBeenCalledWith(REMOTE_WS);
        // No local fallthrough: the list must NOT hit the default origin client.
        expect(LOCAL.workspaces.history).not.toHaveBeenCalled();
        expect(LOCAL.queue.list).not.toHaveBeenCalled();
        expect(LOCAL.processes.listGroupPins).not.toHaveBeenCalled();
    });

    it('loads the conversation history + queue from the default origin client for a LOCAL clone', async () => {
        const { result } = renderHook(() => useCocClient(LOCAL_WS));
        const client = result.current as unknown as StubClient;

        await client.workspaces.history(LOCAL_WS, { limit: 100, offset: 0 });
        await client.queue.list({ repoId: LOCAL_WS });

        expect(LOCAL.workspaces.history).toHaveBeenCalledWith(LOCAL_WS, { limit: 100, offset: 0 });
        expect(LOCAL.queue.list).toHaveBeenCalledWith({ repoId: LOCAL_WS });
        // The remote server stub must not even be created for a local id.
        expect(stubsByBaseUrl.has(REMOTE_URL)).toBe(false);
    });
});

// ── Seen-state routing (useUnseenChat → seenStateApi, non-React) ───────────────

describe('Seen-state routing (seenStateApi)', () => {
    it('reads a remote clone seen-map + unseen-count from the remote server', async () => {
        await fetchSeenMap(REMOTE_WS);
        await fetchUnseenCount(REMOTE_WS);
        expect(clientFor(REMOTE_URL).seenState.getMap).toHaveBeenCalledWith(REMOTE_WS);
        expect(clientFor(REMOTE_URL).seenState.getUnseenCount).toHaveBeenCalledWith(REMOTE_WS);
        expect(LOCAL.seenState.getMap).not.toHaveBeenCalled();
    });

    it('reads a LOCAL clone seen-map from the default origin client', async () => {
        await fetchSeenMap(LOCAL_WS);
        expect(LOCAL.seenState.getMap).toHaveBeenCalledWith(LOCAL_WS);
    });
});
