/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UnifiedWorkResourceTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedWorkResourceTab';
import { registerCloneBaseUrls, resetCloneRegistryForTests, setActiveCloneForRouting } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { useCocClient } from '../../../../src/server/spa/client/react/repos/cloneRouting';
import { panelWorkspaceResourceInput, panelOwnerForSelection } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelWorkspaceResources';
import { openTab, EMPTY_UNIFIED_PANEL } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/usePullRequestsEnabled', () => ({ usePullRequestsEnabled: () => flag.enabled }));
vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemsTab', () => ({ WorkItemsTab: OwnerScreen }));
vi.mock('../../../../src/server/spa/client/react/features/pull-requests/PullRequestsTab', () => ({ PullRequestsTab: OwnerScreen }));
function OwnerScreen({ workspaceId, attachmentDestinationId, originId, remoteUrl }: { workspaceId: string; attachmentDestinationId: string; originId?: string; remoteUrl?: string }) {
    const client = useCocClient(workspaceId);
    return <button data-testid="reused-screen" data-owner={attachmentDestinationId} data-origin={originId ?? remoteUrl}
        onClick={() => void client.workspaces.gitInfo(workspaceId)}>Read owner</button>;
}
const network = vi.fn<typeof fetch>();
beforeEach(() => {
    flag.enabled = true;
    resetCloneRegistryForTests();
    registerCloneBaseUrls([{ workspaceId: 'repo', serverId: 'a', baseUrl: 'https://a.test' }, { workspaceId: 'repo', serverId: 'b', baseUrl: 'https://b.test' }]);
    setActiveCloneForRouting('remote:b:repo');
    network.mockReset().mockImplementation(async () => new Response(JSON.stringify({ isGitRepo: true, remoteUrl: 'https://github.com/acme/repo.git' }), { status: 200 }));
    vi.stubGlobal('fetch', network);
});
afterEach(() => { cleanup(); resetCloneRegistryForTests(); vi.unstubAllGlobals(); });
function renderTool(kind: 'work-items' | 'pull-requests', ownerId = 'remote:a:repo') {
    const input = panelWorkspaceResourceInput(kind, panelOwnerForSelection(ownerId, null));
    const tab = openTab(EMPTY_UNIFIED_PANEL, input).workspaceTabs[0];
    return render(<UnifiedWorkResourceTab scopeId="remote:a:group-work" tab={tab} />);
}
describe('reused WI/PR screens', () => {
    it.each(['work-items', 'pull-requests'] as const)('pins the %s screen to the member server, independent of the active clone alias', async kind => {
        renderTool(kind);
        const button = await screen.findByTestId('reused-screen');
        expect(button).toHaveAttribute('data-owner', 'remote:a:repo');
        expect(button).toHaveAttribute('data-origin', kind === 'work-items' ? 'gh_acme_repo' : 'https://github.com/acme/repo.git');
        fireEvent.click(button);
        await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
        expect(network.mock.calls.every(([url]) => String(url).startsWith('https://a.test/api/workspaces/repo/'))).toBe(true);
    });
    it('waits for an unresolved remote owner without sending local requests', () => {
        renderTool('work-items', 'remote:missing:repo');
        expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
        expect(network).not.toHaveBeenCalled();
    });
    it('preserves the existing PR feature gate without issuing provider reads', () => {
        flag.enabled = false;
        renderTool('pull-requests');
        expect(screen.getByRole('status')).toHaveTextContent('disabled');
        expect(network).not.toHaveBeenCalled();
    });
});
