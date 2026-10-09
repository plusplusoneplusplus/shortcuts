// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
    clearUnifiedGitTabHost,
    getUnifiedGitTabDirtyBridge,
    getUnifiedGitTabHost,
    openUnifiedGitTab,
    setUnifiedGitTabHost,
    unifiedGitTabId,
    useUnifiedGitTabHost,
    useUnifiedGitTabOpen,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedGitTabHost';
import { UnifiedGitTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedGitTab';
import { readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { updateUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { closeTab, parseUnifiedPanelState, serializeUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { useSplitGitPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useSplitGitPanel';

function HostProbe({ scope }: { scope: string }) {
    const node = useUnifiedGitTabHost(scope);
    return <div data-testid={`probe-${scope}`} data-has-node={node ? 'yes' : 'no'} />;
}

function SingleRepoProbe({ chatId = null }: { chatId?: string | null }) {
    const panel = useSplitGitPanel({ scopeWorkspaceId: 'single-repo', chatId, enabled: true });
    return <>
        <button data-testid="select-commit" onClick={() => panel.onViewChange?.({
            type: 'commit', commit: {
                hash: 'abc1234', shortHash: 'abc1234', subject: 'Example',
                author: 'Test', date: '2026-01-01', parentHashes: [],
            },
        })}>commit</button>
        <span data-testid="single-repo-status"
            data-open={String(panel.detailOpen)}
            data-restored={panel.restoreView?.type === 'commit' ? panel.restoreView.hash : ''}
            data-host={String(!!panel.detailContainer)}
            data-scope={String(panel.viewScopeKey)} />
        {panel.detailOpen && <UnifiedGitTab scopeWorkspaceId="single-repo" />}
    </>;
}

beforeEach(() => {
    localStorage.clear();
});

describe('unifiedGitTab host store', () => {
    it('publishes the mounted tab body per panel scope and withdraws it on unmount', () => {
        const { unmount } = render(<>
            <HostProbe scope="ws-a" />
            <HostProbe scope="ws-b" />
            <UnifiedGitTab scopeWorkspaceId="ws-a" />
        </>);
        expect(screen.getByTestId('probe-ws-a').getAttribute('data-has-node')).toBe('yes');
        expect(screen.getByTestId('probe-ws-b').getAttribute('data-has-node')).toBe('no');
        expect(getUnifiedGitTabHost('ws-a')).toBe(screen.getByTestId('unified-git-tab'));
        unmount();
        expect(getUnifiedGitTabHost('ws-a')).toBeNull();
    });

    it('forwards the detail dirty/save reports to the mounted Git tab of the same scope only', () => {
        const dirtyA = vi.fn();
        const registerA = vi.fn();
        const dirtyB = vi.fn();
        let panelA: ReturnType<typeof useSplitGitPanel> | null = null;
        function Probe() {
            panelA = useSplitGitPanel({ scopeWorkspaceId: 'ws-a', chatId: null, enabled: true });
            return null;
        }
        const { rerender } = render(<>
            <Probe />
            <UnifiedGitTab scopeWorkspaceId="ws-a" onDirtyChange={dirtyA} onRegisterSave={registerA} />
            <UnifiedGitTab scopeWorkspaceId="ws-b" onDirtyChange={dirtyB} />
        </>);
        const save = async () => true;
        panelA!.onDetailDirtyChange?.(true);
        panelA!.onDetailRegisterSave?.(save);
        expect(dirtyA).toHaveBeenCalledWith(true);
        expect(registerA).toHaveBeenCalledWith(save);
        expect(dirtyB).not.toHaveBeenCalled();

        // Unmounting the tab withdraws the bridge; later reports are dropped.
        rerender(<Probe />);
        expect(getUnifiedGitTabDirtyBridge('ws-a')).toBeNull();
        panelA!.onDetailDirtyChange?.(false);
        expect(dirtyA).toHaveBeenCalledTimes(1);
    });

    it('a disabled split panel exposes no dirty seams', () => {
        let panel: ReturnType<typeof useSplitGitPanel> | null = null;
        function Probe() {
            panel = useSplitGitPanel({ scopeWorkspaceId: 'ws-x', chatId: null, enabled: false });
            return null;
        }
        render(<Probe />);
        expect(panel!.onDetailDirtyChange).toBeUndefined();
        expect(panel!.onDetailRegisterSave).toBeUndefined();
    });

    it('a stale clear does not erase a newer node', () => {
        const first = document.createElement('div');
        const second = document.createElement('div');
        act(() => {
            setUnifiedGitTabHost('ws-c', first);
            setUnifiedGitTabHost('ws-c', second);
            clearUnifiedGitTabHost('ws-c', first);
        });
        expect(getUnifiedGitTabHost('ws-c')).toBe(second);
        clearUnifiedGitTabHost('ws-c', second);
        expect(getUnifiedGitTabHost('ws-c')).toBeNull();
    });

    it('repeated opens reuse one Git tab per chat, and each chat has its own', () => {
        const first = openUnifiedGitTab('ws-d', { ownerWorkspaceId: 'ws-d', chatId: 'chat-1' });
        expect(openUnifiedGitTab('ws-d', { ownerWorkspaceId: 'ws-d', chatId: 'chat-1' })).toBe(first);
        const other = openUnifiedGitTab('ws-d', { ownerWorkspaceId: 'ws-d', chatId: 'chat-2' });
        expect(other).not.toBe(first);
        const state = readUnifiedPanelState('ws-d');
        expect(state.workspaceTabs).toEqual([]);
        expect(state.chatTabs['chat-1'].map(tab => tab.id)).toEqual([first]);
        expect(state.chatTabs['chat-2'].map(tab => tab.id)).toEqual([other]);
    });

    it('persists the data member with a group Git view when the same tab is reused', () => {
        openUnifiedGitTab('group-example', {
            ownerWorkspaceId: 'group-example', chatId: null, gitMemberId: 'repo-a',
            gitView: { type: 'commit', hash: 'abc1234' },
        });
        openUnifiedGitTab('group-example', {
            ownerWorkspaceId: 'group-example', chatId: null, gitMemberId: 'repo-b',
            gitView: { type: 'commit', hash: 'def5678' },
        });
        const state = readUnifiedPanelState('group-example');
        expect(state.chatTabs['@workspace'].filter(tab => tab.kind === 'git')).toHaveLength(1);
        expect(parseUnifiedPanelState(serializeUnifiedPanelState(state)).chatTabs['@workspace'].find(tab => tab.kind === 'git'))
            .toMatchObject({ gitMemberId: 'repo-b', gitView: { type: 'commit', hash: 'def5678' } });
    });

    it('names the opened tab with unifiedGitTabId', () => {
        const id = openUnifiedGitTab('ws-e', { ownerWorkspaceId: 'ws-e', chatId: 'chat-1' });
        expect(unifiedGitTabId({ ownerWorkspaceId: 'ws-e', chatId: 'chat-1' })).toBe(id);
        expect(unifiedGitTabId({ ownerWorkspaceId: 'ws-e', chatId: 'chat-2' })).not.toBe(id);
    });

    it('useUnifiedGitTabOpen tracks the tab being opened and closed', () => {
        function OpenProbe() {
            const open = useUnifiedGitTabOpen('ws-f', { ownerWorkspaceId: 'ws-f', chatId: null });
            return <div data-testid="open-probe" data-open={open ? 'yes' : 'no'} />;
        }
        render(<OpenProbe />);
        const probe = screen.getByTestId('open-probe');
        expect(probe.getAttribute('data-open')).toBe('no');
        let id = '';
        act(() => { id = openUnifiedGitTab('ws-f', { ownerWorkspaceId: 'ws-f', chatId: null }); });
        expect(probe.getAttribute('data-open')).toBe('yes');
        act(() => { updateUnifiedPanelState('ws-f', prev => closeTab(prev, id)); });
        expect(probe.getAttribute('data-open')).toBe('no');
    });

    it('keeps single-repo Git view in its existing right-panel tab across remounts', () => {
        const view = render(<SingleRepoProbe />);
        fireEvent.click(screen.getByTestId('select-commit'));
        expect(screen.getByTestId('single-repo-status').dataset).toMatchObject({
            open: 'true', restored: 'abc1234', host: 'true',
        });
        view.unmount();
        render(<SingleRepoProbe />);
        expect(screen.getByTestId('single-repo-status').dataset).toMatchObject({
            open: 'true', restored: 'abc1234', host: 'true',
        });
    });

    it('does not carry one chat\'s Git view into another chat, and restores it on return (regression)', () => {
        const view = render(<SingleRepoProbe chatId="chat-a" />);
        fireEvent.click(screen.getByTestId('select-commit'));
        expect(screen.getByTestId('single-repo-status').dataset).toMatchObject({
            open: 'true', restored: 'abc1234', host: 'true', scope: 'chat-a',
        });

        view.rerender(<SingleRepoProbe chatId="chat-b" />);
        expect(screen.getByTestId('single-repo-status').dataset).toMatchObject({
            open: 'false', restored: '', host: 'false', scope: 'chat-b',
        });

        view.rerender(<SingleRepoProbe chatId="chat-a" />);
        expect(screen.getByTestId('single-repo-status').dataset).toMatchObject({
            open: 'true', restored: 'abc1234', host: 'true', scope: 'chat-a',
        });
    });
});
