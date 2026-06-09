import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const dormantModeState = { value: 'ghost' as 'ghost' | 'pill' };

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getCommitChatLensDormantMode: () => dormantModeState.value,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({
    CommitChatPanel: (props: any) => (
        <div
            data-testid="commit-chat-panel"
            data-workspace-id={props.workspaceId}
            data-commit-hash={props.commitHash}
            data-commit-message={props.commitMessage ?? ''}
            data-hide-empty-header={props.hideEmptyHeader ? 'true' : 'false'}
        />
    ),
}));

import { CommitChatPlacementFrame } from '../../../../src/server/spa/client/react/features/git/commits/CommitChatPlacementFrame';

beforeEach(() => {
    dormantModeState.value = 'ghost';
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

const KNOWN_RECT: DOMRect = {
    left: 500, top: 200, right: 920, bottom: 600,
    width: 420, height: 400, x: 500, y: 200, toJSON: () => ({}),
};

/**
 * Simulate mouse far away from the lens.
 * The dormant engine uses window-level mousemove with a 24ms throttle,
 * so we advance the clock past the throttle before dispatching.
 */
function simulateMouseFarAway(el: HTMLElement) {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(KNOWN_RECT);
    vi.advanceTimersByTime(30);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50 }));
}

function simulateMouseOnElement(el: HTMLElement) {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(KNOWN_RECT);
    vi.advanceTimersByTime(30);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, clientY: 300 }));
}

