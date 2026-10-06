import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveChatFileLink } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/resolveChatFileLink';
import { sourceLinkTabInput, type SourceLinkTabInputArgs } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedSourceLinks';
import { openTab, EMPTY_UNIFIED_PANEL, parseUnifiedPanelState, serializeUnifiedPanelState, visibleTabs } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const { request, client } = vi.hoisted(() => {
    const request = vi.fn();
    return { request, client: vi.fn(() => ({ request })) };
});
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/workspacePreview', () => ({
    WORKSPACE_PREVIEW_PREFIX: '__workspace_preview__:',
    workspacePreviewClient: client,
}));
const args: SourceLinkTabInputArgs = {
    fileRef: { fullPath: 'src/app.ts', wsId: 'group-demo' },
    workspaces: [
        { id: 'group-demo', rootPath: '/groups/demo' },
        { id: 'ws-member', name: 'member', rootPath: '/repos/member' },
    ],
    sourceSelectionId: 'group-demo',
    scopeWorkspaceId: 'group-demo',
    chatId: 'chat-a',
};
describe('chat file link resolution', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each(['plot.png', 'data.csv', 'note.md', 'paper.pdf', 'bundle.zip'])(
        'preflights group %s without reading content and opens a read-only member tab', async name => {
            request.mockResolvedValue({ type: 'file', path: `/repos/member/${name}`, resolvedWorkspaceId: 'ws-member' });
            const signal = new AbortController().signal;
            const result = await resolveChatFileLink({ ...args, fileRef: { fullPath: name, wsId: 'group-demo' } }, signal);
            expect(request).toHaveBeenCalledWith('/workspaces/group-demo/files/preview', {
                query: { path: name, resolve: true }, signal,
            });
            expect(result).toMatchObject({
                type: 'tab', input: { kind: 'file', ownerWorkspaceId: 'ws-member', ownerRoutingRef: null,
                    chatId: 'chat-a', resourceId: `__workspace_preview__:/repos/member/${name}` },
            });
        },
    );

    it('keeps files from a concrete remote group on that server despite colliding roots', async () => {
        request.mockResolvedValue({ type: 'file', path: '/repos/member/data.csv', resolvedWorkspaceId: 'ws-member' });
        const remote = {
            ...args, sourceSelectionId: 'remote:server-b:group-demo',
            workspaces: [...args.workspaces, ...args.workspaces.map(ws => ({
                ...ws, remote: { cloneKey: `remote:server-b:${ws.id}` },
            }))],
        };
        const result = await resolveChatFileLink(remote, new AbortController().signal);
        expect(client).toHaveBeenCalledWith('group-demo', 'remote:server-b:group-demo');
        expect(result).toMatchObject({ type: 'tab', input: { ownerRoutingRef: 'remote:server-b:ws-member' } });
    });

    it('opens a folder in the group panel Explorer with its resolved member', async () => {
        request.mockResolvedValue({ type: 'directory', path: '/repos/member/src', resolvedWorkspaceId: 'ws-member' });
        expect(await resolveChatFileLink({
            ...args, fileRef: { fullPath: 'src/', wsId: 'group-demo', kind: 'dir' },
        }, new AbortController().signal)).toEqual({
            type: 'directory', detail: { scopeWorkspaceId: 'group-demo', chatId: 'chat-a',
                ownerWorkspaceId: 'ws-member', ownerRoutingRef: null, path: 'src' },
        });
    });

    it('does not turn group resolution into an editable note', async () => {
        request.mockResolvedValue({ type: 'file', path: '/repos/member/plan.md', resolvedWorkspaceId: 'ws-member' });
        expect(await resolveChatFileLink({
            ...args, fileRef: { fullPath: 'plan.md', wsId: 'group-demo', kind: 'note' },
        }, new AbortController().signal)).toMatchObject({ type: 'tab', input: { kind: 'file' } });
    });

    it('surfaces denied or missing preflights instead of opening a chat-local fallback', async () => {
        request.mockRejectedValue(new Error('Access denied'));
        await expect(resolveChatFileLink(args, new AbortController().signal)).rejects.toThrow('Access denied');
    });

    it('rejects stale or malformed owner responses', async () => {
        request.mockResolvedValue({ type: 'file', path: 'relative.csv' });
        await expect(resolveChatFileLink(args, new AbortController().signal)).rejects.toThrow('owner');
    });

    it('aborts a late preflight without publishing a tab', async () => {
        const controller = new AbortController();
        request.mockImplementation(async () => {
            controller.abort();
            return { type: 'file', path: '/repos/member/a.ts', resolvedWorkspaceId: 'ws-member' };
        });
        await expect(resolveChatFileLink(args, controller.signal)).rejects.toThrow('Aborted');
    });

    it('opens HTML View source read-only in the panel', async () => {
        expect(await resolveChatFileLink({
            ...args, fileRef: { fullPath: '/repos/member/page.html', wsId: 'ws-member' }, forceSourceViewer: true,
        }, new AbortController().signal)).toMatchObject({
            type: 'tab', input: { resourceId: '__workspace_preview__:/repos/member/page.html' },
        });
        expect(request).not.toHaveBeenCalled();
    });

    it('dedupes, persists ranges, and restores tabs only in their originating chat', () => {
        const input = sourceLinkTabInput({
            ...args, fileRef: { fullPath: '/outputs/data.csv', wsId: 'ws-member', line: 2, endLine: 4 },
        })!;
        const state = openTab(openTab(EMPTY_UNIFIED_PANEL, input), input);
        expect(visibleTabs(state, 'chat-a')).toHaveLength(1);
        expect(visibleTabs(state, 'chat-b')).toHaveLength(0);
        const restored = parseUnifiedPanelState(serializeUnifiedPanelState(state));
        expect(visibleTabs(restored, 'chat-a')[0]).toMatchObject({ resourceId: input.resourceId, line: 2, endLine: 4 });
    });
});
