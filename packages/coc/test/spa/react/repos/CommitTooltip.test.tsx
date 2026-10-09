import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommitTooltip } from '../../../../src/server/spa/client/react/features/git/commits/CommitTooltip';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/commitListTypes';
import { useCommitListGestures, TOOLTIP_SHOW_DELAY_MS, TOOLTIP_HIDE_DELAY_MS } from '../../../../src/server/spa/client/react/features/git/commits/useCommitListGestures';
import { SplitWorkspacePanel } from '../../../../src/server/spa/client/react/features/repo-detail/SplitWorkspacePanel';
import { splitWorkspaceLeftCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';
import { mockViewport } from '../../helpers/viewport-mock';

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

import { copyToClipboard } from '../../../../src/server/spa/client/react/utils/format';

const commit: GitCommitItem = {
    hash: 'a'.repeat(40),
    shortHash: 'aaaaaaaa',
    subject: 'Show commit details in the sidebar',
    author: 'Example Author',
    date: '2026-01-01T00:00:00Z',
    parentHashes: ['b'.repeat(40)],
    body: 'Full commit description',
};
const anchorRect = new DOMRect(40, 300, 280, 24);

function HoverCommit() {
    const gestures = useCommitListGestures({ touchOnly: false });
    return (
        <div>
            <button
                data-testid="hover-commit"
                onMouseEnter={(e) => gestures.handleRowMouseEnter(commit, e)}
                onMouseLeave={gestures.handleRowMouseLeave}
            >
                {commit.shortHash}
            </button>
            {gestures.hoveredCommit && (
                <CommitTooltip
                    commit={gestures.hoveredCommit}
                    anchorRect={gestures.tooltipAnchorRect}
                    onMouseEnter={gestures.handleTooltipMouseEnter}
                    onMouseLeave={gestures.handleTooltipMouseLeave}
                />
            )}
        </div>
    );
}

function renderPanel(collapsed: boolean) {
    localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('ws-tooltip'), collapsed ? '1' : '0');
    return render(
        <SplitWorkspacePanel
            workspaceId="ws-tooltip"
            chatList={<div>Chats</div>}
            gitList={<HoverCommit />}
            detail={<div data-testid="outside-panel">Details</div>}
        />,
    );
}

function openTooltip() {
    fireEvent.mouseEnter(screen.getByTestId('hover-commit'));
    act(() => vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS - 1));
    expect(screen.queryByTestId('commit-tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    return screen.getByTestId('commit-tooltip');
}

describe('CommitTooltip', () => {
    let restoreViewport: () => void;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        localStorage.clear();
        restoreViewport = mockViewport(1280);
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
            return this.getAttribute('data-testid') === 'commit-tooltip'
                ? new DOMRect(0, 0, 480, 160)
                : anchorRect;
        });
    });

    afterEach(() => {
        cleanup();
        restoreViewport();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it.each([false, true])('renders outside the sidebar with viewport coordinates (collapsed: %s)', (collapsed) => {
        const { unmount } = renderPanel(collapsed);
        const panel = screen.getByTestId('split-workspace-left');
        if (collapsed) {
            fireEvent.mouseEnter(screen.getByTestId('split-workspace-left-rail'));
            act(() => vi.advanceTimersByTime(450));
            expect(panel).not.toHaveClass('hidden');
            expect(panel).toHaveClass('overflow-hidden');
            expect(panel.className).toMatch(/translate-x/);
        }

        const tooltip = openTooltip();
        expect(tooltip.parentElement).toBe(document.body);
        expect(panel.contains(tooltip)).toBe(false);
        expect(tooltip).toHaveStyle({ top: '300px', left: '328px' });
        expect(screen.getByTestId('tooltip-subject')).toHaveTextContent(commit.subject);
        expect(screen.getByTestId('tooltip-metadata')).toHaveTextContent(commit.author);
        expect(screen.getByTestId('tooltip-metadata')).toHaveTextContent('bbbbbbb');
        expect(screen.getByTestId('tooltip-body')).toHaveTextContent(commit.body!);

        unmount();
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
    });

    it('keeps the peek and tooltip open while hovering and copying, then dismisses outside', async () => {
        renderPanel(true);
        fireEvent.mouseEnter(screen.getByTestId('split-workspace-left-rail'));
        act(() => vi.advanceTimersByTime(450));
        const row = screen.getByTestId('hover-commit');
        const tooltip = openTooltip();
        const panel = screen.getByTestId('split-workspace-left');

        fireEvent.mouseOut(row, { relatedTarget: tooltip });
        fireEvent.mouseOver(tooltip, { relatedTarget: row });
        act(() => vi.advanceTimersByTime(300));
        expect(screen.getByTestId('commit-tooltip')).toBe(tooltip);
        expect(panel).not.toHaveClass('hidden');

        const copyButton = screen.getByTestId('tooltip-copy-hash-btn');
        fireEvent.mouseDown(copyButton);
        await act(async () => fireEvent.click(copyButton));
        expect(copyToClipboard).toHaveBeenCalledWith(commit.hash);
        expect(copyButton).toHaveTextContent('Copied!');
        expect(panel).not.toHaveClass('hidden');

        fireEvent.mouseOut(tooltip, { relatedTarget: document.body });
        act(() => vi.advanceTimersByTime(300));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
        expect(panel).toHaveClass('hidden');

        fireEvent.mouseEnter(screen.getByTestId('split-workspace-left-rail'));
        act(() => vi.advanceTimersByTime(450));
        openTooltip();
        fireEvent.mouseDown(screen.getByTestId('outside-panel'));
        expect(panel).toHaveClass('hidden');
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
    });

    it('dismisses both the peek and its portaled tooltip on Escape', () => {
        renderPanel(true);
        fireEvent.mouseEnter(screen.getByTestId('split-workspace-left-rail'));
        act(() => vi.advanceTimersByTime(450));
        openTooltip();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.getByTestId('split-workspace-left')).toHaveClass('hidden');
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
    });

    it('cancels a short hover and dismisses after leaving the row without entering the tooltip', () => {
        renderPanel(false);
        const row = screen.getByTestId('hover-commit');
        fireEvent.mouseEnter(row);
        fireEvent.mouseLeave(row);
        act(() => vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();

        openTooltip();
        fireEvent.mouseLeave(row);
        act(() => vi.advanceTimersByTime(TOOLTIP_HIDE_DELAY_MS));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
    });
});