describe('CommitChatPlacementFrame', () => {
    it('renders a bottom-right lens frame with close and pin actions', () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        const onRestore = vi.fn();
        const onPin = vi.fn();

        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                commitMessage="fix: lens"
                presentation="lens"
                onClose={onClose}
                onMinimize={onMinimize}
                onRestore={onRestore}
                onPin={onPin}
            />,
        );

        const lens = screen.getByTestId('commit-chat-lens');
        expect(lens.className).toContain('absolute');
        expect(lens.className).toContain('bottom-4');
        expect(lens.className).toContain('right-4');
        expect(screen.getByTestId('commit-chat-lens-resize-grip')).toHaveClass('cursor-nwse-resize');
        expect(screen.getByTestId('commit-chat-lens-header')).toBeTruthy();
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-hide-empty-header')).toBe('true');

        fireEvent.click(screen.getByTestId('commit-chat-minimize-btn'));
        fireEvent.click(screen.getByTestId('commit-chat-pin-btn'));
        fireEvent.click(screen.getByTestId('commit-chat-frame-close-btn'));

        expect(onMinimize).toHaveBeenCalledOnce();
        expect(onRestore).not.toHaveBeenCalled();
        expect(onPin).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('renders a compact restorable pill when the lens is minimized', () => {
        const onRestore = vi.fn();

        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                presentation="lens"
                onClose={() => {}}
                isMinimized
                onRestore={onRestore}
            />,
        );

        expect(screen.getByTestId('commit-chat-lens-minimized')).toHaveTextContent('Commit Chat');
        expect(screen.getByTestId('commit-chat-lens-minimized')).toHaveTextContent('abc123d');
        expect(screen.getByTestId('commit-chat-lens-hidden-body')).toHaveClass('hidden');
        expect(screen.getByTestId('commit-chat-panel')).toBeTruthy();

        fireEvent.click(screen.getByTestId('commit-chat-restore-btn'));

        expect(onRestore).toHaveBeenCalledOnce();
    });

    it('renders a side-panel frame with an unpin action', () => {
        const onUnpin = vi.fn();

        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                presentation="side-panel"
                onClose={() => {}}
                onUnpin={onUnpin}
            />,
        );

        expect(screen.getByTestId('commit-chat-side-panel')).toBeTruthy();
        expect(screen.getByTestId('commit-chat-side-panel-header')).toBeTruthy();
        expect(screen.queryByTestId('commit-chat-lens-resize-grip')).toBeNull();
        expect(screen.queryByTestId('commit-chat-pin-btn')).toBeNull();

        fireEvent.click(screen.getByTestId('commit-chat-unpin-btn'));

        expect(onUnpin).toHaveBeenCalledOnce();
    });

    it('sets data-dormant-mode and data-focused attributes on lens', () => {
        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                presentation="lens"
                onClose={() => {}}
            />,
        );

        const lens = screen.getByTestId('commit-chat-lens');
        expect(lens.getAttribute('data-dormant-mode')).toBe('ghost');
        expect(lens.getAttribute('data-focused')).toBe('true');
    });

    it('does not set dormant data attributes on side-panel presentation', () => {
        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                presentation="side-panel"
                onClose={() => {}}
            />,
        );

        const panel = screen.getByTestId('commit-chat-side-panel');
        expect(panel.getAttribute('data-dormant-mode')).toBeNull();
        expect(panel.getAttribute('data-focused')).toBeNull();
    });

    it('transitions to ghost dormant state after mouse moves away and delay elapses', () => {
        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                presentation="lens"
                onClose={() => {}}
            />,
        );

        const lens = screen.getByTestId('commit-chat-lens');
        const card = screen.getByTestId('commit-chat-lens-card');

        expect(lens.getAttribute('data-focused')).toBe('true');
        expect(card.style.opacity).toBe('1');

        act(() => { simulateMouseFarAway(card); });
        act(() => { vi.advanceTimersByTime(700); });

        expect(lens.getAttribute('data-focused')).toBe('false');
        expect(card.style.opacity).toBe('0.18');
        expect(card.style.pointerEvents).toBe('none');
    });

    it('cancels dormant transition when mouse moves back before delay', () => {
        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                presentation="lens"
                onClose={() => {}}
            />,
        );

        const lens = screen.getByTestId('commit-chat-lens');
        const card = screen.getByTestId('commit-chat-lens-card');

        act(() => { simulateMouseFarAway(card); });
        act(() => { vi.advanceTimersByTime(300); });

        act(() => { simulateMouseOnElement(card); });
        act(() => { vi.advanceTimersByTime(500); });

        expect(lens.getAttribute('data-focused')).toBe('true');
    });

    it('shows dormant pill when mode is pill and mouse leaves', () => {
        dormantModeState.value = 'pill';

        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                presentation="lens"
                onClose={() => {}}
            />,
        );

        const lens = screen.getByTestId('commit-chat-lens');
        const card = screen.getByTestId('commit-chat-lens-card');
        expect(lens.getAttribute('data-dormant-mode')).toBe('pill');

        act(() => { simulateMouseFarAway(card); });
        act(() => { vi.advanceTimersByTime(700); });

        const pill = screen.getByTestId('commit-chat-lens-dormant-pill');
        expect(pill.style.opacity).toBe('1');
        expect(pill.style.pointerEvents).toBe('auto');

        expect(card.style.opacity).toBe('0');
        expect(card.style.pointerEvents).toBe('none');
    });

    it('restores from pill dormant when mouse moves over pill', () => {
        dormantModeState.value = 'pill';

        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                presentation="lens"
                onClose={() => {}}
            />,
        );

        const lens = screen.getByTestId('commit-chat-lens');
        const card = screen.getByTestId('commit-chat-lens-card');
        act(() => { simulateMouseFarAway(card); });
        act(() => { vi.advanceTimersByTime(700); });

        expect(lens.getAttribute('data-focused')).toBe('false');

        // When dormant in pill mode, the hit-test target is the pill element.
        // Mock the pill's rect and move the mouse onto it.
        const pill = screen.getByTestId('commit-chat-lens-dormant-pill');
        const pillRect: DOMRect = {
            left: 800, top: 580, right: 920, bottom: 600,
            width: 120, height: 20, x: 800, y: 580, toJSON: () => ({}),
        };
        vi.spyOn(pill, 'getBoundingClientRect').mockReturnValue(pillRect);
        act(() => {
            vi.advanceTimersByTime(30);
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: 850, clientY: 590 }));
        });

        expect(lens.getAttribute('data-focused')).toBe('true');
        expect(card.style.opacity).toBe('1');
    });

    it('stays focused when no mousemove event has been fired', () => {
        dormantModeState.value = 'pill';

        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                presentation="lens"
                onClose={() => {}}
            />,
        );

        const lens = screen.getByTestId('commit-chat-lens');

        act(() => { vi.advanceTimersByTime(2000); });

        expect(lens.getAttribute('data-focused')).toBe('true');
    });

    it('does not render dormant pill in ghost mode', () => {
        dormantModeState.value = 'ghost';

        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                presentation="lens"
                onClose={() => {}}
            />,
        );

        expect(screen.queryByTestId('commit-chat-lens-dormant-pill')).toBeNull();
    });
});
