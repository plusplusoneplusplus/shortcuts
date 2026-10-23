/**
 * The way back from an Explorer file a diff's go to definition opened: the
 * cross-tree store, the Explorer helper that records it, and the tab chip.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
    clearDiffDefinitionReturn, getDiffDefinitionReturn, recordDiffDefinitionReturn,
    resetDiffDefinitionReturns, returnToDiffDefinitionOrigin,
} from '../../../../../../src/server/spa/client/react/features/git/diff/diffDefinitionReturn';
import { openDiffDefinitionInExplorer } from '../../../../../../src/server/spa/client/react/features/git/diff/diffDefinitionExplorer';
import { DiffDefinitionReturnChip } from '../../../../../../src/server/spa/client/react/features/git/diff/DiffDefinitionReturnChip';
import { openUnifiedPanelTab } from '../../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { clearUnifiedPanelState, readUnifiedPanelState } from '../../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { activeTabId } from '../../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const SCOPE = 'group-1';
const panelHost = { workspaceId: SCOPE, chatId: 'chat-1', routingRef: null };
const route = { kind: 'explorer' as const, path: 'lib/util.ts', line: 9, column: 3 };

function openOriginTab(): string {
    return openUnifiedPanelTab(SCOPE, {
        kind: 'file', ownerWorkspaceId: 'ws-a', chatId: 'chat-1', resourceId: 'src/host.ts', label: 'host.ts',
    });
}

beforeEach(() => {
    resetDiffDefinitionReturns();
    clearUnifiedPanelState();
});
afterEach(() => cleanup());

describe('diffDefinitionReturn store', () => {
    it('returns false and does nothing for a tab no diff jump opened', () => {
        expect(returnToDiffDefinitionOrigin(SCOPE, 'tab-x')).toBe(false);
    });

    it('takes the entry once, refocuses the origin tab and restores the diff', () => {
        const origin = openOriginTab();
        const other = openUnifiedPanelTab(SCOPE, { kind: 'file', ownerWorkspaceId: 'ws-a', chatId: 'chat-1', resourceId: 'lib/util.ts', label: 'util.ts' });
        expect(activeTabId(readUnifiedPanelState(SCOPE), 'chat-1')).toBe(other);
        const restore = vi.fn();
        recordDiffDefinitionReturn(SCOPE, other, { label: 'abc1234 · a.ts', originTabId: origin, chatId: 'chat-1', restore });
        expect(returnToDiffDefinitionOrigin(SCOPE, other)).toBe(true);
        expect(activeTabId(readUnifiedPanelState(SCOPE), 'chat-1')).toBe(origin);
        expect(restore).toHaveBeenCalledTimes(1);
        expect(returnToDiffDefinitionOrigin(SCOPE, other)).toBe(false);
    });

    it('keys entries by panel scope, so another workspace never sees them', () => {
        recordDiffDefinitionReturn(SCOPE, 'tab-1', { label: 'x', originTabId: null, chatId: null });
        expect(getDiffDefinitionReturn('group-2', 'tab-1')).toBeNull();
        expect(returnToDiffDefinitionOrigin('group-2', 'tab-1')).toBe(false);
        clearDiffDefinitionReturn(SCOPE, 'tab-1');
        expect(getDiffDefinitionReturn(SCOPE, 'tab-1')).toBeNull();
    });
});

describe('openDiffDefinitionInExplorer return recording', () => {
    it('records the tab that hosted the diff as the way back', () => {
        const origin = openOriginTab();
        const restore = vi.fn();
        expect(openDiffDefinitionInExplorer({ route, workspaceId: 'ws-a', panelHost, returnTo: { label: 'abc1234 · a.ts', restore } })).toBe(true);
        const explorerTab = activeTabId(readUnifiedPanelState(SCOPE), 'chat-1')!;
        expect(explorerTab).not.toBe(origin);
        expect(getDiffDefinitionReturn(SCOPE, explorerTab)).toEqual({ label: 'abc1234 · a.ts', originTabId: origin, chatId: 'chat-1', restore });
    });

    it('records nothing without a return, or when the target is the tab already shown', () => {
        openDiffDefinitionInExplorer({ route, workspaceId: 'ws-a', panelHost });
        const explorerTab = activeTabId(readUnifiedPanelState(SCOPE), 'chat-1')!;
        expect(getDiffDefinitionReturn(SCOPE, explorerTab)).toBeNull();
        openDiffDefinitionInExplorer({ route, workspaceId: 'ws-a', panelHost, returnTo: { label: 'x' } });
        expect(getDiffDefinitionReturn(SCOPE, explorerTab)).toBeNull();
    });

    it('records nothing for the deep-link fallback (the browser Back returns)', () => {
        location.hash = '';
        openDiffDefinitionInExplorer({ route, workspaceId: 'ws-a', panelHost: null, returnTo: { label: 'x' } });
        expect(location.hash).toBe(`#repos/ws-a/explorer/${encodeURIComponent('lib/util.ts')}`);
        expect(getDiffDefinitionReturn(SCOPE, 'tab-id')).toBeNull();
        location.hash = '';
    });
});

describe('DiffDefinitionReturnChip', () => {
    it('renders nothing for a tab without a way back', () => {
        render(<DiffDefinitionReturnChip scopeWorkspaceId={SCOPE} tabId="tab-1" />);
        expect(screen.queryByTestId('diff-definition-return-chip')).toBeNull();
    });

    it('shows the diff label, returns on click and disappears', () => {
        const restore = vi.fn();
        render(<DiffDefinitionReturnChip scopeWorkspaceId={SCOPE} tabId="tab-1" />);
        act(() => { recordDiffDefinitionReturn(SCOPE, 'tab-1', { label: 'abc1234 · a.ts', originTabId: null, chatId: null, restore }); });
        expect(screen.getByTestId('diff-definition-return-chip').textContent).toBe('← Back to abc1234 · a.ts');
        fireEvent.click(screen.getByTestId('diff-definition-return-chip'));
        expect(restore).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('diff-definition-return-chip')).toBeNull();
    });

    it('forgets the way back when its tab closes', () => {
        recordDiffDefinitionReturn(SCOPE, 'tab-1', { label: 'x', originTabId: null, chatId: null });
        const view = render(<DiffDefinitionReturnChip scopeWorkspaceId={SCOPE} tabId="tab-1" />);
        view.unmount();
        expect(getDiffDefinitionReturn(SCOPE, 'tab-1')).toBeNull();
    });
});
