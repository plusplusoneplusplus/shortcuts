/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WorkspaceOwnerContext } from '../../../../src/server/spa/client/react/repos/workspaceOwnerContext';
import { useSourceCanvasContent } from '../../../../src/server/spa/client/react/features/chat/source-canvas/useSourceCanvasContent';
import { useSourceCanvasTree } from '../../../../src/server/spa/client/react/features/chat/source-canvas/useSourceCanvasTree';
import { useQuickAskSidenotes } from '../../../../src/server/spa/client/react/features/chat/quick-ask/useQuickAskSidenotes';
import { getCocClientFor, resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { openChatPopOut } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatWindowActions';
import { parsePopOutActivityRoute } from '../../../../src/server/spa/client/react/layout/PopOutChatShell';

const appState = vi.hoisted(() => ({ workspaces: [{ id: 'member', rootPath: '/other-root' }] }));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: appState }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({ useReposOptional: () => null }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useQuickAskSidenotesEnabled', () => ({
    useQuickAskSidenotesEnabled: () => true,
}));
const owner = { workspaceId: 'member', selectionId: 'remote:server-a:member', baseUrl: 'https://owner.test', rootPath: '/owner-root' };
function wrapper({ children }: { children: ReactNode }) {
    return <WorkspaceOwnerContext.Provider value={owner}>{children}</WorkspaceOwnerContext.Provider>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); resetCloneRegistryForTests(); resetSpaCocClientForTests(); });

describe('member ancillary reads', () => {
    it('opens an owner-qualified popup without changing its raw process id or endpoint', () => {
        const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
        const mark = vi.fn();
        const stateKey = `${owner.selectionId}|chat`;
        openChatPopOut({
            taskId: 'chat', workspaceId: owner.workspaceId, sourceSelectionId: owner.selectionId,
            sourceBaseUrl: owner.baseUrl, stateKey, markPoppedOut: mark,
        });
        const url = new URL(String(open.mock.calls[0][0]));
        expect(url.searchParams.get('ownerKey')).toBe(stateKey);
        expect(url.searchParams.get('cloneBaseUrl')).toBe(owner.baseUrl);
        expect(mark).toHaveBeenCalledWith(stateKey);
        expect(parsePopOutActivityRoute(url.hash, url.search)).toMatchObject({
            taskId: 'chat', workspaceId: owner.workspaceId, sourceSelectionId: owner.selectionId, ownerKey: stateKey,
        });
    });
    it('resolves files against the exact member root and reads on its owner without a member registry entry', async () => {
        registerCloneBaseUrls([{ workspaceId: 'member', serverId: 'other', baseUrl: 'https://wrong.test' }]);
        const read = vi.spyOn(getCocClientFor(owner.baseUrl).tasks, 'previewWorkspaceFile').mockResolvedValue({ content: 'owner content' } as never);
        const wrong = vi.spyOn(getCocClientFor('https://wrong.test').tasks, 'previewWorkspaceFile');
        const { result } = renderHook(() => useSourceCanvasContent({ fullPath: 'file.ts', wsId: 'member' }), { wrapper });
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(read).toHaveBeenCalledWith('member', '/owner-root/file.ts', { lines: 0 });
        expect(wrong).not.toHaveBeenCalled();
    });
    it('routes source tree and lazy children through the same concrete owner', async () => {
        const read = vi.spyOn(getCocClientFor(owner.baseUrl).explorer, 'tree').mockResolvedValue({ entries: [] } as never);
        const { result } = renderHook(() => useSourceCanvasTree({ fullPath: '/owner-root', wsId: 'member', kind: 'dir' }), { wrapper });
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(read.mock.calls[0][0]).toBe('member');
    });
    it('hydrates quick-ask side notes on the owner with raw wire workspace identity', async () => {
        const request = vi.spyOn(getCocClientFor(owner.baseUrl), 'request').mockResolvedValue({ sidenotes: [] });
        renderHook(() => useQuickAskSidenotes('chat', 'member'), { wrapper });
        await waitFor(() => expect(request).toHaveBeenCalledWith('/api/processes/chat/sidenotes?workspace=member'));
    });
});
