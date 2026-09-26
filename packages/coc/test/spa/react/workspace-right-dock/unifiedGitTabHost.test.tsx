// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
    clearUnifiedGitTabHost,
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
import { closeTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

function HostProbe({ scope }: { scope: string }) {
    const node = useUnifiedGitTabHost(scope);
    return <div data-testid={`probe-${scope}`} data-has-node={node ? 'yes' : 'no'} />;
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

    it('repeated opens reuse one Git tab in the panel scope', () => {
        const first = openUnifiedGitTab('ws-d', { ownerWorkspaceId: 'ws-d', chatId: 'chat-1' });
        const second = openUnifiedGitTab('ws-d', { ownerWorkspaceId: 'ws-d', chatId: 'chat-2' });
        expect(second).toBe(first);
        const state = readUnifiedPanelState('ws-d');
        expect(state.workspaceTabs.filter(tab => tab.kind === 'git')).toHaveLength(1);
    });

    it('names the opened tab with unifiedGitTabId', () => {
        const id = openUnifiedGitTab('ws-e', { ownerWorkspaceId: 'ws-e', chatId: 'chat-1' });
        expect(unifiedGitTabId({ ownerWorkspaceId: 'ws-e' })).toBe(id);
    });

    it('useUnifiedGitTabOpen tracks the tab being opened and closed', () => {
        function OpenProbe() {
            const open = useUnifiedGitTabOpen('ws-f', { ownerWorkspaceId: 'ws-f' });
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
});
