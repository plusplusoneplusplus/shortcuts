/**
 * Chat pin/archive routing uses the selected clone's CoC client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface StubClient {
    baseUrl: string;
    processes: {
        pin: ReturnType<typeof vi.fn>;
        archive: ReturnType<typeof vi.fn>;
        archiveBatch: ReturnType<typeof vi.fn>;
        unarchiveBatch: ReturnType<typeof vi.fn>;
    };
}

const stubsByBaseUrl = new Map<string, StubClient>();

function makeStub(baseUrl: string): StubClient {
    return {
        baseUrl,
        processes: {
            pin: vi.fn(async () => ({})),
            archive: vi.fn(async () => ({})),
            archiveBatch: vi.fn(async () => undefined),
            unarchiveBatch: vi.fn(async () => undefined),
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

function clearStub(stub: StubClient): void {
    for (const fn of Object.values(stub.processes)) fn.mockClear();
}

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => LOCAL,
    getCocClientFor: (baseUrl?: string) => clientFor(baseUrl),
    toSpaCocRequestOptions: (options?: unknown) => options ?? {},
    translateSpaCocClientError: (error: unknown) => { throw error; },
}));

import {
    archiveProcess,
    archiveProcesses,
    pinProcess,
    unarchiveProcess,
    unarchiveProcesses,
    unpinProcess,
} from '../../../../src/server/spa/client/react/queue/hooks/pinArchiveApi';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_WS = 'remote-ws';
const REMOTE_URL = 'http://127.0.0.1:4000';
const LOCAL_WS = 'local-ws';

beforeEach(() => {
    resetCloneRegistryForTests();
    stubsByBaseUrl.clear();
    clearStub(LOCAL);
    registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_URL }]);
});

afterEach(() => {
    resetCloneRegistryForTests();
});

describe('pinArchiveApi clone routing', () => {
    it('routes remote chat pin and unpin to the remote server', async () => {
        await pinProcess('proc-1', REMOTE_WS);
        await unpinProcess('proc-1', REMOTE_WS);

        const remote = clientFor(REMOTE_URL);
        expect(remote.processes.pin).toHaveBeenNthCalledWith(1, 'proc-1', true);
        expect(remote.processes.pin).toHaveBeenNthCalledWith(2, 'proc-1', false);
        expect(LOCAL.processes.pin).not.toHaveBeenCalled();
    });

    it('routes remote chat archive and unarchive to the remote server', async () => {
        await archiveProcess('proc-2', REMOTE_WS);
        await unarchiveProcess('proc-2', REMOTE_WS);

        const remote = clientFor(REMOTE_URL);
        expect(remote.processes.archive).toHaveBeenNthCalledWith(1, 'proc-2', true);
        expect(remote.processes.archive).toHaveBeenNthCalledWith(2, 'proc-2', false);
        expect(LOCAL.processes.archive).not.toHaveBeenCalled();
    });

    it('routes remote batch archive and unarchive to the remote server', async () => {
        await archiveProcesses(['proc-3', 'proc-4'], REMOTE_WS);
        await unarchiveProcesses(['proc-3', 'proc-4'], REMOTE_WS);

        const remote = clientFor(REMOTE_URL);
        expect(remote.processes.archiveBatch).toHaveBeenCalledWith(['proc-3', 'proc-4']);
        expect(remote.processes.unarchiveBatch).toHaveBeenCalledWith(['proc-3', 'proc-4']);
        expect(LOCAL.processes.archiveBatch).not.toHaveBeenCalled();
        expect(LOCAL.processes.unarchiveBatch).not.toHaveBeenCalled();
    });

    it('keeps local chat pin/archive actions on the default SPA client', async () => {
        await pinProcess('local-proc', LOCAL_WS);
        await archiveProcess('local-proc', LOCAL_WS);
        await archiveProcesses(['local-proc'], LOCAL_WS);
        await unarchiveProcesses(['local-proc'], LOCAL_WS);

        expect(LOCAL.processes.pin).toHaveBeenCalledWith('local-proc', true);
        expect(LOCAL.processes.archive).toHaveBeenCalledWith('local-proc', true);
        expect(LOCAL.processes.archiveBatch).toHaveBeenCalledWith(['local-proc']);
        expect(LOCAL.processes.unarchiveBatch).toHaveBeenCalledWith(['local-proc']);
        expect(stubsByBaseUrl.size).toBe(0);
    });
});
