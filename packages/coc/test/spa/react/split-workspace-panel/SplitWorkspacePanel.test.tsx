/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
    SplitWorkspacePanel,
    splitWorkspaceWidthStorageKey,
    splitWorkspaceDividerStorageKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/SplitWorkspacePanel';

// Toggle the responsive fallback per test without a real matchMedia.
let mockIsMobile = false;
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        isMobile: mockIsMobile,
        isTablet: false,
        isDesktop: !mockIsMobile,
        breakpoint: mockIsMobile ? 'mobile' : 'desktop',
    }),
}));

function renderPanel(workspaceId = 'ws1') {
    return render(
        <SplitWorkspacePanel
            workspaceId={workspaceId}
            chatList={<div data-testid="chat-content">chat</div>}
            gitList={<div data-testid="git-content">git</div>}
            detail={<div data-testid="detail-content">detail</div>}
        />,
    );
}

describe('SplitWorkspacePanel', () => {
    beforeEach(() => {
        localStorage.clear();
        mockIsMobile = false;
    });

    it('renders all three slots and both dividers on desktop (AC-03)', () => {
        renderPanel();
        // Each slot's content is present exactly once.
        expect(screen.getByTestId('chat-content')).toHaveTextContent('chat');
        expect(screen.getByTestId('git-content')).toHaveTextContent('git');
        expect(screen.getByTestId('detail-content')).toHaveTextContent('detail');
        // Both the chat/git divider and the left-width divider are present.
        expect(screen.getByTestId('split-workspace-divider')).toBeTruthy();
        expect(screen.getByTestId('split-workspace-width-divider')).toBeTruthy();
    });

    it('has exactly one shared detail region (AC-04)', () => {
        renderPanel();
        expect(screen.getAllByTestId('split-workspace-detail')).toHaveLength(1);
    });

    it('starts the chat half and left column at their initial sizes', () => {
        renderPanel();
        expect(screen.getByTestId('split-workspace-chat').style.height).toBe('320px');
        expect(screen.getByTestId('split-workspace-left').style.width).toBe('360px');
    });

    it('dragging the chat/git divider rebalances the two halves (AC-03)', () => {
        renderPanel();
        const divider = screen.getByTestId('split-workspace-divider');
        // Drag down 100px (clientY 300 -> 400) grows the top (chat) half.
        act(() => {
            fireEvent.mouseDown(divider, { clientY: 300 });
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientY: 400 }));
        });
        expect(screen.getByTestId('split-workspace-chat').style.height).toBe('420px');
    });

    it('dragging the width divider resizes the left column (AC-03)', () => {
        renderPanel();
        const divider = screen.getByTestId('split-workspace-width-divider');
        // Drag right 100px (clientX 360 -> 460) widens the left column.
        act(() => {
            fireEvent.mouseDown(divider, { clientX: 360 });
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 460 }));
        });
        expect(screen.getByTestId('split-workspace-left').style.width).toBe('460px');
    });

    it('persists divider ratio and left width per-workspace on drag end (AC-06)', () => {
        renderPanel('ws-alpha');

        // Resize the divider, then release.
        act(() => {
            fireEvent.mouseDown(screen.getByTestId('split-workspace-divider'), { clientY: 300 });
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientY: 420 }));
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });

        // Resize the width, then release.
        act(() => {
            fireEvent.mouseDown(screen.getByTestId('split-workspace-width-divider'), { clientX: 360 });
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });

        // Persisted under workspace-scoped keys — not global ones.
        expect(localStorage.getItem(splitWorkspaceDividerStorageKey('ws-alpha'))).toBe('440');
        expect(localStorage.getItem(splitWorkspaceWidthStorageKey('ws-alpha'))).toBe('500');
        // Keys are workspace-scoped: a different workspace has nothing stored.
        expect(localStorage.getItem(splitWorkspaceDividerStorageKey('ws-beta'))).toBeNull();
        expect(localStorage.getItem(splitWorkspaceWidthStorageKey('ws-beta'))).toBeNull();
    });

    it('restores persisted sizes on a fresh mount (AC-06 round-trip)', () => {
        localStorage.setItem(splitWorkspaceDividerStorageKey('ws-gamma'), '500');
        localStorage.setItem(splitWorkspaceWidthStorageKey('ws-gamma'), '480');
        renderPanel('ws-gamma');
        expect(screen.getByTestId('split-workspace-chat').style.height).toBe('500px');
        expect(screen.getByTestId('split-workspace-left').style.width).toBe('480px');
    });

    it('does not persist any selection/scroll state (AC-06)', () => {
        renderPanel('ws-delta');
        act(() => {
            fireEvent.mouseDown(screen.getByTestId('split-workspace-divider'), { clientY: 300 });
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientY: 380 }));
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });
        // Whatever is written for this workspace is a layout key — never any
        // selection or scroll state.
        const allowed = new Set([
            splitWorkspaceDividerStorageKey('ws-delta'),
            splitWorkspaceWidthStorageKey('ws-delta'),
        ]);
        const keys = Object.keys(localStorage).filter((k) => k.includes('ws-delta'));
        expect(keys.length).toBeGreaterThan(0);
        expect(keys.every((k) => allowed.has(k))).toBe(true);
    });

    it('falls back to a single column with no dividers at narrow width (AC-07)', () => {
        mockIsMobile = true;
        renderPanel();
        // Slots still render...
        expect(screen.getByTestId('chat-content')).toBeTruthy();
        expect(screen.getByTestId('git-content')).toBeTruthy();
        expect(screen.getByTestId('detail-content')).toBeTruthy();
        // ...but as a single narrow column with no resize dividers.
        expect(screen.getByTestId('split-workspace-panel').getAttribute('data-narrow')).toBe('true');
        expect(screen.queryByTestId('split-workspace-divider')).toBeNull();
        expect(screen.queryByTestId('split-workspace-width-divider')).toBeNull();
    });
});
