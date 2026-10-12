/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SentinelTodoJobLink } from '@plusplusoneplusplus/coc-client';
const { getProcess, getGroup, refs } = vi.hoisted(() => ({ getProcess: vi.fn(), getGroup: vi.fn(), refs: [] as unknown[] }));
const client = { processes: { get: getProcess }, taskGroups: { get: getGroup } };
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: (ref: unknown) => { refs.push(ref); return client; } }));
import { SentinelTodoJobPreview } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoJobPreview';
import { registerCloneBaseUrls } from '../../../src/server/spa/client/react/repos/cloneRegistry';
const owner = { ownerWorkspaceId: 'parent', processId: 'sentinel', ownerRoutingRef: null };
const follow = vi.fn();
function job(overrides: Partial<SentinelTodoJobLink> = {}): SentinelTodoJobLink {
    return { processId: 'job1', workspaceId: 'repo1', kind: 'local', title: 'Fix selection', openLink: '#repos/repo1/chats/job1', linkedAt: new Date().toISOString(), execution: { state: 'running' }, ...overrides };
}
function mount(value = job()) { return render(<SentinelTodoJobPreview job={value} owner={owner} linkKey="job-key" onFollowLink={follow} />); }
function focus() { act(() => screen.getByRole('link', { name: 'Fix selection' }).focus()); }
beforeEach(() => {
    vi.clearAllMocks(); registerCloneBaseUrls([]); refs.length = 0;
    getProcess.mockResolvedValue({ process: { id: 'job1', workspaceId: 'repo1', jobPreview: { excerpt: 'Verifying focus after refresh', source: 'progress', updatedAt: new Date().toISOString() } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('To-do job previews', () => {
    it.each((['ask', 'autopilot', 'ralph'] as const).flatMap(mode =>
        (['queued', 'running', 'completed'] as const).map(state => ({ mode, state }))))(
        'renders $mode for $state without extra metadata reads or focus targets', ({ mode, state }) => {
        mount(job({ mode, execution: { state } }));
        const badge = screen.getByTestId('sentinel-todo-job-mode');
        expect(badge.textContent).toBe(mode === 'ask' ? 'Ask' : mode === 'ralph' ? 'Ralph' : 'Autopilot');
        expect(badge.tagName).toBe('SPAN'); expect(badge.getAttribute('tabindex')).toBeNull();
        expect(getProcess).not.toHaveBeenCalled(); expect(getGroup).not.toHaveBeenCalled();
    });
    it.each([undefined, 'future-mode'])('omits unknown local mode %s without defaulting to Autopilot', mode => {
        mount(job({ mode: mode as SentinelTodoJobLink['mode'] }));
        expect(screen.queryByTestId('sentinel-todo-job-mode')).toBeNull();
        expect(getProcess).not.toHaveBeenCalled();
    });
    it('omits unknown modes and does not infer from job title or remote status', () => {
        mount(job({ kind: 'remote', serverId: 'offline', title: 'Autopilot job', execution: { state: 'unavailable' } }));
        expect(screen.queryByTestId('sentinel-todo-job-mode')).toBeNull();
        expect(getProcess).not.toHaveBeenCalled(); expect(getGroup).not.toHaveBeenCalled();
    });
    it('renders exactly one Ralph pill when session identity and current mode differ', () => {
        mount(job({ kind: 'remote', serverId: 'srv-2', sessionId: 'session-1', mode: 'ask' }));
        expect(screen.getAllByTestId('sentinel-todo-job-mode')).toHaveLength(1);
        expect(screen.getByTestId('sentinel-todo-job-mode').textContent).toBe('Ralph');
    });

    it('reads lazily, bounds content, excludes transcripts, caches and preserves anchors/modifier clicks', async () => {
        getProcess.mockResolvedValue({ process: { id: 'job1', workspaceId: 'repo1', jobPreview: { excerpt: 'x'.repeat(2000), source: 'result' } } });
        mount(); expect(getProcess).not.toHaveBeenCalled(); focus();
        const panel = await screen.findByRole('dialog');
        await within(panel).findByText('x'.repeat(800));
        expect(getProcess).toHaveBeenCalledWith('job1', { workspace: 'repo1', exclude: ['conversation', 'toolCalls'], preview: true }, { signal: expect.any(AbortSignal) });
        fireEvent.click(within(panel).getByRole('button', { name: 'Close job preview' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('link')).toHaveFocus();
        fireEvent.blur(screen.getByRole('link')); focus();
        expect(getProcess).toHaveBeenCalledTimes(1);
        const anchor = screen.getByRole('link', { name: 'Fix selection' });
        expect(anchor.getAttribute('href')).toBe('#repos/repo1/chats/job1');
        fireEvent.click(anchor, { ctrlKey: true });
        expect(follow.mock.calls[0][0].ctrlKey).toBe(true);
        expect(follow.mock.calls[0][1]).toBe('job-key');
    });
    it('opens after 200ms with a 250ms pointer bridge', async () => {
        vi.useFakeTimers(); mount();
        const anchor = screen.getByRole('link').parentElement!;
        fireEvent.pointerEnter(anchor, { pointerType: 'mouse' });
        await act(async () => vi.advanceTimersByTime(199)); expect(screen.queryByRole('dialog')).toBeNull();
        await act(async () => vi.advanceTimersByTime(1)); expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.pointerLeave(anchor);
        await act(async () => vi.advanceTimersByTime(249)); expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.pointerEnter(screen.getByRole('dialog'), { pointerType: 'mouse' });
        await act(async () => vi.advanceTimersByTime(2)); expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.pointerLeave(screen.getByRole('dialog'));
        await act(async () => vi.advanceTimersByTime(250)); expect(screen.queryByRole('dialog')).toBeNull();
    });
    it('touch info is persistent; Escape/Close restore focus without reopening; outside dismisses', async () => {
        mount();
        const info = screen.getByRole('button', { name: 'Preview job: Fix selection' });
        fireEvent.pointerEnter(info.parentElement!, { pointerType: 'touch' }); expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(info); await screen.findByRole('dialog');
        expect(screen.getByRole('button', { name: 'Close job preview' })).toHaveFocus();
        fireEvent.pointerLeave(screen.getByRole('dialog'));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(info).toHaveFocus(); expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(info); expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.pointerDown(document.body); expect(screen.queryByRole('dialog')).toBeNull();
    });
    it('ArrowDown enters actions, Shift+Tab returns, and focus departure dismisses persistent previews', async () => {
        mount(); focus(); await screen.findByRole('dialog');
        fireEvent.keyDown(screen.getByRole('link', { name: 'Fix selection' }), { key: 'ArrowDown' });
        expect(screen.getByRole('button', { name: 'Close job preview' })).toHaveFocus();
        fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
        expect(screen.getByRole('link')).toHaveFocus(); expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Preview job: Fix selection' }));
        fireEvent.blur(screen.getByRole('button', { name: 'Close job preview' }), { relatedTarget: document.body });
        expect(screen.queryByRole('dialog')).toBeNull();
    });
    it('shows loading, queued-empty, recorded result and independent review without writes', async () => {
        let resolve!: (data: unknown) => void;
        getProcess.mockReturnValue(new Promise(r => { resolve = r; }));
        const view = mount(job({ execution: { state: 'queued' } })); focus();
        expect(screen.getByText('Loading job preview from its owner…')).toBeTruthy();
        await act(async () => resolve({ process: { id: 'job1', workspaceId: 'repo1', jobPreview: { excerpt: '', source: 'empty' } } }));
        expect(screen.getByText('No progress yet. Waiting for execution.')).toBeTruthy();
        getProcess.mockResolvedValue({ process: { id: 'job1', workspaceId: 'repo1', jobPreview: { excerpt: '', source: 'empty' } } });
        view.rerender(<SentinelTodoJobPreview job={job({ execution: { state: 'completed', reason: 'All checks passed', review: { state: 'queued', assessment: 'pending' } } })} owner={owner} linkKey="job-key" onFollowLink={follow} />);
        await screen.findByText('Recorded result: All checks passed');
        expect(screen.getByText('Review pending')).toBeTruthy();
        expect(screen.getByText('Job completion and review do not mark this item Done.')).toBeTruthy();
        expect(getProcess).toHaveBeenCalledTimes(2);
    });
    it('uses whole Ralph summary even when a child iteration completed', async () => {
        getGroup.mockResolvedValue({ workspaceId: 'repo1', groupId: 'session', type: 'ralph', status: 'running', updatedAt: new Date().toISOString(), children: [{ status: 'completed' }], extra: { currentIteration: 3, maxIterations: 10, detailStatus: 'executing' } });
        mount(job({ kind: 'ralph', sessionId: 'session' })); focus();
        await screen.findByText('Iteration 3 of 10 · executing');
        expect(screen.getByText('Running · Ralph session')).toBeTruthy(); expect(getProcess).not.toHaveBeenCalled();
        expect(getGroup).toHaveBeenCalledWith('repo1', 'session', { signal: expect.any(AbortSignal) });
    });
    it('never fetches an unresolved owner locally; keeps stored external navigation', async () => {
        mount(job({ kind: 'remote', serverId: 'offline', openLink: 'https://owner.example/#repos/repo1/chats/job1' })); focus();
        expect(screen.getByText(/Preview unavailable: owning server/)).toBeTruthy(); expect(getProcess).not.toHaveBeenCalled();
        const open = screen.getByRole('link', { name: 'Open job ↗' });
        expect(open.getAttribute('target')).toBe('_blank'); expect(open.getAttribute('rel')).toBe('noopener noreferrer');
        expect(open.getAttribute('href')).toContain('owner.example');
    });
    it('uses concrete remote identity and preserves navigation after read errors', async () => {
        registerCloneBaseUrls([{ workspaceId: 'repo1', serverId: 'host', baseUrl: 'https://owner.example' }]);
        getProcess.mockRejectedValue(new Error('Offline'));
        mount(job({ kind: 'remote', serverId: 'host', openLink: 'https://owner.example/#repos/repo1/chats/job1' })); focus();
        await screen.findByText(/Preview error: Offline/); expect(refs).toContain('remote:host:repo1');
        expect(screen.getByRole('link', { name: 'Open job ↗' })).toBeTruthy();
    });
    it('rejects wrong-owner data and prevents an unknown remote hash from redirecting locally', async () => {
        const view = mount(job({ kind: 'remote', serverId: 'unknown' }));
        expect(screen.getByText('Fix selection').getAttribute('href')).toBeNull();
        view.unmount(); getProcess.mockResolvedValue({ process: { id: 'job1', workspaceId: 'other', lastMessagePreview: 'Private other job' } });
        mount(); focus(); await screen.findByText(/Owner returned a different job/);
        expect(screen.queryByText('Private other job')).toBeNull();
    });
    it('aborts on dismissal/unmount and ignores old results after job changes', async () => {
        let resolve!: (data: unknown) => void;
        getProcess.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const view = mount(); focus();
        const signal = getProcess.mock.calls[0][2].signal;
        view.rerender(<SentinelTodoJobPreview key="other-owner" job={job({ processId: 'job2' })} owner={{ ...owner, ownerWorkspaceId: 'other' }} linkKey="other" onFollowLink={follow} />);
        expect(signal.aborted).toBe(true);
        await act(async () => resolve({ process: { id: 'job1', lastMessagePreview: 'Stale result' } }));
        expect(screen.queryByText('Stale result')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
    });
    it('keeps one preview open and enters an already-hovered preview through info', async () => {
        mount(); focus(); await screen.findByText('Verifying focus after refresh');
        fireEvent.click(screen.getByRole('button', { name: 'Preview job: Fix selection' }));
        expect(screen.getByRole('button', { name: 'Close job preview' })).toHaveFocus();
        render(<SentinelTodoJobPreview job={job({ title: 'Other job' })} owner={owner} linkKey="other" onFollowLink={follow} />);
        fireEvent.click(screen.getByRole('button', { name: 'Preview job: Other job' }));
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        expect(within(screen.getByRole('dialog')).getByRole('heading').textContent).toBe('Other job');
    });
    it('reports unsupported owners without fabricating progress from user requests', async () => {
        getProcess.mockResolvedValue({ process: { id: 'job1', workspaceId: 'repo1', lastMessagePreview: 'Please fix selection' } });
        mount(); focus(); await screen.findByText(/Preview unavailable: Compact job preview unsupported/);
        expect(screen.queryByText('Please fix selection')).toBeNull();
        expect(screen.getByRole('link', { name: 'Open job ↗' })).toBeTruthy();
    });
    it('bounds slow owner reads and cancels them', async () => {
        vi.useFakeTimers(); getProcess.mockReturnValue(new Promise(() => {}));
        mount(); focus(); const signal = getProcess.mock.calls[0][2].signal;
        await act(async () => vi.advanceTimersByTime(8000));
        expect(signal.aborted).toBe(true); expect(screen.getByText(/Owner read timed out/)).toBeTruthy();
    });
    it('labels stale cached excerpts explicitly when refreshing fails', async () => {
        mount(); focus(); await screen.findByText('Verifying focus after refresh');
        fireEvent.click(screen.getByRole('button', { name: 'Close job preview' }));
        const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 16000);
        getProcess.mockRejectedValue(new Error('Offline'));
        fireEvent.click(screen.getByRole('button', { name: 'Preview job: Fix selection' }));
        await screen.findByText(/Preview error: Offline/);
        expect(screen.getByText(/Stale · Latest recorded assistant response/)).toBeTruthy();
        expect(screen.getByText('Verifying focus after refresh')).toBeTruthy(); vi.restoreAllMocks();
    });
});
