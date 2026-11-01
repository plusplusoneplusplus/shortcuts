import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserDemoStrip } from '../../../../src/server/spa/client/react/shared/file-path/BrowserDemoStrip';
import {
    getBrowserDemoForOwner, isBrowserDemoCapturingChat, isBrowserDemoChatInView, resetBrowserDemosForTest, runBrowserDemoCommand, setBrowserDemoViewingChat,
} from '../../../../src/server/spa/client/react/shared/file-path/browser-demo';
import type { BrowserDemoCommandResult, BrowserDemoState } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';
import { getBrowserDemoEdits, setBrowserDemoEdits } from '../../../../src/server/spa/client/react/shared/file-path/browser-demo-review';

const mock = vi.hoisted(() => ({
    flag: true,
    hasDemo: true,
    command: vi.fn(),
    listeners: [] as Array<(state: unknown) => void>,
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', () => {
    // Like the preload bridge, the demo API is one stable object.
    const demo = {
        supported: true,
        command: (command: unknown) => mock.command(command),
        onState: (callback: (state: unknown) => void) => { mock.listeners.push(callback); return () => { mock.listeners = mock.listeners.filter(c => c !== callback); }; },
    };
    return { desktopBrowserBridge: () => ({ demo: mock.hasDemo ? demo : undefined }) };
});
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({ isBrowserDemoRecordingEnabled: () => mock.flag }));

const owner = { workspaceId: 'w', processId: 'chat-1', routingRef: 'clone:w' };
const state = (patch: Partial<BrowserDemoState> = {}): BrowserDemoState => ({
    id: 'demo-1', owner, status: 'recording', stepCount: 0, tabCount: 1, viewIds: ['one'], incomplete: false, ...patch,
});
const push = (value: BrowserDemoState) => act(() => { for (const listener of mock.listeners) listener(value); });
const mount = (props: Partial<Parameters<typeof BrowserDemoStrip>[0]> = {}) =>
    render(<BrowserDemoStrip workspaceId="w" processId="chat-1" routingRef="clone:w" viewId="one" ready {...props} />);

beforeEach(() => {
    mock.flag = true;
    mock.hasDemo = true;
    mock.listeners = [];
    mock.command.mockReset().mockImplementation(async (command: { action: string }) => command.action === 'list' ? { ok: true, drafts: [] } : { ok: true });
    setBrowserDemoViewingChat(owner);
});
afterEach(() => { cleanup(); resetBrowserDemosForTest(); });

