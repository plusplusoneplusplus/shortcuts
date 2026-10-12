/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplitWorkspacePanel } from '../../../../src/server/spa/client/react/features/repo-detail/SplitWorkspacePanel';
import { splitWorkspaceLeftCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';
import { useContext, useEffect } from 'react';
import { RailJobOpenerContext, type RailJobPreview } from '../../../../src/server/spa/client/react/features/repo-detail/RailJobStatuses';

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

const preview: RailJobPreview = {
    running: [{ id: 'r1', type: 'chat', displayName: 'Active chat', payload: { mode: 'autopilot' } }],
    queued: [{ id: 'q1', type: 'run-script', displayName: 'Waiting script' }],
    scopeLabel: 'Workspace Alpha',
    routeId: 'ws-alpha',
    scopeKey: 'ws-alpha:local',
};

function panel(jobs = preview) {
    return <SplitWorkspacePanel workspaceId="ws-alpha" jobPreview={jobs}
        chatList={<div>Pinned and completed history</div>} gitList={<div>Git</div>} detail={<div>Detail</div>} />;
}
function tick(ms: number) {
    act(() => { vi.advanceTimersByTime(ms); });
}
function hover(status = 'running') {
    fireEvent.pointerEnter(screen.getByTestId(`split-workspace-left-${status}`), { pointerType: 'mouse' });
}

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('ws-alpha'), '1');
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
        readonly pointerType: string;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerType = init.pointerType ?? 'mouse';
        }
    });
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('scoped rail job previews', () => {
    it.each(['running', 'queued'] as const)('renders separate current-mode pills in %s rows, with wrapping metadata', status => {
        const modes = ['ask', 'autopilot', 'ralph', 'sentinel', 'for-each', 'map-reduce'];
        render(panel({ ...preview, [status]: modes.map(mode => ({
            id: mode, type: 'chat', displayName: `Job ${mode}`, executionMode: mode, payload: { mode: 'ask' },
        })) }));
        hover(status);
        tick(200);
        const dialog = within(screen.getByRole('dialog'));
        expect(dialog.getAllByTestId('rail-job-mode').map(pill => pill.textContent?.trim()))
            .toEqual(['Ask', 'Autopilot', 'Ralph', 'Sentinel', 'For Each', 'Map Reduce']);
        for (const pill of dialog.getAllByTestId('rail-job-mode')) {
            expect(pill).toHaveClass('shrink-0', 'whitespace-nowrap', '!rounded-full');
            expect(pill.parentElement).toHaveClass('flex-wrap');
            expect(pill.getAttribute('title')).toMatch(/ mode$/);
            expect(pill.className).toContain('dark:text-');
        }
        expect(dialog.getAllByText(status === 'running' ? 'Thinking' : 'Queued')).toHaveLength(6);
        expect(dialog.queryByText('ask')).toBeNull();
        expect(dialog.getAllByText('Chat')).toHaveLength(6);
    });

    it('recognizes existing Ralph context and normalizes legacy Plan without guessing missing modes', () => {
        render(panel({ ...preview, running: [
            { id: 'grill', type: 'chat', payload: { mode: 'ask', context: { ralph: { sessionId: 'one' } } } },
            { id: 'plan', type: 'chat', payload: { mode: 'plan' } },
        ] }));
        hover();
        tick(200);
        expect(screen.getAllByTestId('rail-job-mode').map(pill => pill.textContent?.trim())).toEqual(['Ralph', 'Ask']);
    });

    it('omits unknown modes and never labels scripts/workflows or queue markers as chat modes', () => {
        render(panel({ ...preview, running: [
            { id: 'unknown', type: 'chat', executionMode: null, payload: { mode: 'autopilot' } },
            { id: 'future', type: 'chat', executionMode: 'future-mode' },
            { id: 'missing', type: 'chat' },
            { id: 'script', type: 'run-script', payload: { mode: 'ask' } },
            { id: 'workflow', type: 'run-workflow', payload: { mode: 'autopilot' } },
            { id: 'pause', kind: 'pause-marker', payload: { mode: 'sentinel' } },
        ] }));
        hover();
        tick(200);
        expect(screen.queryByTestId('rail-job-mode')).toBeNull();
        expect(screen.getByRole('dialog')).toHaveTextContent('Run Script');
        expect(screen.getByRole('dialog')).toHaveTextContent('Run Workflow');
        expect(screen.getByRole('dialog')).not.toHaveTextContent('Autopilot');
    });

    it.each(['remote:server-a:ws-alpha', 'remote:server-a:group-alpha'])('updates mode live without borrowing the owner Sentinel identity on %s', routeId => {
        const jobs = { ...preview, routeId, running: [{ ...preview.running[0], executionMode: 'ask' }] };
        const view = render(panel(jobs));
        hover();
        tick(200);
        expect(screen.getByTestId('rail-job-mode')).toHaveTextContent('Ask');
        view.rerender(panel({ ...jobs, running: [{ ...jobs.running[0], executionMode: 'autopilot' }] }));
        expect(screen.getByTestId('rail-job-mode')).toHaveTextContent('Autopilot');
        expect(screen.getByRole('link', { name: 'Open job: Active chat' }))
            .toHaveAttribute('href', `#repos/${encodeURIComponent(routeId)}/chats/queue_r1`);
        view.rerender(panel({ ...jobs, running: [{ ...jobs.running[0], executionMode: null }] }));
        expect(screen.queryByTestId('rail-job-mode')).toBeNull();
    });

    it('opens only matching jobs after 200ms, never the full sidebar', () => {
        render(panel());
        hover();
        tick(199);
        expect(screen.queryByRole('dialog')).toBeNull();
        tick(1);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveTextContent('Running jobs (1)');
        expect(dialog).toHaveTextContent('Active chat');
        expect(dialog).not.toHaveTextContent('Waiting script');
        expect(dialog).not.toHaveTextContent('Pinned');
        tick(500);
        expect(screen.getByTestId('split-workspace-left')).toHaveClass('hidden');
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('ws-alpha'))).toBe('1');
    });

    it('switches running/queued previews and cancels a pending full-rail peek', () => {
        render(panel());
        fireEvent.mouseEnter(screen.getByTestId('split-workspace-left-rail'));
        hover();
        tick(450);
        expect(screen.getByTestId('split-workspace-left')).toHaveClass('hidden');
        hover('queued');
        tick(200);
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        expect(screen.getByRole('dialog')).toHaveTextContent('Queued jobs (1)');
        expect(screen.getByRole('dialog')).not.toHaveTextContent('Active chat');
        expect(within(screen.getByRole('dialog')).getByText('Queued').parentElement).toHaveClass('text-[#5a5a5a]');
    });

    it('preserves other rail hover, including moving off a count within the rail', () => {
        render(panel());
        hover();
        tick(200);
        fireEvent.pointerLeave(screen.getByTestId('split-workspace-left-running'));
        fireEvent.mouseMove(screen.getByTestId('split-workspace-left-expand'));
        tick(450);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByTestId('split-workspace-left')).not.toHaveClass('hidden');
    });

    it('bridges the gap safely and dismisses after 250ms outside both surfaces', () => {
        render(panel());
        hover();
        tick(200);
        fireEvent.pointerLeave(screen.getByTestId('split-workspace-left-running'));
        tick(200);
        fireEvent.pointerEnter(screen.getByTestId('rail-job-preview-bridge'));
        tick(500);
        expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.pointerLeave(screen.getByTestId('rail-job-preview-bridge'));
        fireEvent.pointerEnter(screen.getByRole('dialog'));
        tick(500);
        expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.pointerLeave(screen.getByRole('dialog'));
        tick(249);
        expect(screen.getByRole('dialog')).toBeTruthy();
        tick(1);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('cancels short hovers and cleans timers on unmount', () => {
        const view = render(panel());
        hover();
        tick(100);
        fireEvent.pointerLeave(screen.getByTestId('split-workspace-left-running'));
        tick(300);
        expect(screen.queryByRole('dialog')).toBeNull();
        hover();
        view.unmount();
        tick(500);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('opens on focus, reaches actions with Tab/arrows and escapes without reopening', async () => {
        vi.useRealTimers();
        const user = userEvent.setup();
        render(panel());
        const trigger = screen.getByTestId('split-workspace-left-running');
        act(() => trigger.focus());
        expect(screen.getByRole('dialog')).toBeTruthy();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Close job preview' })).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('link', { name: 'Open job: Active chat' })).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(trigger).toHaveFocus();
        expect(screen.queryByRole('dialog')).toBeNull();
        vi.useFakeTimers();
        tick(1000);
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.keyDown(trigger, { key: 'ArrowRight' });
        expect(screen.getByRole('button', { name: 'Close job preview' })).toHaveFocus();
    });

    it('keeps focus inside the preview when the pointer leaves, without trapping Tab', async () => {
        vi.useRealTimers();
        const user = userEvent.setup();
        render(panel());
        act(() => screen.getByTestId('split-workspace-left-running').focus());
        await user.keyboard('{ArrowRight}');
        await user.tab();
        expect(screen.getByRole('link')).toHaveFocus();
        vi.useFakeTimers();
        fireEvent.pointerLeave(screen.getByRole('dialog'));
        tick(500);
        expect(screen.getByRole('dialog')).toBeTruthy();
        vi.useRealTimers();
        await user.tab();
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('close restores focus; outside pointer clicks dismiss without stealing focus', () => {
        render(panel());
        hover();
        tick(200);
        fireEvent.click(screen.getByRole('button', { name: 'Close job preview' }));
        expect(screen.getByTestId('split-workspace-left-running')).toHaveFocus();
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.keyDown(screen.getByTestId('split-workspace-left-running'), { key: 'ArrowRight' });
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole('dialog')).toBeNull();
        tick(500);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('permits a deliberate focus after outside dismissal while suppressing restored focus', () => {
        render(panel());
        hover();
        tick(200);
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole('dialog')).toBeNull();
        act(() => screen.getByTestId('split-workspace-left-running').focus());
        expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        act(() => screen.getByTestId('split-workspace-left-expand').focus());
        act(() => screen.getByTestId('split-workspace-left-running').focus());
        expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it.each(['running', 'queued'])('ordinary %s click expands instead of navigating', status => {
        render(panel());
        hover(status);
        tick(200);
        fireEvent.click(screen.getByTestId(`split-workspace-left-${status}`));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('split-workspace-left-rail')).toBeNull();
    });

    it('Enter retains native button expansion', async () => {
        vi.useRealTimers();
        const user = userEvent.setup();
        render(panel());
        act(() => screen.getByTestId('split-workspace-left-running').focus());
        await user.keyboard('{Enter}');
        expect(screen.queryByTestId('split-workspace-left-rail')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('coarse-pointer focus/click expands without requiring a preview affordance', () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false });
        render(panel());
        hover();
        tick(500);
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByTestId('split-workspace-left-running'));
        expect(screen.queryByTestId('split-workspace-left-rail')).toBeNull();
    });

    it('touch on a fine-pointer-capable device does not open a preview before expansion', () => {
        render(panel());
        const trigger = screen.getByTestId('split-workspace-left-running');
        fireEvent.pointerEnter(trigger, { pointerType: 'touch' });
        fireEvent.pointerDown(trigger, { pointerType: 'touch' });
        act(() => trigger.focus());
        tick(500);
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(trigger);
        expect(screen.queryByTestId('split-workspace-left-rail')).toBeNull();
    });

    it('updates rows/counts live, removes the last completed icon, never substitutes history', () => {
        const view = render(panel());
        hover();
        tick(200);
        view.rerender(panel({ ...preview, running: [
            ...preview.running,
            { id: 'r2', type: 'dream-run', displayName: 'Dream job' },
        ] }));
        expect(screen.getByRole('dialog')).toHaveTextContent('Running jobs (2)');
        expect(screen.getByTestId('split-workspace-left-running')).toHaveTextContent('2');
        view.rerender(panel({ ...preview, running: [] }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('split-workspace-left-running')).toBeNull();
        hover('queued');
        tick(200);
        expect(screen.getByRole('dialog')).toHaveTextContent('Waiting script');
        view.rerender(panel({ ...preview, running: preview.queued, queued: [] }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('split-workspace-left-queued')).toBeNull();
        view.rerender(panel({ ...preview, running: [], queued: [] }));
        expect(screen.queryByTestId('split-workspace-left-running')).toBeNull();
    });

    it('does not keep stale keyboard ownership after a focused job row disappears', () => {
        const view = render(panel({ ...preview, running: [...preview.running, { id: 'r2', displayName: 'Remaining job' }] }));
        hover();
        tick(200);
        act(() => screen.getByRole('link', { name: 'Open job: Active chat' }).focus());
        view.rerender(panel({ ...preview, running: [{ id: 'r2', displayName: 'Remaining job' }] }));
        fireEvent.pointerLeave(screen.getByRole('dialog'));
        tick(250);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('retains counted queue markers but never invents a process destination for them', () => {
        render(panel({ ...preview, queued: [...preview.queued, { id: 'pause-one', kind: 'pause-marker' }] }));
        hover('queued');
        tick(200);
        expect(screen.getByRole('dialog')).toHaveTextContent('Queued jobs (2)');
        expect(screen.getByRole('dialog')).toHaveTextContent('Queue pause');
        expect(screen.getAllByRole('link')).toHaveLength(1);
    });

    it('disposes open and pending previews on workspace/server/active-surface changes', () => {
        const view = render(panel());
        hover();
        tick(200);
        view.rerender(panel({ ...preview, scopeKey: 'ws-alpha:remote-a', routeId: 'remote:a:ws-alpha', scopeLabel: 'Remote Alpha' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        hover();
        tick(100);
        view.rerender(panel({ ...preview, scopeKey: 'ws-beta:remote-b' }));
        tick(500);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('uses exact many-job count but keeps 99+ badges and owner-qualified routes', () => {
        render(panel({ ...preview, routeId: 'remote:server-a:ws-alpha', running: Array.from({ length: 123 }, (_, i) => ({
            id: `job-${i}`, type: 'pr-classification', displayName: `Classification ${i}`,
        })) }));
        hover();
        tick(200);
        expect(screen.getByTestId('split-workspace-left-running')).toHaveTextContent('99+');
        expect(screen.getByRole('dialog')).toHaveTextContent('Running jobs (123)');
        expect(screen.getAllByRole('link')).toHaveLength(123);
        const link = screen.getByRole('link', { name: 'Open job: Classification 0' });
        expect(link).toHaveAttribute('href', '#repos/remote%3Aserver-a%3Aws-alpha/chats/queue_job-0');
        fireEvent.click(link);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByTestId('split-workspace-left-rail')).toBeTruthy();
    });
});

/** Stands in for `RepoChatTab`, publishing its selection path to the rail. */
function OpenerChatList({ routeId, open }: { routeId: string; open: (job: any) => void }) {
    const setOpener = useContext(RailJobOpenerContext);
    useEffect(() => {
        const opener = { routeId, open };
        setOpener?.(opener);
        return () => setOpener?.(current => (current === opener ? null : current));
    }, [setOpener, routeId, open]);
    return <div>Chat list</div>;
}

/** Sets the hash without a (jsdom-async) hashchange of its own. */
function setHash(hash: string) {
    window.history.replaceState(null, '', hash);
}

describe('rail Open job selection', () => {
    function openerPanel(routeId: string, open: (job: any) => void, jobs = preview) {
        return <SplitWorkspacePanel workspaceId="ws-alpha" jobPreview={jobs}
            chatList={<OpenerChatList routeId={routeId} open={open} />} gitList={<div>Git</div>} detail={<div>Detail</div>} />;
    }
    function openRunning() {
        hover();
        tick(200);
        return screen.getByRole('link', { name: 'Open job: Active chat' });
    }
    beforeEach(() => { setHash('#repos/ws-alpha/chats/queue_sentinel'); });

    it('selects the job through the chat list on its owning remote route and dismisses', () => {
        const open = vi.fn();
        const routeId = 'remote:server-a:ws-alpha';
        render(openerPanel(routeId, open, { ...preview, routeId }));
        const link = openRunning();
        expect(link).toHaveAttribute('href', '#repos/remote%3Aserver-a%3Aws-alpha/chats/queue_r1');
        const notCanceled = fireEvent.click(link);
        expect(notCanceled).toBe(false);
        expect(open).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledWith(preview.running[0]);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(window.location.hash).toBe('#repos/ws-alpha/chats/queue_sentinel');
    });

    it('opens queued jobs and an already-routed job through the same selection path', () => {
        const open = vi.fn();
        render(openerPanel('ws-alpha', open));
        setHash('#repos/ws-alpha/chats/queue_r1');
        fireEvent.click(openRunning());
        hover('queued');
        tick(200);
        fireEvent.click(screen.getByRole('link', { name: 'Open job: Waiting script' }));
        expect(open.mock.calls.map(([job]) => job.id)).toEqual(['r1', 'q1']);
    });

    it('never hands a job to another route\'s chat list; the owner href navigates instead', () => {
        const open = vi.fn();
        render(openerPanel('ws-alpha', open, { ...preview, routeId: 'remote:server-a:ws-alpha' }));
        expect(fireEvent.click(openRunning())).toBe(true);
        expect(open).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('reapplies the current route when the hash already names the job and no list is mounted', () => {
        render(panel());
        setHash('#repos/ws-alpha/chats/queue_r1');
        const routed = vi.fn();
        window.addEventListener('hashchange', routed);
        try {
            fireEvent.click(openRunning());
            expect(routed).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener('hashchange', routed);
        }
    });

    it('leaves modified clicks to the browser', () => {
        const open = vi.fn();
        render(openerPanel('ws-alpha', open));
        expect(fireEvent.click(openRunning(), { ctrlKey: true })).toBe(true);
        expect(open).not.toHaveBeenCalled();
    });

    it('clears the published opener when the chat list unmounts', () => {
        const open = vi.fn();
        const view = render(openerPanel('ws-alpha', open));
        view.rerender(panel());
        expect(fireEvent.click(openRunning())).toBe(true);
        expect(open).not.toHaveBeenCalled();
    });
});
