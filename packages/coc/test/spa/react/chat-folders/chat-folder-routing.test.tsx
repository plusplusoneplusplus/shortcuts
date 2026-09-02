/**
 * Chat-folder hooks route every workspace-scoped call at the server that owns
 * the workspace.
 *
 * A remote workspace on an SSH host is served from its own forwarded origin, and
 * its `ws-v2-...` id does not exist on the page-origin server — so a call made
 * with the default SPA client 404s and the UI reports "Could not create folder".
 * These tests pin the routing itself: the real clone registry resolves the base
 * URL, and only the stub for that URL may see the call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

interface StubProcesses {
    listChatFolders: ReturnType<typeof vi.fn>;
    createChatFolder: ReturnType<typeof vi.fn>;
    updateChatFolder: ReturnType<typeof vi.fn>;
    deleteChatFolder: ReturnType<typeof vi.fn>;
    setProcessFolder: ReturnType<typeof vi.fn>;
    setProcessFolderBatch: ReturnType<typeof vi.fn>;
}

const { LOCAL, stubsByBaseUrl, makeStub } = vi.hoisted(() => {
    const make = (): { processes: any } => ({
        processes: {
            listChatFolders: vi.fn(async () => ({ folders: [] })),
            createChatFolder: vi.fn(async () => ({ folder: { id: 'f-new', name: 'n', color: 'blue', sortIndex: 0 } })),
            updateChatFolder: vi.fn(async () => ({})),
            deleteChatFolder: vi.fn(async () => ({})),
            setProcessFolder: vi.fn(async () => ({})),
            setProcessFolderBatch: vi.fn(async () => ({})),
        },
    });
    return { LOCAL: make(), stubsByBaseUrl: new Map<string, { processes: any }>(), makeStub: make };
});

function clientFor(baseUrl?: string): { processes: StubProcesses } {
    if (!baseUrl) return LOCAL as any;
    let stub = stubsByBaseUrl.get(baseUrl);
    if (!stub) {
        stub = makeStub();
        stubsByBaseUrl.set(baseUrl, stub);
    }
    return stub as any;
}

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => LOCAL,
    getCocClientFor: (baseUrl?: string) => clientFor(baseUrl),
    toSpaCocRequestOptions: (options?: unknown) => options ?? {},
    translateSpaCocClientError: (error: unknown) => { throw error; },
}));

import { useChatFolders } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatFolders';
import { useChatFolderMutations } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatFolderMutations';
import { useChatFolderAssignment } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatFolderAssignment';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_WS = 'ws-v2-remote';
const REMOTE_URL = 'http://127.0.0.1:4321';
const LOCAL_WS = 'ws-v2-local';

function remote(): { processes: StubProcesses } {
    return clientFor(REMOTE_URL);
}

function mutationOptions(workspaceId: string | undefined, overrides: Record<string, any> = {}): any {
    return {
        workspaceId,
        setFolders: vi.fn(),
        refresh: vi.fn(),
        folderIdByProcess: new Map<string, string>(),
        folders: [],
        ...overrides,
    };
}

beforeEach(() => {
    resetCloneRegistryForTests();
    stubsByBaseUrl.clear();
    for (const fn of Object.values(LOCAL.processes)) (fn as any).mockClear();
    registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_URL }]);
});

afterEach(() => {
    resetCloneRegistryForTests();
});

describe('useChatFolders clone routing', () => {
    it('lists a remote workspace’s folders from the remote server', async () => {
        remote().processes.listChatFolders.mockResolvedValue({ folders: [{ id: 'f1' }] });

        const { result } = renderHook(() => useChatFolders(REMOTE_WS, true));

        await waitFor(() => expect(result.current.folders).toHaveLength(1));
        expect(remote().processes.listChatFolders).toHaveBeenCalledWith(REMOTE_WS);
        expect(LOCAL.processes.listChatFolders).not.toHaveBeenCalled();
    });

    it('keeps a local workspace on the default SPA client', async () => {
        renderHook(() => useChatFolders(LOCAL_WS, true));

        await waitFor(() => expect(LOCAL.processes.listChatFolders).toHaveBeenCalledWith(LOCAL_WS));
        expect(stubsByBaseUrl.size).toBe(0);
    });
});

describe('useChatFolderMutations clone routing', () => {
    it('creates a folder on the remote server', async () => {
        const { result } = renderHook(() => useChatFolderMutations(mutationOptions(REMOTE_WS)));

        await act(async () => { await result.current.commitCreate('Docs', 'blue'); });

        expect(remote().processes.createChatFolder).toHaveBeenCalledWith(REMOTE_WS, { name: 'Docs', color: 'blue' });
        expect(LOCAL.processes.createChatFolder).not.toHaveBeenCalled();
    });

    it('surfaces no error when the remote create succeeds', async () => {
        const onError = vi.fn();
        const { result } = renderHook(() => useChatFolderMutations(mutationOptions(REMOTE_WS, { onError })));

        await act(async () => { await result.current.commitCreate('Docs', 'blue'); });

        expect(onError).not.toHaveBeenCalled();
    });

    it('renames, recolors and deletes on the remote server', async () => {
        const folders = [{ id: 'f1', name: 'a', color: 'blue', sortIndex: 0 }] as any[];
        const { result } = renderHook(() => useChatFolderMutations(mutationOptions(REMOTE_WS, { folders })));

        await act(async () => { await result.current.commitRename('f1', 'renamed'); });
        await act(async () => { await result.current.recolorFolder('f1', 'green'); });
        await act(async () => { result.current.requestDelete('f1', folders as any); });

        expect(remote().processes.updateChatFolder).toHaveBeenNthCalledWith(1, REMOTE_WS, 'f1', { name: 'renamed' });
        expect(remote().processes.updateChatFolder).toHaveBeenNthCalledWith(2, REMOTE_WS, 'f1', { color: 'green' });
        await waitFor(() => expect(remote().processes.deleteChatFolder).toHaveBeenCalledWith(REMOTE_WS, 'f1'));
        expect(LOCAL.processes.updateChatFolder).not.toHaveBeenCalled();
        expect(LOCAL.processes.deleteChatFolder).not.toHaveBeenCalled();
    });

    it('reorders on the remote server', async () => {
        const folders = [
            { id: 'f1', name: 'a', color: 'blue', sortIndex: 0 },
            { id: 'f2', name: 'b', color: 'blue', sortIndex: 1 },
        ] as any[];
        const { result } = renderHook(() => useChatFolderMutations(mutationOptions(REMOTE_WS, { folders })));

        await act(async () => { await result.current.reorderFolders('f2', 'f1', 'above'); });

        expect(remote().processes.updateChatFolder).toHaveBeenCalled();
        expect(LOCAL.processes.updateChatFolder).not.toHaveBeenCalled();
    });

    it('restores a deleted folder on the remote server', async () => {
        const folders = [{ id: 'f1', name: 'a', color: 'blue', sortIndex: 0 }] as any[];
        const folderIdByProcess = new Map([['p1', 'f1']]);
        const { result } = renderHook(() =>
            useChatFolderMutations(mutationOptions(REMOTE_WS, { folders, folderIdByProcess })));

        act(() => { result.current.requestDelete('f1', folders as any); });
        await act(async () => { await result.current.confirmDelete(); });
        await act(async () => { await result.current.undoDelete(); });

        expect(remote().processes.createChatFolder).toHaveBeenCalledWith(REMOTE_WS, { name: 'a', color: 'blue' });
        expect(remote().processes.setProcessFolderBatch).toHaveBeenCalledWith(['p1'], 'f-new');
        expect(LOCAL.processes.createChatFolder).not.toHaveBeenCalled();
        expect(LOCAL.processes.setProcessFolderBatch).not.toHaveBeenCalled();
    });

    it('keeps a local workspace on the default SPA client', async () => {
        const { result } = renderHook(() => useChatFolderMutations(mutationOptions(LOCAL_WS)));

        await act(async () => { await result.current.commitCreate('Docs', 'blue'); });

        expect(LOCAL.processes.createChatFolder).toHaveBeenCalledWith(LOCAL_WS, { name: 'Docs', color: 'blue' });
        expect(stubsByBaseUrl.size).toBe(0);
    });
});

describe('useChatFolderAssignment clone routing', () => {
    it('files a single remote chat on the remote server', async () => {
        const { result } = renderHook(() => useChatFolderAssignment({
            workspaceId: REMOTE_WS,
            folderIdByProcess: new Map<string, string>(),
        }));

        await act(async () => { await result.current.moveToFolder(['p1'], 'f1'); });

        expect(remote().processes.setProcessFolder).toHaveBeenCalledWith('p1', 'f1');
        expect(LOCAL.processes.setProcessFolder).not.toHaveBeenCalled();
    });

    it('files a remote batch on the remote server', async () => {
        const { result } = renderHook(() => useChatFolderAssignment({
            workspaceId: REMOTE_WS,
            folderIdByProcess: new Map<string, string>(),
        }));

        await act(async () => { await result.current.moveToFolder(['p1', 'p2'], 'f1'); });

        expect(remote().processes.setProcessFolderBatch).toHaveBeenCalledWith(['p1', 'p2'], 'f1');
        expect(LOCAL.processes.setProcessFolderBatch).not.toHaveBeenCalled();
    });

    it('keeps a local workspace on the default SPA client', async () => {
        const { result } = renderHook(() => useChatFolderAssignment({
            workspaceId: LOCAL_WS,
            folderIdByProcess: new Map<string, string>(),
        }));

        await act(async () => { await result.current.moveToFolder(['p1'], 'f1'); });

        expect(LOCAL.processes.setProcessFolder).toHaveBeenCalledWith('p1', 'f1');
        expect(stubsByBaseUrl.size).toBe(0);
    });
});
