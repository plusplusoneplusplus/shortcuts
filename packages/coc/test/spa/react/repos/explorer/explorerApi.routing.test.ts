import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getClient: vi.fn(),
    tree: vi.fn(),
    listFiles: vi.fn(),
    searchFiles: vi.fn(),
    searchSymbols: vi.fn(),
    searchContent: vi.fn(),
    replaceContent: vi.fn(),
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    reveal: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: mocks.getClient,
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
        mocks.getClient.mockReturnValue({
            explorer: {
                tree: mocks.tree,
                listFiles: mocks.listFiles,
                searchFiles: mocks.searchFiles,
                searchSymbols: mocks.searchSymbols,
                searchContent: mocks.searchContent,
                replaceContent: mocks.replaceContent,
                readBlob: mocks.readBlob,
                writeBlob: mocks.writeBlob,
                reveal: mocks.reveal,
            },
        });
    });

    it('routes every repo-scoped operation through the concrete clone owner', async () => {
        await explorerApi.tree(WORKSPACE_ID, { path: '/' }, ROUTING_REF);
        await explorerApi.listFiles(WORKSPACE_ID, {}, ROUTING_REF);
        await explorerApi.searchFiles(WORKSPACE_ID, 'app', {}, ROUTING_REF);
        await explorerApi.searchSymbols(WORKSPACE_ID, 'Widget', {}, ROUTING_REF);
        await explorerApi.searchContent(WORKSPACE_ID, 'symbol', {}, ROUTING_REF);
        await explorerApi.replaceContent(WORKSPACE_ID, 'before', 'after', [], {}, ROUTING_REF);
        await explorerApi.readBlob(WORKSPACE_ID, 'src/app.ts', {}, ROUTING_REF);
        await explorerApi.writeBlob(WORKSPACE_ID, 'src/app.ts', 'content', ROUTING_REF);
        await explorerApi.reveal(WORKSPACE_ID, 'src/app.ts', ROUTING_REF);

        expect(mocks.getClient).toHaveBeenCalledTimes(9);
        expect(mocks.getClient.mock.calls.every(([ref]) => ref === ROUTING_REF)).toBe(true);
    });

    it('keeps local calls on their workspace route when no concrete owner is supplied', async () => {
        await explorerApi.tree(WORKSPACE_ID);
        expect(mocks.getClient).toHaveBeenCalledWith(WORKSPACE_ID);
    });
});
