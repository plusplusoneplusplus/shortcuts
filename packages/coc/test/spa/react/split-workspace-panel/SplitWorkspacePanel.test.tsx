/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
    SplitWorkspacePanel,
    splitWorkspaceWidthStorageKey,
    splitWorkspaceDividerStorageKey,
    splitWorkspaceChatCollapsedStorageKey,
    splitWorkspaceGitCollapsedStorageKey,
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

    it('exposes visible accessible resize handles for both split lines', () => {
        renderPanel();
        const divider = screen.getByTestId('split-workspace-divider');
        const widthDivider = screen.getByTestId('split-workspace-width-divider');

        expect(divider.getAttribute('role')).toBe('separator');
        expect(divider.getAttribute('aria-orientation')).toBe('horizontal');
        expect(divider.getAttribute('aria-valuemin')).toBe('120');
        expect(divider.getAttribute('aria-valuemax')).toBe('800');
        expect(divider.getAttribute('aria-valuenow')).toBe('320');
        expect(divider.className).toContain('h-2');

        expect(widthDivider.getAttribute('role')).toBe('separator');
        expect(widthDivider.getAttribute('aria-orientation')).toBe('vertical');
        expect(widthDivider.getAttribute('aria-valuemin')).toBe('240');
        expect(widthDivider.getAttribute('aria-valuemax')).toBe('640');
        expect(widthDivider.getAttribute('aria-valuenow')).toBe('360');
        expect(widthDivider.className).toContain('w-2');
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

    it('renders no docked footer when no footer prop is provided', () => {
        renderPanel();
        expect(screen.queryByTestId('split-workspace-footer')).toBeNull();
    });

    it('docks a footer at the bottom of the left column when provided', () => {
        render(
            <SplitWorkspacePanel
                workspaceId="ws-footer"
                chatList={<div data-testid="chat-content">chat</div>}
                gitList={<div data-testid="git-content">git</div>}
                detail={<div data-testid="detail-content">detail</div>}
                footer={<div data-testid="my-footer">footer</div>}
            />,
        );
        const footer = screen.getByTestId('split-workspace-footer');
        expect(footer).toBeTruthy();
        // It lives inside the left column (not the shared detail pane), pinned
        // so it never scrolls or grows.
        const leftColumn = screen.getByTestId('split-workspace-left');
        expect(leftColumn.contains(footer)).toBe(true);
        expect(footer.className).toContain('flex-shrink-0');
        expect(screen.getByTestId('my-footer')).toHaveTextContent('footer');
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

describe('SplitWorkspacePanel collapsible sections', () => {
    beforeEach(() => {
        localStorage.clear();
        mockIsMobile = false;
    });

    it('renders a compact collapsible header for each half, expanded by default', () => {
        renderPanel();
        const chatHeader = screen.getByTestId('split-workspace-chat-header');
        const gitHeader = screen.getByTestId('split-workspace-git-header');
        // Both start expanded.
        expect(chatHeader.getAttribute('aria-expanded')).toBe('true');
        expect(gitHeader.getAttribute('aria-expanded')).toBe('true');
        // Compact: a short fixed-height bar so the header barely costs vertical
        // space (the explicit ask).
        expect(chatHeader.className).toContain('h-[22px]');
        expect(gitHeader.className).toContain('h-[22px]');
        // Distinct tinted band so the header is visually identifiable against
        // the white chat/git content below (not left-transparent/white).
        expect(chatHeader.className).toContain('bg-[#e4e9f2]');
        expect(gitHeader.className).toContain('bg-[#e4e9f2]');
        // Bodies are visible (not hidden) while expanded.
        expect(screen.getByTestId('split-workspace-chat-body').classList.contains('hidden')).toBe(false);
        expect(screen.getByTestId('split-workspace-git-body').classList.contains('hidden')).toBe(false);
    });

    it('uses custom section labels when provided', () => {
        render(
            <SplitWorkspacePanel
                workspaceId="ws-labels"
                chatList={<div>chat</div>}
                gitList={<div>git</div>}
                detail={<div>detail</div>}
                chatLabel="Conversations"
                gitLabel="Source Control"
            />,
        );
        expect(screen.getByTestId('split-workspace-chat-header')).toHaveTextContent('Conversations');
        expect(screen.getByTestId('split-workspace-git-header')).toHaveTextContent('Source Control');
    });

    it('collapsing the chat half hides its body, drops the divider, and lets git fill', () => {
        renderPanel();
        act(() => {
            fireEvent.click(screen.getByTestId('split-workspace-chat-header'));
        });
        // Body hidden but still mounted; header still present and marked collapsed.
        expect(screen.getByTestId('split-workspace-chat-body').classList.contains('hidden')).toBe(true);
        expect(screen.getByTestId('split-workspace-chat-header').getAttribute('aria-expanded')).toBe('false');
        // The fixed-height style is dropped so the collapsed half is header-only.
        expect(screen.getByTestId('split-workspace-chat').style.height).toBe('');
        // No rebalance divider while a half is collapsed.
        expect(screen.queryByTestId('split-workspace-divider')).toBeNull();
        // Git half grows to fill the freed space.
        expect(screen.getByTestId('split-workspace-git').className).toContain('flex-1');
    });

    it('collapsing the git half hides its body and lets chat fill', () => {
        renderPanel();
        act(() => {
            fireEvent.click(screen.getByTestId('split-workspace-git-header'));
        });
        expect(screen.getByTestId('split-workspace-git-body').classList.contains('hidden')).toBe(true);
        expect(screen.getByTestId('split-workspace-git-header').getAttribute('aria-expanded')).toBe('false');
        // Chat half now fills (no fixed height) and the divider is gone.
        expect(screen.getByTestId('split-workspace-chat').className).toContain('flex-1');
        expect(screen.getByTestId('split-workspace-chat').style.height).toBe('');
        expect(screen.queryByTestId('split-workspace-divider')).toBeNull();
    });

    it('can collapse both halves at once (headers stay, both bodies hidden)', () => {
        renderPanel();
        act(() => {
            fireEvent.click(screen.getByTestId('split-workspace-chat-header'));
        });
        act(() => {
            fireEvent.click(screen.getByTestId('split-workspace-git-header'));
        });
        expect(screen.getByTestId('split-workspace-chat-body').classList.contains('hidden')).toBe(true);
        expect(screen.getByTestId('split-workspace-git-body').classList.contains('hidden')).toBe(true);
        // Headers remain the click targets to expand again.
        expect(screen.getByTestId('split-workspace-chat-header')).toBeTruthy();
        expect(screen.getByTestId('split-workspace-git-header')).toBeTruthy();
    });

    it('toggling a header expands it back and restores the divider and fixed height', () => {
        renderPanel();
        const chatHeader = () => screen.getByTestId('split-workspace-chat-header');
        act(() => { fireEvent.click(chatHeader()); });
        expect(chatHeader().getAttribute('aria-expanded')).toBe('false');
        act(() => { fireEvent.click(chatHeader()); });
        expect(chatHeader().getAttribute('aria-expanded')).toBe('true');
        // Both expanded again → the rebalance divider returns...
        expect(screen.getByTestId('split-workspace-divider')).toBeTruthy();
        // ...and chat regains its persisted fixed height.
        expect(screen.getByTestId('split-workspace-chat').style.height).toBe('320px');
    });

    it('persists collapsed state per-workspace on toggle', () => {
        renderPanel('ws-collapse');
        act(() => { fireEvent.click(screen.getByTestId('split-workspace-chat-header')); });
        act(() => { fireEvent.click(screen.getByTestId('split-workspace-git-header')); });
        expect(localStorage.getItem(splitWorkspaceChatCollapsedStorageKey('ws-collapse'))).toBe('1');
        expect(localStorage.getItem(splitWorkspaceGitCollapsedStorageKey('ws-collapse'))).toBe('1');
        // Keys are workspace-scoped: another workspace has nothing stored.
        expect(localStorage.getItem(splitWorkspaceChatCollapsedStorageKey('ws-other'))).toBeNull();
    });

    it('does not write a collapsed key until the user toggles', () => {
        renderPanel('ws-clean');
        expect(localStorage.getItem(splitWorkspaceChatCollapsedStorageKey('ws-clean'))).toBeNull();
        expect(localStorage.getItem(splitWorkspaceGitCollapsedStorageKey('ws-clean'))).toBeNull();
    });

    it('re-expanding writes the collapsed flag back to 0', () => {
        renderPanel('ws-roundtrip');
        const chatHeader = () => screen.getByTestId('split-workspace-chat-header');
        act(() => { fireEvent.click(chatHeader()); });
        expect(localStorage.getItem(splitWorkspaceChatCollapsedStorageKey('ws-roundtrip'))).toBe('1');
        act(() => { fireEvent.click(chatHeader()); });
        expect(localStorage.getItem(splitWorkspaceChatCollapsedStorageKey('ws-roundtrip'))).toBe('0');
    });

    it('restores persisted collapsed state on a fresh mount', () => {
        localStorage.setItem(splitWorkspaceChatCollapsedStorageKey('ws-restore'), '1');
        renderPanel('ws-restore');
        expect(screen.getByTestId('split-workspace-chat-header').getAttribute('aria-expanded')).toBe('false');
        expect(screen.getByTestId('split-workspace-chat-body').classList.contains('hidden')).toBe(true);
        // Git was not persisted collapsed → it stays expanded.
        expect(screen.getByTestId('split-workspace-git-header').getAttribute('aria-expanded')).toBe('true');
        // A collapsed chat on load means no rebalance divider.
        expect(screen.queryByTestId('split-workspace-divider')).toBeNull();
    });
});