describe('browser demo record controls', () => {
    it('recovers a stopped demo from another tab without adding unrelated pages', () => {
        const onReview = vi.fn();
        mount({ viewId: 'new-tab', onReview });
        push(state({ status: 'stopped', viewIds: [] }));
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ id: 'demo-1' }));
        expect(mock.command.mock.calls.map(([command]) => command.action)).not.toContain('add-tab');
        cleanup();
        mount({ viewId: 'new-tab', processId: 'other-chat' });
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    });

    it.each(['discard', 'sent'] as const)('deletes review annotations when %s happens outside the review dialog', async action => {
        mount();
        push(state({ status: 'stopped' }));
        setBrowserDemoEdits('demo-1', { removed: [1], notes: { 2: 'Example explanation' }, examples: {}, message: 'Explain' });
        await runBrowserDemoCommand({ action, id: 'demo-1' });
        expect(getBrowserDemoEdits('demo-1')).toEqual({ removed: [], notes: {}, examples: {}, message: '' });
    });

    it('deletes annotations when the owning desktop reports that a demo ended', () => {
        mount();
        push(state({ status: 'stopped' }));
        setBrowserDemoEdits('demo-1', { removed: [], notes: { 2: 'Example explanation' }, examples: {}, message: 'Explain' });
        push(state({ ended: 'discarded' }));
        expect(getBrowserDemoEdits('demo-1').notes).toEqual({});
    });

    it.each(['recording', 'paused', 'stopped'] as const)('warns before unloading an unsent %s demo and clears the guard on discard', async status => {
        mount();
        push(state({ status }));
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await runBrowserDemoCommand({ action: 'discard', id: 'demo-1' });
        const cleared = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(cleared);
        expect(cleared.defaultPrevented).toBe(false);
    });

    it('removes the unload guard on Send and keeps warnings after panel unmount', async () => {
        const view = mount();
        push(state({ status: 'stopped' }));
        view.unmount();
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await runBrowserDemoCommand({ action: 'sent', id: 'demo-1' });
        const cleared = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(cleared);
        expect(cleared.defaultPrevented).toBe(false);
    });

    it('starts a recording for the exact tab owner and shows the recording indicator', async () => {
        mock.command.mockImplementation(async (command: { action: string }) => command.action === 'start' ? { ok: true, state: state() } : { ok: true, drafts: [] });
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Record demo' }));
        await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ action: 'start', owner, viewId: 'one' }));
        expect(await screen.findByText('Recording demo · 0 steps · 1 tab')).toBeTruthy();
        expect(screen.getByTestId('browser-demo-strip').dataset.status).toBe('recording');
        expect(isBrowserDemoCapturingChat(owner)).toBe(true);
        expect(isBrowserDemoCapturingChat({ ...owner, processId: 'queue_chat-1' })).toBe(true);
        expect(isBrowserDemoCapturingChat({ ...owner, processId: 'chat-2' })).toBe(false);
        expect(getBrowserDemoForOwner({ ...owner, processId: 'queue_chat-1' })?.id).toBe('demo-1');
    });

    it('stays hidden when the setting is off and no recording exists', () => {
        mock.flag = false;
        const { container } = mount();
        expect(container.textContent).toBe('');
        expect(mock.command.mock.calls.filter(([command]) => command.action !== 'list')).toEqual([]);
    });

    it('keeps a running recording controllable after the setting turns off', () => {
        mock.flag = false;
        mount();
        push(state({ stepCount: 2 }));
        expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    });

    it('disables Record with a reason when there is no chat, no page, or an unreviewed demo', () => {
        mount({ processId: null });
        expect((screen.getByRole('button', { name: 'Record demo' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Record demo' }).title).toBe('Open a chat to record a demo.');
        cleanup();
        mount({ ready: false });
        expect(screen.getByRole('button', { name: 'Record demo' }).title).toBe('Open a web page to record a demo.');
        cleanup();
        mount({ viewId: 'two' });
        push(state({ status: 'stopped', viewIds: ['one'] }));
        expect(screen.getByText('Demo ready to review · 0 steps · 1 tab')).toBeTruthy();
    });

    it('reports an older desktop explicitly instead of hiding the feature', () => {
        mock.hasDemo = false;
        mount();
        expect(screen.getByRole('status').textContent).toBe('Demo recording is unavailable in this desktop version.');
        expect((screen.getByRole('button', { name: 'Record demo' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows an unsupported engine as unavailable, never as a silent no-op', async () => {
        mock.command.mockImplementation(async (command: { action: string }) => command.action === 'start'
            ? { ok: false, reason: 'engine-unsupported', message: 'This tab cannot run the demo recorder.' } : { ok: true, drafts: [] });
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Record demo' }));
        expect((await screen.findByRole('alert')).textContent).toBe('Demo recording is unavailable in this browser engine: This tab cannot run the demo recorder.');
        expect(screen.queryByTestId('browser-demo-strip')).toBeNull();
    });

    it('pauses, resumes and stops through owner-checked commands', async () => {
        const onReview = vi.fn();
        mock.command.mockImplementation(async (command: { action: string }) => ({
            ok: true,
            ...(command.action === 'pause' ? { state: state({ status: 'paused', pauseReason: 'user' }) } : {}),
            ...(command.action === 'resume' ? { state: state() } : {}),
            ...(command.action === 'list' ? { drafts: [] } : {}),
        }));
        mount({ onReview });
        push(state({ stepCount: 3, tabCount: 2 }));
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        expect(await screen.findByText('Paused · 0 steps · 1 tab')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        await screen.findByRole('button', { name: 'Pause' });
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ action: 'stop', id: 'demo-1' }));
        await waitFor(() => expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ id: 'demo-1' })));
    });

    it('names scope and disconnect pauses', () => {
        mount();
        push(state({ status: 'paused', pauseReason: 'scope' }));
        expect(screen.getByRole('status').textContent).toContain('open this chat to continue');
        push(state({ status: 'paused', pauseReason: 'disconnected' }));
        expect(screen.getByRole('status').textContent).toContain('server disconnected');
    });

    it('confirms Discard before deleting the draft', async () => {
        mount();
        push(state({ status: 'stopped', stepCount: 4 }));
        expect(screen.getByRole('status').textContent).toBe('Demo ready to review · 4 steps · 1 tab');
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
        expect(mock.command).not.toHaveBeenCalledWith({ action: 'discard', id: 'demo-1' });
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        expect(screen.getByText(/cannot be recovered/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Discard demo' }));
        await waitFor(() => expect(screen.queryByTestId('browser-demo-strip')).toBeNull());
        expect(getBrowserDemoForOwner(owner)).toBeNull();
    });

    it('offers Add to recording on an unrelated tab of the recording chat only', async () => {
        mount({ viewId: 'two' });
        push(state());
        fireEvent.click(screen.getByRole('button', { name: 'Add to recording' }));
        await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ action: 'add-tab', id: 'demo-1', viewId: 'two' }));
        cleanup();
        mount({ viewId: 'two', processId: 'chat-2' });
        expect(screen.queryByRole('button', { name: 'Add to recording' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Record demo' })).toBeTruthy();
    });

    it('isolates tabs by routing scope', () => {
        mount({ routingRef: 'other' });
        push(state());
        expect(screen.queryByTestId('browser-demo-strip')).toBeNull();
    });

    it('rehydrates live drafts after a remount and drops ended ones', async () => {
        mock.command.mockImplementation(async (command: { action: string }) => command.action === 'list' ? { ok: true, drafts: [state({ stepCount: 5 })] } : { ok: true });
        mount();
        expect(await screen.findByText('Recording demo · 5 steps · 1 tab')).toBeTruthy();
        push(state({ ended: 'sent' }));
        expect(screen.queryByTestId('browser-demo-strip')).toBeNull();
    });

    it('returns host failures as values', async () => {
        mock.command.mockRejectedValue(new Error('ipc down'));
        await expect(runBrowserDemoCommand({ action: 'stop', id: 'x' })).resolves.toEqual({ ok: false, reason: 'handshake-failed', message: 'ipc down' });
        mock.hasDemo = false;
        await expect(runBrowserDemoCommand({ action: 'list' })).resolves.toMatchObject({ ok: false, reason: 'engine-unsupported' });
    });

    it('reports switching to a recorded tab only while it records and is active', async () => {
        const view = render(<BrowserDemoStrip workspaceId="w" processId="chat-1" routingRef="clone:w" viewId="one" ready active={false} />);
        push(state());
        expect(mock.command).not.toHaveBeenCalledWith({ action: 'switch', viewId: 'one' });
        view.rerender(<BrowserDemoStrip workspaceId="w" processId="chat-1" routingRef="clone:w" viewId="one" ready active />);
        await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ action: 'switch', viewId: 'one' }));
        const switches = () => mock.command.mock.calls.filter(([command]) => command.action === 'switch').length;
        push(state({ stepCount: 4 }));
        expect(switches()).toBe(1);
        push(state({ status: 'paused', pauseReason: 'user' }));
        push(state());
        await waitFor(() => expect(switches()).toBe(2));
    });

    it('pauses a recording when the window leaves its chat and keeps Resume until the chat is back', async () => {
        const release = setBrowserDemoViewingChat({ ...owner, processId: 'queue_chat-1' });
        mount();
        push(state());
        expect(mock.command).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'pause' }));
        act(() => { setBrowserDemoViewingChat({ ...owner, processId: 'chat-2' }); });
        await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ action: 'pause', id: 'demo-1', reason: 'scope' }));
        push(state({ status: 'paused', pauseReason: 'scope' }));
        expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(true);
        act(() => { setBrowserDemoViewingChat(owner); });
        expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(false);
        release();
    });

    it('pauses on panel unmount only when no panel takes the scope back in the same tick', async () => {
        mount();
        push(state());
        const release = setBrowserDemoViewingChat(owner);
        release();
        const again = setBrowserDemoViewingChat(owner);
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(mock.command).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'pause' }));
        again();
        await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ action: 'pause', id: 'demo-1', reason: 'scope' }));
    });

    it.each([
        { workspaceId: 'other-workspace', processId: 'chat-1', routingRef: owner.routingRef },
        { ...owner, routingRef: 'remote:server-b:w' },
        { workspaceId: 'other-workspace', processId: 'queue_chat-1', routingRef: 'remote:server-a:other-workspace' },
    ])('isolates equal chat IDs from a different owner: %j', async otherOwner => {
        setBrowserDemoViewingChat(owner);
        mount();
        push(state());
        expect(isBrowserDemoCapturingChat(owner)).toBe(true);
        expect(isBrowserDemoCapturingChat(otherOwner)).toBe(false);
        expect(getBrowserDemoForOwner(otherOwner)).toBeNull();
        act(() => { setBrowserDemoViewingChat(otherOwner); });
        expect(isBrowserDemoChatInView(owner)).toBe(false);
        expect(isBrowserDemoChatInView(otherOwner)).toBe(true);
        await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ action: 'pause', id: 'demo-1', reason: 'scope' }));
        push(state({ status: 'paused', pauseReason: 'scope' }));
        expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(true);
        act(() => { setBrowserDemoViewingChat({ ...owner, processId: 'queue_chat-1' }); });
        expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(false);
    });

    const departures = [
        null,
        { ...owner, processId: 'chat-2' },
        { ...owner, workspaceId: 'other-workspace' },
        { ...owner, routingRef: 'remote:server-b:w' },
    ];

    it.each(departures)('refuses every capture admission outside the owner: %j', async otherOwner => {
        mount();
        push(state({ status: 'stopped' }));
        act(() => { setBrowserDemoViewingChat(otherOwner); });
        for (const command of [
            { action: 'start', owner, viewId: 'one' } as const,
            { action: 'resume', id: 'demo-1' } as const,
            { action: 'add-tab', id: 'demo-1', viewId: 'two' } as const,
        ]) {
            await expect(runBrowserDemoCommand(command)).resolves.toMatchObject({ ok: false, reason: 'invalid' });
            expect(mock.command).not.toHaveBeenCalledWith(command);
        }
        expect((screen.getByRole('button', { name: 'Resume recording' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Resume recording' }));
        for (const pauseReason of ['user', 'scope', 'disconnected'] as const) {
            push(state({ status: 'paused', pauseReason }));
            expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(true);
            fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        }
        expect(mock.command).not.toHaveBeenCalledWith({ action: 'resume', id: 'demo-1' });
        push(state({ ended: 'discarded' }));
        expect((screen.getByRole('button', { name: 'Record demo' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it.each(departures)('pauses delayed Start completion after departure: %j', async otherOwner => {
        let finish!: (result: BrowserDemoCommandResult) => void;
        mock.command.mockImplementation((command: { action: string }) => {
            if (command.action === 'start') return new Promise<BrowserDemoCommandResult>(resolve => { finish = resolve; });
            if (command.action === 'pause') return Promise.resolve({ ok: true, state: state({ status: 'paused', pauseReason: 'scope' }) });
            return Promise.resolve({ ok: true, drafts: [] });
        });
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Record demo' }));
        act(() => { setBrowserDemoViewingChat(otherOwner); });
        expect(mock.command).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'pause' }));
        await act(async () => { finish({ ok: true, state: state() }); });
        expect(mock.command).toHaveBeenCalledWith({ action: 'pause', id: 'demo-1', reason: 'scope' });
        expect(getBrowserDemoForOwner(owner)?.status).toBe('paused');
    });

    it.each(['paused', 'stopped'] as const)('pauses delayed %s Resume completion after departure', async status => {
        let finish!: (result: BrowserDemoCommandResult) => void;
        mock.command.mockImplementation((command: { action: string }) => {
            if (command.action === 'resume') return new Promise<BrowserDemoCommandResult>(resolve => { finish = resolve; });
            if (command.action === 'pause') return Promise.resolve({ ok: true, state: state({ status: 'paused', pauseReason: 'scope' }) });
            return Promise.resolve({ ok: true, drafts: [] });
        });
        mount();
        push(state({ status, pauseReason: status === 'paused' ? 'user' : undefined }));
        fireEvent.click(screen.getByRole('button', { name: status === 'paused' ? 'Resume' : 'Resume recording' }));
        act(() => { setBrowserDemoViewingChat(null); });
        await act(async () => { finish({ ok: true, state: state() }); });
        expect(mock.command).toHaveBeenCalledWith({ action: 'pause', id: 'demo-1', reason: 'scope' });
        expect(getBrowserDemoForOwner(owner)?.status).toBe('paused');
    });

    it('coalesces repeated recording events while the scope pause is in flight', async () => {
        let finish!: (result: BrowserDemoCommandResult) => void;
        mock.command.mockImplementation((command: { action: string }) => command.action === 'pause'
            ? new Promise<BrowserDemoCommandResult>(resolve => { finish = resolve; })
            : Promise.resolve({ ok: true, drafts: [] }));
        mount();
        push(state());
        act(() => { setBrowserDemoViewingChat(null); });
        push(state({ stepCount: 1 }));
        push(state({ stepCount: 2 }));
        expect(mock.command.mock.calls.filter(([command]) => command.action === 'pause')).toHaveLength(1);
        await act(async () => { finish({ ok: true, state: state({ status: 'paused', pauseReason: 'scope' }) }); });
        push(state());
        expect(mock.command.mock.calls.filter(([command]) => command.action === 'pause')).toHaveLength(2);
        await act(async () => { finish({ ok: true, state: state({ status: 'paused', pauseReason: 'scope' }) }); });
    });

    it.each(['event', 'list'] as const)('reconciles out-of-scope recording from %s without a scope change', async source => {
        setBrowserDemoViewingChat(null);
        mock.command.mockImplementation(async (command: { action: string }) => {
            if (command.action === 'list') return { ok: true, drafts: source === 'list' ? [state()] : [] };
            if (command.action === 'pause') return { ok: true, state: state({ status: 'paused', pauseReason: 'scope' }) };
            return { ok: true };
        });
        mount();
        if (source === 'event') push(state());
        await waitFor(() => expect(getBrowserDemoForOwner(owner)?.status).toBe('paused'));
        expect(mock.command).toHaveBeenCalledWith({ action: 'pause', id: 'demo-1', reason: 'scope' });
    });
});
