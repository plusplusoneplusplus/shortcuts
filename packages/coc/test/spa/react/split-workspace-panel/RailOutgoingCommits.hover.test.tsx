/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CocClient, GitCommit, GitInfoResponse } from '@plusplusoneplusplus/coc-client';
import { RailOutgoingCommits } from '../../../../src/server/spa/client/react/features/repo-detail/RailOutgoingCommits';
import { RailHoverPreview } from '../../../../src/server/spa/client/react/features/repo-detail/RailHoverPreview';
import { TOOLTIP_SHOW_DELAY_MS, TOOLTIP_HIDE_DELAY_MS } from '../../../../src/server/spa/client/react/features/git/commits/useCommitListGestures';
import { copyToClipboard } from '../../../../src/server/spa/client/react/utils/format';

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({ copyToClipboard: vi.fn().mockResolvedValue(undefined) }));
const commit: GitCommit = {
    hash: 'a'.repeat(40), shortHash: 'aaaaaaaa', subject: 'Outgoing subject', body: 'Full description',
    author: 'Owner author', authorEmail: 'owner@example.test', date: '2026-10-01T12:00:00Z', parentHashes: ['b'.repeat(40)],
};
const info: GitInfoResponse = { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, isGitRepo: true, dirty: false, remoteUrl: null };
function setup(history: GitCommit[] = [commit]) {
    const listCommits = vi.fn().mockResolvedValue({ commits: history, unpushedCount: history.length });
    const client = { options: { baseUrl: 'https://owner.example' }, git: { listCommits, getCommit: vi.fn() } };
    const onOpen = vi.fn();
    const props = { workspaceId: 'member', routingRef: 'remote:owner:group-preview', client: client as unknown as CocClient,
        info: { ...info, ahead: history.length }, readAt: 1, loading: false, failed: false, onOpen, onRetry: vi.fn() };
    const view = render(<><button>Outside</button><RailHoverPreview hoverEnabled onExpand={vi.fn()} onPreview={vi.fn()} scopeLabel="Owner"
        controls={[{ key: 'sync', count: 1, label: 'Sync', heading: 'Sync status', className: '', badgeClassName: '', icon: null,
            renderRows: dismiss => <li><RailOutgoingCommits {...props} onOpen={value => { dismiss(); onOpen(value); }} /></li> }]} /></>);
    return { ...view, props, client, listCommits, onOpen };
}
async function openPopup() {
    act(() => screen.getByRole('button', { name: 'Sync' }).focus());
    await act(async () => {});
    return screen.getByRole('button', { name: /^Open commit/ });
}
function show(row: HTMLElement, focus = false) {
    if (focus) act(() => row.focus());
    else fireEvent.mouseEnter(row);
    act(() => vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS - 1));
    expect(screen.queryByTestId('commit-tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    return screen.getByTestId('commit-tooltip');
}
beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
        return this.getAttribute('data-testid') === 'commit-tooltip' ? new DOMRect(0, 0, 480, 280) : new DOMRect(20, 700, 300, 24);
    });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('outgoing commit info in Sync preview', () => {
    it('shares fixup and target metadata from the loaded outgoing history', async () => {
        const fixup = { ...commit, hash: 'c'.repeat(40), shortHash: 'cccccccc', subject: `fixup! ${commit.subject}` };
        setup([fixup, commit]);
        act(() => screen.getByRole('button', { name: 'Sync' }).focus());
        await act(async () => {});
        const row = screen.getByRole('button', { name: `Open commit ${fixup.shortHash}: ${fixup.subject}` });
        show(row);
        expect(screen.getByTestId('tooltip-fixup-info')).toHaveTextContent(commit.hash.substring(0, 7));
        expect(screen.getByTestId('tooltip-fixup-info')).toHaveTextContent(commit.subject);
        fireEvent.mouseLeave(row);
        act(() => vi.advanceTimersByTime(TOOLTIP_HIDE_DELAY_MS));
        show(screen.getByRole('button', { name: `Open commit ${commit.shortHash}: ${commit.subject}` }));
        expect(screen.getByTestId('tooltip-fixup-target-info')).toHaveTextContent(fixup.hash.substring(0, 7));
    });

    it('shares delay, content and Copy action; pointer transit keeps both portals alive', async () => {
        const { client, listCommits, onOpen } = setup();
        const row = await openPopup();
        fireEvent.mouseEnter(row);
        fireEvent.mouseLeave(row);
        act(() => vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
        const panel = show(row);
        expect(panel.parentElement).toBe(document.body);
        expect(screen.getByRole('dialog')).not.toContainElement(panel);
        expect(panel).toHaveClass('fixed', 'z-[10003]');
        expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(8);
        expect(Number.parseFloat(panel.style.left)).toBeGreaterThanOrEqual(8);
        expect(panel).toHaveTextContent('Owner author');
        expect(panel).toHaveTextContent('owner@example.test');
        expect(panel).toHaveTextContent('bbbbbbb');
        expect(panel).toHaveTextContent('Full description');
        expect(row).not.toHaveAttribute('title');
        fireEvent.mouseOut(row, { relatedTarget: panel });
        fireEvent.mouseOver(panel, { relatedTarget: row });
        act(() => vi.advanceTimersByTime(1000));
        const copy = screen.getByTestId('tooltip-copy-hash-btn');
        fireEvent.pointerDown(copy);
        fireEvent.mouseDown(copy);
        await act(async () => fireEvent.click(copy));
        expect(copyToClipboard).toHaveBeenCalledWith(commit.hash);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(onOpen).not.toHaveBeenCalled();
        expect(listCommits).toHaveBeenCalledExactlyOnceWith('member', { limit: 50, skip: undefined, refresh: true });
        expect(client.git.getCommit).not.toHaveBeenCalled();
        fireEvent.mouseOut(panel, { relatedTarget: document.body });
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
    });

    it('retains keyboard focus in the info panel and row activation dismisses both', async () => {
        const { onOpen } = setup();
        const row = await openPopup();
        const panel = show(row, true);
        const copy = screen.getByTestId('tooltip-copy-hash-btn');
        act(() => copy.focus());
        fireEvent.pointerLeave(panel);
        fireEvent.mouseLeave(panel);
        act(() => vi.advanceTimersByTime(1000));
        expect(copy).toHaveFocus();
        expect(screen.getByTestId('commit-tooltip')).toBe(panel);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        act(() => row.focus());
        fireEvent.click(row);
        expect(onOpen).toHaveBeenCalledExactlyOnceWith(commit);
        act(() => vi.advanceTimersByTime(2000));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
    });

    it('allows pointer transit across the gap without keyboard focus holding the Sync popup open', async () => {
        setup();
        fireEvent.pointerEnter(screen.getByRole('button', { name: 'Sync' }), { pointerType: 'mouse' });
        await act(async () => vi.advanceTimersByTimeAsync(200));
        const row = screen.getByRole('button', { name: /^Open commit/ });
        const panel = show(row);
        expect(document.activeElement).toBe(document.body);
        fireEvent.mouseLeave(row);
        fireEvent.pointerLeave(screen.getByRole('dialog'));
        act(() => vi.advanceTimersByTime(TOOLTIP_HIDE_DELAY_MS - 1));
        fireEvent.pointerEnter(panel);
        fireEvent.mouseEnter(panel);
        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByTestId('commit-tooltip')).toBe(panel);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.pointerLeave(panel);
        fireEvent.mouseLeave(panel);
        act(() => vi.advanceTimersByTime(250));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('cancels overlapping blur and mouse-leave timers when Copy receives focus', async () => {
        setup();
        const row = await openPopup();
        const panel = show(row, true);
        act(() => screen.getByText('Outside').focus());
        act(() => vi.advanceTimersByTime(50));
        fireEvent.mouseLeave(row);
        act(() => screen.getByTestId('tooltip-copy-hash-btn').focus());
        fireEvent.mouseEnter(panel);
        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByTestId('commit-tooltip')).toBe(panel);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('drops focus ownership when scrolling removes the focused Copy control', async () => {
        setup();
        const row = await openPopup();
        show(row, true);
        act(() => screen.getByTestId('tooltip-copy-hash-btn').focus());
        fireEvent.scroll(screen.getByTestId('rail-outgoing-list'));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
        expect(document.activeElement).toBe(document.body);
        show(row);
        fireEvent.mouseLeave(row);
        act(() => vi.advanceTimersByTime(TOOLTIP_HIDE_DELAY_MS));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
        fireEvent.pointerLeave(screen.getByRole('dialog'));
        act(() => vi.advanceTimersByTime(250));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each((['Escape', 'outside', 'touch', 'close'] as const).flatMap(mode => [false, true].map(visible => ({ mode, visible }))))(
        'dismisses pending and visible info: %j', async ({ mode, visible }) => {
        setup();
        const row = await openPopup();
        if (visible) show(row);
        else fireEvent.mouseEnter(row);
        if (mode === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
        if (mode === 'outside') fireEvent.pointerDown(screen.getByText('Outside'));
        if (mode === 'touch') fireEvent.touchStart(screen.getByText('Outside'));
        if (mode === 'close') fireEvent.click(screen.getByRole('button', { name: 'Close job preview' }));
        act(() => vi.advanceTimersByTime(2000));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
        if (mode === 'Escape' || mode === 'close') expect(screen.getByRole('button', { name: 'Sync' })).toHaveFocus();
    });

    it('dismisses on blur, history scroll and owner changes without delayed resurrection', async () => {
        const { rerender, props } = setup();
        const row = await openPopup();
        show(row, true);
        act(() => screen.getByText('Outside').focus());
        act(() => vi.advanceTimersByTime(TOOLTIP_HIDE_DELAY_MS));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
        show(row, true);
        fireEvent.scroll(screen.getByTestId('rail-outgoing-list'));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
        fireEvent.mouseEnter(row);
        rerender(<RailOutgoingCommits {...props} routingRef="remote:other:member" readAt={2} />);
        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
    });

    it.each((['clone', 'server', 'workspace', 'branch', 'upstream', 'ahead', 'behind', 'readAt'] as const)
        .flatMap(change => [false, true].map(visible => ({ change, visible }))))(
        'revokes tooltip work when its history identity changes: %j', async ({ change, visible }) => {
        const initial = setup();
        initial.unmount();
        const props = initial.props;
        const view = render(<RailOutgoingCommits {...props} />);
        await act(async () => {});
        const row = screen.getByRole('button', { name: /^Open commit/ });
        if (visible) {
            show(row);
            fireEvent.mouseLeave(row);
        }
        else fireEvent.mouseEnter(row);
        expect(vi.getTimerCount()).toBe(1);
        const nextClient = { ...initial.client, options: { baseUrl: 'https://other.example' } } as unknown as CocClient;
        view.rerender(<RailOutgoingCommits {...props}
            routingRef={change === 'clone' ? 'remote:other:member' : props.routingRef}
            client={change === 'server' ? nextClient : props.client}
            workspaceId={change === 'workspace' ? 'other-member' : props.workspaceId}
            readAt={change === 'readAt' ? 2 : props.readAt}
            info={{ ...props.info,
                ...(change === 'branch' ? { branch: 'topic' } : {}),
                ...(change === 'upstream' ? { upstream: 'origin/topic' } : {}),
                ...(change === 'ahead' ? { ahead: 2 } : {}),
                ...(change === 'behind' ? { behind: 2 } : {}),
            }} />);
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(screen.queryByTestId('commit-tooltip')).toBeNull();
    });
});
