import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { DashboardChatReferenceRoute } from '../../../../src/server/spa/client/react/layout/DashboardChatReferenceRoute';
import { publishDashboardTopology } from '../../../../src/server/spa/client/react/shared/dashboard-discovery/topology';
import { tagRemoteWorkspaces } from '../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { buildDashboardArtifactReference } from '../../../../src/server/shared/chat-reference';
import { openUnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen', () => ({
    openUnifiedPanelTab: vi.fn(),
}));

const artifactPath = '/workspace/outputs/result.md';
const hash = buildDashboardArtifactReference('destination', 'same', 'chat', artifactPath);
const remote = () => tagRemoteWorkspaces({ id: 'new-alias', label: 'Owner', kind: 'ssh', serverIdentity: 'destination' },
    'http://localhost:7000', [{ id: 'same', name: 'Remote repo' } as WorkspaceInfo]);
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function serve(preview = async () => ({ type: 'file', path: artifactPath, resolvedWorkspaceId: 'same' })) {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost:4000');
        return json(url.pathname.endsWith('/health') ? { serverIdentity: 'destination' }
            : url.pathname.endsWith('/files/preview') ? await preview()
                : { process: { id: 'chat', type: 'chat', metadata: { workspaceId: 'same' } } });
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
}
beforeEach(() => {
    window.history.replaceState(null, '', hash);
    publishDashboardTopology('viewer', [{ id: 'same', name: 'Local collision' } as WorkspaceInfo, ...remote()], 'viewer-owner');
    vi.mocked(openUnifiedPanelTab).mockClear();
});
afterEach(() => {
    cleanup();
    publishDashboardTopology(null, []);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '#');
});

describe('qualified artifact reference navigation', () => {
    it('opens the existing read-only native file tab in the verified remote chat, never the colliding local owner', async () => {
        const fetcher = serve();
        render(<DashboardChatReferenceRoute hash={hash} />);
        await waitFor(() => expect(openUnifiedPanelTab).toHaveBeenCalledTimes(1));
        expect(openUnifiedPanelTab).toHaveBeenCalledWith('same', {
            kind: 'file', ownerWorkspaceId: 'same', ownerRoutingRef: buildRemoteCloneKey('new-alias', 'same'),
            chatId: 'chat', resourceId: '__workspace_preview__:' + artifactPath, label: 'result.md',
        });
        expect(location.hash).toBe(`#repos/${encodeURIComponent(buildRemoteCloneKey('new-alias', 'same'))}/chats/chat`);
        expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).port === '7000')).toBe(true);
    });

    it('shows unavailable on file access denial and retries without changing owner', async () => {
        const preview = vi.fn().mockRejectedValueOnce(new Error('Access denied'))
            .mockResolvedValue({ type: 'file', path: artifactPath, resolvedWorkspaceId: 'same' });
        serve(preview);
        render(<DashboardChatReferenceRoute hash={hash} />);
        await screen.findByText('Referenced chat or artifact unavailable. Reconnect its server and try again.');
        expect(location.hash).toBe(hash);
        expect(openUnifiedPanelTab).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(openUnifiedPanelTab).toHaveBeenCalledTimes(1));
        expect(preview).toHaveBeenCalledTimes(2);
    });

    it.each(['navigation', 'unmount', 'topology'] as const)('does not open a late artifact after %s', async change => {
        let finish!: (value: { type: string; path: string; resolvedWorkspaceId: string }) => void;
        serve(() => new Promise(resolve => { finish = resolve; }));
        const view = render(<DashboardChatReferenceRoute hash={hash} />);
        await waitFor(() => expect(finish).toBeTypeOf('function'));
        await act(async () => {
            if (change === 'navigation') {
                window.history.replaceState(null, '', '#repos/other/chats/other');
                window.dispatchEvent(new HashChangeEvent('hashchange'));
            } else if (change === 'unmount') view.unmount();
            else publishDashboardTopology('viewer', []);
            finish({ type: 'file', path: artifactPath, resolvedWorkspaceId: 'same' });
            await Promise.resolve();
        });
        expect(openUnifiedPanelTab).not.toHaveBeenCalled();
        expect(location.hash).not.toContain('/chats/chat');
    });
});
