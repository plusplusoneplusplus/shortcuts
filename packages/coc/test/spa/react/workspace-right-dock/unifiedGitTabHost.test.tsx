// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
    clearUnifiedGitTabHost,
    getUnifiedGitTabDirtyBridge,
    getUnifiedGitTabHost,
    setUnifiedGitTabHost,
    useUnifiedGitTabHost,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedGitTabHost';
import { UnifiedGitTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedGitTab';
import { useSplitGitPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useSplitGitPanel';

/**
 * unifiedGitTabHost is now only the DOM-host / dirty-bridge seam between the
 * split workspace's git list and the panel's `coc://git` page tab body — the
 * tab's own identity and address live in `useSplitGitPanel`
 * (useSplitGitPanel.test.tsx covers that contract, including the round trip
 * between an external open and the detail's own selection).
 */

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

    it('forwards the detail dirty/save reports to the mounted Git tab of the same scope only', () => {
        const dirtyA = vi.fn();
        const registerA = vi.fn();
        const dirtyB = vi.fn();
        let panelA: ReturnType<typeof useSplitGitPanel> | null = null;
        function Probe() {
            panelA = useSplitGitPanel({ scopeWorkspaceId: 'ws-a', enabled: true });
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
            panel = useSplitGitPanel({ scopeWorkspaceId: 'ws-x', enabled: false });
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
});
