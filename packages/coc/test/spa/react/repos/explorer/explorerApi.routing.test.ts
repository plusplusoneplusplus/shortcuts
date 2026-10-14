import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getClient: vi.fn(),
    tree: vi.fn(),
    listFiles: vi.fn(),
    searchFiles: vi.fn(),
    searchContent: vi.fn(),
    replaceContent: vi.fn(),
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    reveal: vi.fn(),
    deleteEntry: vi.fn(),
    resolve: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: mocks.getClient,
    resolveCloneRoute: mocks.resolve,
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: vi.fn(),
}));

import { explorerApi } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi';

const WORKSPACE_ID = 'ws-shared';
const ROUTING_REF = 'remote:server-b:ws-shared';

describe('explorerApi clone routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolve.mockReturnValue({ kind: 'remote', baseUrl: 'https://owner.invalid' });
        mocks.getClient.mockReturnValue({
            explorer: {
                tree: mocks.tree,
                listFiles: mocks.listFiles,
                searchFiles: mocks.searchFiles,
                searchContent: mocks.searchContent,
                replaceContent: mocks.replaceContent,
                readBlob: mocks.readBlob,
                writeBlob: mocks.writeBlob,
                reveal: mocks.reveal,
                deleteEntry: mocks.deleteEntry,
            },
        });
    });

    it('routes every repo-scoped operation through the concrete clone owner', async () => {
        await explorerApi.tree(WORKSPACE_ID, { path: '/' }, ROUTING_REF);
        await explorerApi.listFiles(WORKSPACE_ID, {}, ROUTING_REF);
        await explorerApi.searchFiles(WORKSPACE_ID, 'app', {}, ROUTING_REF);
        await explorerApi.searchContent(WORKSPACE_ID, 'symbol', {}, ROUTING_REF);
        await explorerApi.replaceContent(WORKSPACE_ID, 'before', 'after', [], {}, ROUTING_REF);
        await explorerApi.readBlob(WORKSPACE_ID, 'src/app.ts', {}, ROUTING_REF);
        await explorerApi.writeBlob(WORKSPACE_ID, 'src/app.ts', 'content', ROUTING_REF);
        await explorerApi.reveal(WORKSPACE_ID, 'src/app.ts', ROUTING_REF);
        await explorerApi.deleteEntry(WORKSPACE_ID, 'src/app.ts', ROUTING_REF);

        expect(mocks.getClient).toHaveBeenCalledTimes(9);
        expect(mocks.getClient.mock.calls.every(([ref]) => ref === ROUTING_REF)).toBe(true);
    });

    it('never dispatches deletion locally when a concrete remote owner is unresolved', async () => {
        mocks.resolve.mockReturnValue({ kind: 'unresolved-remote' });
        await expect(explorerApi.deleteEntry(WORKSPACE_ID, 'src/app.ts', ROUTING_REF)).rejects.toThrow(/owning server/);
        expect(mocks.getClient).not.toHaveBeenCalled();
        expect(mocks.deleteEntry).not.toHaveBeenCalled();
    });

    it('pins explicit local deletion to the page-origin owner rather than a same-id remote', async () => {
        mocks.resolve.mockReturnValue({ kind: 'local' });
        await explorerApi.deleteEntry(WORKSPACE_ID, 'src/app.ts', null);
        expect(mocks.getClient).toHaveBeenCalledWith(null);
        expect(mocks.deleteEntry).toHaveBeenCalledWith(WORKSPACE_ID, 'src/app.ts');
    });

    it('keeps local calls on their workspace route when no concrete owner is supplied', async () => {
        await explorerApi.tree(WORKSPACE_ID);
        expect(mocks.getClient).toHaveBeenCalledWith(WORKSPACE_ID);
    });
});
