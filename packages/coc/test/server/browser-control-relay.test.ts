import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserControlRelay } from '../../src/server/streaming/browser-control-relay';
import { ProcessWebSocketServer } from '../../src/server/streaming/websocket';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrowserNavigationApprovals } from '../../src/server/llm-tools/browser-navigation-approval';

const client = (id: string) => ({ id, send: vi.fn<(data: string) => void>() });
const request = (client: ReturnType<typeof client>) => JSON.parse(client.send.mock.calls.at(-1)![0]).request;
const enabled = () => { const relay = new BrowserControlRelay(); relay.setEnabledGetter(() => true); return relay; };
const frame = { id: 'f-one', origin: 'https://fixture.test', name: '', document: 'd-one', status: 'ready', depth: 0 };
afterEach(() => vi.useRealTimers());

describe('browser control relay', () => {
    it('defaults navigation approval on, follows the live getter and is off when browser control is off', () => {
        const relay = new BrowserControlRelay();
        expect(relay.getNavigationApprovalEnabled()).toBe(false);
        let on = true;
        relay.setEnabledGetter(() => on);
        expect(relay.getNavigationApprovalEnabled()).toBe(true);
        let approval = false;
        relay.setNavigationApprovalEnabledGetter(() => approval);
        expect(relay.getNavigationApprovalEnabled()).toBe(false);
        approval = true;
        expect(relay.getNavigationApprovalEnabled()).toBe(true);
        on = false;
        expect(relay.getNavigationApprovalEnabled()).toBe(false);
    });
    it('sends the default-on cursor overlay policy with each command and follows the live getter', async () => {
        const relay = enabled(), a = client('a');
        relay.advertise(a, 'w', true);
        expect(relay.getCursorOverlayEnabled()).toBe(true);
        void relay.execute('w', 'p', { action: 'snapshot' }).catch(() => undefined);
        expect(request(a).cursorOverlayEnabled).toBe(true);
        let on = false;
        relay.setCursorOverlayEnabledGetter(() => on);
        expect(relay.getCursorOverlayEnabled()).toBe(false);
        void relay.execute('w', 'p', { action: 'snapshot' }).catch(() => undefined);
        expect(request(a).cursorOverlayEnabled).toBeUndefined();
        on = true;
        relay.setEnabledGetter(() => false);
        expect(relay.getCursorOverlayEnabled()).toBe(false);
    });
    it('gates rich paste by owning-server policy and cancels it when disabled', async () => {
        const relay = enabled(), a = client('a');
        relay.advertise(a, 'w', true);
        relay.setFramesEnabledGetter(() => true);
        const command = { action: 'paste_html', ref: 'e1', html: '<b>Synthetic</b>', text: 'Synthetic' } as const;
        await expect(relay.execute('w', 'p', command)).rejects.toThrow('rich paste is disabled');
        let allowed = true;
        relay.setRichPasteEnabledGetter(() => allowed);
        const result = relay.execute('w', 'p', command);
        const sent = request(a);
        expect(sent.richPasteEnabled).toBe(true);
        expect(sent.command).toEqual(command);
        allowed = false;
        relay.syncFramesPolicy();
        await expect(result).rejects.toThrow('rich paste disabled');
        expect(JSON.parse(a.send.mock.calls.at(-1)![0])).toEqual({ type: 'browser-command-cancel', id: sent.id });
    });
    it('resolves default-off private frame policy on the owning relay for every request', async () => {
        const local = enabled(), remote = enabled(), a = client('a'), b = client('b');
        local.advertise(a, 'w', true); remote.advertise(b, 'w', true);
        remote.setFramesEnabledGetter(() => true);
        await expect(local.execute('w', 'p', { action: 'frames' })).rejects.toThrow('frame control is disabled');
        await expect(local.execute('w', 'p', { action: 'read', frame: 'f-one' })).rejects.toThrow('frame control is disabled');
        const one = local.execute('w', 'p', { action: 'snapshot' });
        const two = remote.execute('w', 'p', { action: 'frames' });
        expect(request(a).framesEnabled).toBe(false);
        expect(request(b).framesEnabled).toBe(true);
        expect(request(b).command).toEqual({ action: 'frames' });
        local.reply(a, { id: request(a).id, ok: true, result: { elements: [] } });
        const frames = [{ id: 'f-one', origin: 'https://fixture.test', name: '', document: 'd-one', status: 'ready', depth: 0 }];
        remote.reply(b, { id: request(b).id, ok: true, result: { frame: 'f-one', document: 'd-one', frames } });
        await expect(one).resolves.toEqual({ elements: [] });
        await expect(two).resolves.toMatchObject({ frames });
    });
    it('cancels changed frame policy and rejects late replies, but preserves disabled-path outer-gate admission', async () => {
        const relay = enabled(), a = client('a');
        relay.advertise(a, 'w', true);
        let framesEnabled = true;
        relay.setFramesEnabledGetter(() => framesEnabled);
        const result = relay.execute('w', 'p', { action: 'read', frame: 'f-one' });
        const id = request(a).id;
        framesEnabled = false;
        relay.syncFramesPolicy();
        await expect(result).rejects.toThrow('frame policy changed');
        expect(JSON.parse(a.send.mock.calls.at(-1)![0])).toEqual({ type: 'browser-command-cancel', id });
        relay.reply(a, { id, ok: true, result: { text: 'late' } });
    });
    it.each([
        { frames: [{ id: 'f', origin: '', name: '', document: 'd', status: 'unknown', depth: 0 }] },
        { frames: [{ id: 'f', origin: '', name: '', document: 'd', status: 'ready', depth: 9 }] },
        { frames: [{ id: 'f', parent: 'f', origin: '', name: '', document: 'd', status: 'ready', depth: 0 }] },
        { frames: [{ id: 'f', origin: '', name: '', document: 'd', status: 'ready', depth: 0, sessionId: 'private' }] },
        { frame: 1 }, { document: null }, { truncated: true },
        { elements: [{ ref: 'e1', role: 'button', name: '', depth: 0, frame: 1 }] },
        { frames: Array.from({ length: 33 }, (_, i) => ({ ...frame, id: `f-${i}` })) },
        { frames: [frame, frame] },
        { frame: 'f-one', document: 'other', frames: [frame] },
        { frames: [{ ...frame, name: 'x'.repeat(161) }] },
        { frames: [{ ...frame, origin: 'x'.repeat(257) }] },
        { frames: [{ ...frame, document: '' }] },
        { frames: [{ ...frame, parent: 'f-two', depth: 1 }, { ...frame, id: 'f-two', parent: 'f-one', depth: 2 }] },
        { frames: [frame], elements: [{ ref: 'e1', role: 'button', name: '', depth: 0 }] },
        { frames: [frame], elements: [{ ref: 'e1', role: 'button', name: '', depth: 0, frame: 'foreign' }] },
        { frames: [frame], elements: [true] },
        { frames: [frame], elements: [{ ref: 'e1', role: 'button', name: '', depth: 0, frame: 'f-one', sessionId: 'private' }] },
    ])('rejects invalid enabled frame replies explicitly %j', async bad => {
        const relay = enabled(), a = client('a');
        relay.setFramesEnabledGetter(() => true);
        relay.advertise(a, 'w', true);
        const result = relay.execute('w', 'p', { action: 'snapshot' });
        relay.reply(a, { id: request(a).id, ok: true, result: bad });
        await expect(result).rejects.toThrow('invalid frame result');
    });
    it('rejects legacy desktop success when frame policy requires frame-aware results', async () => {
        const relay = enabled(), a = client('a');
        relay.setFramesEnabledGetter(() => true);
        relay.advertise(a, 'w', true);
        const result = relay.execute('w', 'p', { action: 'snapshot' });
        relay.reply(a, { id: request(a).id, ok: true, result: { elements: [] } });
        await expect(result).rejects.toThrow('Unsupported desktop capability');
    });
    it('retains one turn identity across routing windows and sends terminal clears even after the gate switches off', async () => {
        const relay = enabled(), a = client('a'), b = client('b');
        for (const target of [a, b]) {
            relay.advertise(target, 'w', true);
            const result = relay.execute('w', 'p', { action: 'snapshot' }, 't1:view', undefined, 'turn');
            expect(request(target).turnId).toBe('turn');
            relay.reply(target, { id: request(target).id, ok: true, result: { elements: [] } });
            await result;
        }
        relay.setEnabledGetter(() => false);
        relay.finishProcess('w', 'p');
        for (const target of [a, b]) expect(JSON.parse(target.send.mock.calls.at(-1)![0])).toEqual({
            type: 'browser-turn-finished', workspaceId: 'w', processId: 'p', turnId: 'turn',
        });
    });
    it('accepts the raw subtree interactive baseline and paged read metadata, rejecting malformed extensions', async () => {
        const relay = enabled(), a = client('a');
        relay.advertise(a, 'w', true);
        const snapshot = relay.execute('w', 'p', { action: 'snapshot', all: true });
        const id = request(a).id;
        relay.reply(a, { id, ok: true, result: { interactiveElements: 'invalid' } });
        const result = { elements: [], interactiveElements: [{ ref: 'e1', role: 'button', name: 'Save', depth: 0 }], text: 'page', textTotal: 16003 };
        relay.reply(a, { id, ok: true, result });
        await expect(snapshot).resolves.toEqual(result);
        const read = relay.execute('w', 'p', { action: 'read', offset: 8000 });
        const readId = request(a).id;
        relay.reply(a, { id: readId, ok: true, result: { text: 'x', textTotal: -1 } });
        relay.reply(a, { id: readId, ok: true, result: { text: 'x', textTotal: 8001 } });
        await expect(read).resolves.toEqual({ text: 'x', textTotal: 8001 });
    });
    it('defaults off, applies the live gate without activation checks, and fails immediately without a capable workspace client', async () => {
        const relay = new BrowserControlRelay();
        await expect(relay.execute('a', 'p', { action: 'tabs' })).rejects.toThrow('Browser control is disabled');
        relay.setEnabledGetter(() => true);
        await expect(relay.execute('a', 'p', { action: 'tabs' })).rejects.toThrow('No CoC desktop window is open for this workspace');
        const other = client('other');
        relay.advertise(other, 'b', true);
        await expect(relay.execute('a', 'p', { action: 'tabs' })).rejects.toThrow('No CoC desktop window');
        relay.advertise(other, {}, true);
        expect(other.send).not.toHaveBeenCalled();
    });

    it('routes exactly to the latest focused correct-workspace socket and preserves selectedTab separately from explicit tab', async () => {
        const relay = enabled(), a = client('a'), b = client('b'), other = client('other');
        relay.advertise(a, 'w', true);
        relay.advertise(b, 'w', true);
        relay.advertise(other, 'other', true);
        relay.advertise(a, 'w', false);
        const first = relay.execute('w', 'p', { action: 'snapshot', tab: 'explicit' }, 'remembered');
        expect(a.send).not.toHaveBeenCalled();
        expect(other.send).not.toHaveBeenCalled();
        expect(request(b)).toMatchObject({ workspaceId: 'w', processId: 'p', selectedTab: 'remembered', command: { action: 'snapshot', tab: 'explicit' } });
        relay.reply(b, { id: request(b).id, ok: true, result: { tab: 'explicit', elements: [] } });
        await expect(first).resolves.toEqual({ tab: 'explicit', elements: [] });
        relay.advertise(a, 'w', true);
        const second = relay.execute('w', 'q', { action: 'tabs' });
        relay.reply(a, { id: request(a).id, ok: true, result: { tabs: [] } });
        await expect(second).resolves.toEqual({ tabs: [] });
    });

    it('ignores malformed, foreign and stale replies; propagates valid error replies', async () => {
        const relay = enabled(), a = client('a'), b = client('b');
        relay.advertise(a, 'w', true);
        const result = relay.execute('w', 'p', { action: 'tabs' });
        const id = request(a).id;
        relay.reply(b, { id, ok: true, result: {} });
        for (const malformed of [null, { id, ok: true }, { id, ok: true, result: { tabs: [null] } },
            { id, ok: true, result: { elements: [{ depth: NaN }] } }, { id, ok: true, result: { image: { data: '/path', mimeType: 'image/png' } } },
            { id, ok: true, result: { unknown: true } }, { id, ok: false, error: {} }]) relay.reply(a, malformed);
        relay.reply(a, { id: 'stale', ok: true, result: {} });
        relay.reply(a, { id, ok: false, error: 'stale ref, re-snapshot' });
        await expect(result).rejects.toThrow('stale ref, re-snapshot');
        relay.reply(a, { id, ok: true, result: {} });
    });

    it('times out after 60s, forwards cancellation, and releases all timers/listeners', async () => {
        vi.useFakeTimers();
        const relay = enabled(), a = client('a');
        relay.advertise(a, 'w', true);
        const result = relay.execute('w', 'p', { action: 'read' });
        const assertion = expect(result).rejects.toThrow('timed out after 60s');
        const id = request(a).id;
        await vi.advanceTimersByTimeAsync(59_999);
        expect(a.send.mock.calls.some(([data]) => JSON.parse(data).type === 'browser-command-cancel')).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await assertion;
        expect(JSON.parse(a.send.mock.calls.at(-1)![0])).toEqual({ type: 'browser-command-cancel', id });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('excludes Switch back notice waits from the 60s limit, only for the owning socket with background control on', async () => {
        vi.useFakeTimers();
        const relay = enabled(), win = client('win'), other = client('other');
        let background = true;
        relay.setBackgroundEnabledGetter(() => background);
        relay.advertise(win, 'b', true, ['a']);
        const call = relay.execute('a', 'p', { action: 'click', ref: 'e1' });
        const assertion = expect(call).rejects.toThrow('timed out after 60s');
        const id = request(win).id;
        await vi.advanceTimersByTimeAsync(20_000);
        relay.waiting(other, id, true);
        relay.waiting(win, id, 'yes');
        relay.waiting(win, 'missing', true);
        relay.waiting(win, id, true);
        relay.waiting(win, id, true);
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(win.send.mock.calls.some(([data]) => JSON.parse(data).type === 'browser-command-cancel')).toBe(false);
        relay.waiting(win, id, false);
        relay.waiting(win, id, false);
        await vi.advanceTimersByTimeAsync(39_999);
        expect(win.send.mock.calls.some(([data]) => JSON.parse(data).type === 'browser-command-cancel')).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await assertion;
        expect(vi.getTimerCount()).toBe(0);

        // A reply still settles a waiting call, and waiting is ignored with background control off.
        const waited = relay.execute('a', 'q', { action: 'tabs' });
        const waitedId = request(win).id;
        relay.waiting(win, waitedId, true);
        relay.reply(win, { id: waitedId, ok: true, result: { tabs: [] } });
        await expect(waited).resolves.toEqual({ tabs: [] });
        background = false;
        relay.advertise(win, 'a', true);
        const foreground = relay.execute('a', 'p', { action: 'read' });
        const foregroundAssertion = expect(foreground).rejects.toThrow('timed out after 60s');
        relay.waiting(win, request(win).id, true);
        await vi.advanceTimersByTimeAsync(60_000);
        await foregroundAssertion;
    });

    it('forwards abort, handles pre-abort and allows an admitted call to finish after disable', async () => {
        const relay = enabled(), a = client('a'), controller = new AbortController();
        relay.advertise(a, 'w', true);
        const result = relay.execute('w', 'p', { action: 'wait', ms: 5 }, undefined, controller.signal);
        const id = request(a).id;
        const turnId = request(a).turnId;
        controller.abort(new Error('Stopped'));
        await expect(result).rejects.toThrow('Stopped');
        expect(JSON.parse(a.send.mock.calls.at(-1)![0])).toEqual({ type: 'browser-command-cancel', id });
        expect(a.send.mock.calls.map(([data]) => JSON.parse(data))).toContainEqual({
            type: 'browser-turn-finished', workspaceId: 'w', processId: 'p', turnId,
        });
        await expect(relay.execute('w', 'p', { action: 'tabs' }, undefined, controller.signal)).rejects.toThrow('Stopped');
        const inflight = relay.execute('w', 'p', { action: 'tabs' });
        const nextId = request(a).id;
        relay.setEnabledGetter(() => false);
        relay.reply(a, { id: nextId, ok: true, result: { tabs: [] } });
        await expect(inflight).resolves.toEqual({ tabs: [] });
    });

    it('rejects every pending call on disconnect or workspace rebind without affecting other clients', async () => {
        const relay = enabled(), a = client('a'), b = client('b');
        relay.advertise(a, 'a', true); relay.advertise(b, 'b', true);
        const one = relay.execute('a', 'p', { action: 'tabs' });
        const two = relay.execute('a', 'q', { action: 'tabs' });
        const other = relay.execute('b', 'p', { action: 'tabs' });
        relay.disconnect(a);
        await expect(one).rejects.toThrow('disconnected');
        await expect(two).rejects.toThrow('disconnected');
        relay.reply(b, { id: request(b).id, ok: true, result: {} });
        await expect(other).resolves.toEqual({});
        relay.advertise(a, 'a', true);
        const rebound = relay.execute('a', 'p', { action: 'tabs' });
        relay.advertise(a, 'new', false);
        await expect(rebound).rejects.toThrow('disconnected');
    });

    it('keeps background workspaces served per socket only while background control is on', async () => {
        const relay = enabled(), win = client('win'), other = client('other');
        let background = false;
        relay.setBackgroundEnabledGetter(() => background);
        relay.advertise(win, 'a', true);
        relay.advertise(other, 'c', true);
        const flagOff = relay.execute('a', 'p', { action: 'tabs' });
        relay.advertise(win, 'b', true, ['a']);
        await expect(flagOff).rejects.toThrow('disconnected');
        await expect(relay.execute('a', 'p', { action: 'tabs' })).rejects.toThrow('No CoC desktop window');

        background = true;
        relay.advertise(win, 'a', true);
        const kept = relay.execute('a', 'p', { action: 'tabs' });
        const keptId = request(win).id;
        relay.advertise(win, 'b', true, ['a', '', 42, 'b']);
        relay.reply(win, { id: keptId, ok: true, result: { tabs: [] } });
        await expect(kept).resolves.toEqual({ tabs: [] });
        // Background routing reaches only the retaining socket and only for retained workspaces.
        const later = relay.execute('a', 'q', { action: 'tabs' });
        expect(request(win)).toMatchObject({ workspaceId: 'a', processId: 'q' });
        expect(other.send).not.toHaveBeenCalled();
        relay.reply(win, { id: request(win).id, ok: true, result: { tabs: [] } });
        await expect(later).resolves.toEqual({ tabs: [] });
        await expect(relay.execute('c2', 'p', { action: 'tabs' })).rejects.toThrow('No CoC desktop window');

        // Clearing the selected workspace keeps retained ones; dropping a workspace rejects only its calls.
        const foreground = relay.execute('b', 'p', { action: 'tabs' });
        const backgroundCall = relay.execute('a', 'p', { action: 'tabs' });
        const backgroundId = request(win).id;
        relay.clear(win, ['a']);
        await expect(foreground).rejects.toThrow('disconnected');
        relay.reply(win, { id: backgroundId, ok: true, result: { tabs: [] } });
        await expect(backgroundCall).resolves.toEqual({ tabs: [] });
        await expect(relay.execute('b', 'p', { action: 'tabs' })).rejects.toThrow('No CoC desktop window');
        const dropped = relay.execute('a', 'p', { action: 'tabs' });
        relay.advertise(win, 'b', true, []);
        await expect(dropped).rejects.toThrow('disconnected');

        // Turning the flag off drops retained workspaces at once.
        relay.advertise(win, 'b', true, ['a']);
        const live = relay.execute('a', 'p', { action: 'tabs' });
        background = false;
        relay.syncPolicies();
        await expect(live).rejects.toThrow('disconnected');
        await expect(relay.execute('a', 'p', { action: 'tabs' })).rejects.toThrow('No CoC desktop window');
        relay.clear(win, ['b']);
        await expect(relay.execute('b', 'p', { action: 'tabs' })).rejects.toThrow('No CoC desktop window');
    });

    it('prefers a window showing the workspace over one keeping it in the background', async () => {
        const relay = enabled(), keeper = client('keeper'), viewer = client('viewer');
        relay.setBackgroundEnabledGetter(() => true);
        relay.advertise(viewer, 'a', false);
        relay.advertise(keeper, 'b', true, ['a']);
        const call = relay.execute('a', 'p', { action: 'tabs' });
        expect(keeper.send).not.toHaveBeenCalled();
        relay.reply(viewer, { id: request(viewer).id, ok: true, result: { tabs: [] } });
        await expect(call).resolves.toEqual({ tabs: [] });
        relay.disconnect(viewer);
        const fallback = relay.execute('a', 'p', { action: 'tabs' });
        relay.reply(keeper, { id: request(keeper).id, ok: true, result: { tabs: [] } });
        await expect(fallback).resolves.toEqual({ tabs: [] });
    });

    it('cleans pending calls if socket send throws', async () => {
        const relay = enabled(), a = client('a');
        a.send.mockImplementation(() => { throw new Error('closed socket'); });
        relay.advertise(a, 'w', true);
        await expect(relay.execute('w', 'p', { action: 'tabs' })).rejects.toThrow('closed socket');
    });
});

describe('real existing WebSocket protocol', () => {
    it('wires advertisement, targeted requests/replies and socket-close rejection without broadcasting commands', async () => {
        const server = createServer();
        const sockets = new ProcessWebSocketServer();
        sockets.attach(server);
        sockets.browserControl.setEnabledGetter(() => true);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}/ws`);
        const broadcasts = vi.fn();
        sockets.onBroadcast(broadcasts);
        try {
            await new Promise<void>(resolve => ws.once('open', resolve));
            ws.send(JSON.stringify({ type: 'browser-capability', workspaceId: 'w', focused: true }));
            ws.send(JSON.stringify({ type: 'ping' }));
            await new Promise<void>(resolve => ws.on('message', data => { if (JSON.parse(String(data)).type === 'pong') resolve(); }));
            ws.on('message', data => {
                const message = JSON.parse(String(data));
                if (message.type === 'browser-command') ws.send(JSON.stringify({ type: 'browser-command-result', reply: { id: message.request.id, ok: true, result: { tabs: [] } } }));
            });
            await expect(sockets.browserControl.execute('w', 'p', { action: 'tabs' })).resolves.toEqual({ tabs: [] });
            expect(broadcasts).not.toHaveBeenCalled();
            sockets.browserControl.setBackgroundEnabledGetter(() => true);
            const pong = () => new Promise<void>(resolve => {
                const listener = (data: unknown) => { if (JSON.parse(String(data)).type === 'pong') { ws.off('message', listener); resolve(); } };
                ws.on('message', listener);
                ws.send(JSON.stringify({ type: 'ping' }));
            });
            ws.send(JSON.stringify({ type: 'browser-capability-clear', background: ['w'] }));
            await pong();
            await expect(sockets.browserControl.execute('w', 'p', { action: 'tabs' })).resolves.toEqual({ tabs: [] });
            ws.send(JSON.stringify({ type: 'browser-capability', workspaceId: 'x', focused: true, background: ['w'] }));
            await pong();
            await expect(sockets.browserControl.execute('w', 'p', { action: 'tabs' })).resolves.toEqual({ tabs: [] });
            const waiting = vi.spyOn(sockets.browserControl, 'waiting');
            ws.send(JSON.stringify({ type: 'browser-command-waiting', id: 'call', waiting: true }));
            await pong();
            expect(waiting).toHaveBeenCalledWith(expect.anything(), 'call', true);
            const check = vi.spyOn(sockets.browserControl, 'navigationCheck');
            const answer = vi.spyOn(sockets.browserControl, 'navigationAnswer');
            const checkMessage = { type: 'browser-navigation-check', checkId: 'c1', workspaceId: 'w', processId: 'p', turnId: 't', url: 'https://example.com/' };
            ws.send(JSON.stringify(checkMessage));
            ws.send(JSON.stringify({ type: 'browser-navigation-answer', checkId: 'c1', answer: 'deny' }));
            await pong();
            expect(check).toHaveBeenCalledWith(expect.anything(), checkMessage);
            expect(answer).toHaveBeenCalledWith(expect.anything(), 'c1', 'deny');
            ws.removeAllListeners('message');
            const inflight = sockets.browserControl.execute('w', 'p', { action: 'tabs' });
            ws.close();
            await expect(inflight).rejects.toThrow('disconnected');
        } finally {
            ws.terminate();
            sockets.closeAll();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});

describe('browser navigation approval relay', () => {
    const sent = (c: ReturnType<typeof client>) => c.send.mock.calls.map(([data]) => JSON.parse(data));
    const decisions = (c: ReturnType<typeof client>) => sent(c).filter(message => message.type === 'browser-navigation-decision');
    const setup = () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-nav-approval-'));
        const approvals = new BrowserNavigationApprovals(dir);
        const relay = enabled(), win = client('win');
        relay.setNavigationApprovals(approvals);
        relay.advertise(win, 'w', true);
        const call = relay.execute('w', 'p', { action: 'open', url: 'https://mail.google.com/' });
        const { id, turnId } = request(win);
        const check = (checkId: string, url: string, from = win, processId = 'p') =>
            relay.navigationCheck(from, { type: 'browser-navigation-check', checkId, workspaceId: 'w', processId, turnId, url });
        return { dir, approvals, relay, win, call, id, turnId, check };
    };
    afterEach(() => vi.useRealTimers());

    it('allows exempt, approved and ungated sites at once and prompts for a new root domain', async () => {
        const { dir, relay, win, call, id, turnId, check } = setup();
        check('c-local', 'http://localhost:4000/');
        check('c-blank', 'about:blank');
        expect(decisions(win)).toEqual([
            { type: 'browser-navigation-decision', checkId: 'c-local', allow: true },
            { type: 'browser-navigation-decision', checkId: 'c-blank', allow: true },
        ]);
        check('c-mail', 'https://mail.google.com/inbox');
        expect(sent(win).at(-1)).toEqual({ type: 'browser-navigation-prompt', prompt: {
            checkId: 'c-mail', workspaceId: 'w', processId: 'p', turnId,
            site: 'google.com', url: 'https://mail.google.com/inbox',
        } });
        expect(decisions(win)).toHaveLength(2);
        relay.navigationAnswer(win, 'c-mail', 'once');
        expect(sent(win).slice(-2)).toEqual([
            { type: 'browser-navigation-decision', checkId: 'c-mail', allow: true },
            { type: 'browser-navigation-prompt-cleared', checkId: 'c-mail' },
        ]);
        // A same-root sub-page no longer asks.
        check('c-docs', 'https://docs.google.com/');
        expect(sent(win).at(-1)).toEqual({ type: 'browser-navigation-decision', checkId: 'c-docs', allow: true });
        relay.setNavigationApprovalEnabledGetter(() => false);
        check('c-off', 'https://example.org/');
        expect(sent(win).at(-1)).toEqual({ type: 'browser-navigation-decision', checkId: 'c-off', allow: true });
        relay.reply(win, { id, ok: true, result: { url: 'https://mail.google.com/' } });
        await expect(call).resolves.toEqual({ url: 'https://mail.google.com/' });
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('keeps "Allow once" to the conversation and "Always allow" global and persistent', () => {
        const { dir, approvals, relay, win, check } = setup();
        check('c1', 'https://news.bbc.co.uk/');
        relay.navigationAnswer(win, 'c1', 'once');
        expect(approvals.isAllowed('w', 'p', 'bbc.co.uk')).toBe(true);
        expect(approvals.isAllowed('w', 'other', 'bbc.co.uk')).toBe(false);
        check('c2', 'https://user.github.io/');
        relay.navigationAnswer(win, 'c2', 'always');
        expect(new BrowserNavigationApprovals(dir).isAllowed('x', 'y', 'user.github.io')).toBe(true);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('denies with the tool error, blocks the navigation and ignores answers from other sockets', async () => {
        const { dir, relay, win, call, id, check } = setup();
        const other = client('other');
        check('c1', 'https://evil.example.com/');
        relay.navigationAnswer(other, 'c1', 'once');
        relay.navigationAnswer(win, 'c1', 'maybe');
        expect(decisions(win)).toEqual([]);
        relay.navigationAnswer(win, 'c1', 'deny');
        await expect(call).rejects.toThrow('user denied access to example.com');
        expect(sent(win).slice(-3)).toEqual([
            { type: 'browser-navigation-decision', checkId: 'c1', allow: false },
            { type: 'browser-navigation-prompt-cleared', checkId: 'c1' },
            { type: 'browser-command-cancel', id },
        ]);
        relay.navigationAnswer(win, 'c1', 'once');
        expect(decisions(win)).toHaveLength(1);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('pauses the 60s limit while asking and resumes it with the remaining time', async () => {
        vi.useFakeTimers();
        const { dir, relay, win, call, check } = setup();
        const assertion = expect(call).rejects.toThrow('timed out after 60s');
        await vi.advanceTimersByTimeAsync(20_000);
        check('c1', 'https://example.com/');
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(sent(win).some(message => message.type === 'browser-command-cancel')).toBe(false);
        relay.navigationAnswer(win, 'c1', 'once');
        await vi.advanceTimersByTimeAsync(39_999);
        expect(sent(win).some(message => message.type === 'browser-command-cancel')).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await assertion;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('blocks checks outside the active turn and settles prompts on stop, turn finish, disconnect and disable', async () => {
        const { dir, relay, win, call, turnId, check } = setup();
        const stranger = client('stranger');
        check('c-other', 'https://a.example/', stranger);
        check('c-proc', 'https://a.example/', win, 'q');
        relay.navigationCheck(win, { checkId: 'c-turn', workspaceId: 'w', processId: 'p', turnId: 'nope', url: 'https://a.example/' });
        relay.navigationCheck(win, { checkId: 'bad id', workspaceId: 'w', processId: 'p', turnId, url: 'https://a.example/' });
        expect(decisions(stranger)).toEqual([{ type: 'browser-navigation-decision', checkId: 'c-other', allow: false }]);
        expect(decisions(win).map(message => [message.checkId, message.allow])).toEqual([['c-proc', false], ['c-turn', false]]);

        check('c-stop', 'https://stop.example/');
        relay.finishProcess('w', 'p');
        expect(decisions(win).at(-1)).toEqual({ type: 'browser-navigation-decision', checkId: 'c-stop', allow: false });
        expect(sent(win)).toContainEqual({ type: 'browser-navigation-prompt-cleared', checkId: 'c-stop' });

        const next = relay.execute('w', 'p', { action: 'tabs' });
        const nextTurn = request(win).turnId;
        relay.navigationCheck(win, { checkId: 'c-off', workspaceId: 'w', processId: 'p', turnId: nextTurn, url: 'https://off.example/' });
        relay.setNavigationApprovalEnabledGetter(() => false);
        expect(decisions(win).at(-1)).toEqual({ type: 'browser-navigation-decision', checkId: 'c-off', allow: true });
        relay.setNavigationApprovalEnabledGetter(() => true);
        relay.navigationCheck(win, { checkId: 'c-drop', workspaceId: 'w', processId: 'p', turnId: nextTurn, url: 'https://drop.example/' });
        relay.disconnect(win);
        expect(decisions(win).at(-1)).toEqual({ type: 'browser-navigation-decision', checkId: 'c-drop', allow: false });
        await expect(next).rejects.toThrow('disconnected');
        void call.catch(() => undefined);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe('browser human takeover relay', () => {
    const state = (turnId: string, status: 'human' | 'agent' | 'terminated' = 'human') => ({ workspaceId: 'w', processId: 'p', turnId, routingRef: 'w', status });
    it('defaults off and reports unavailable hosts without changing engines', async () => {
        const relay = enabled(), a = client('a'); relay.advertise(a, 'w', true);
        await expect(relay.execute('w', 'p', { action: 'request_human', text: 'MFA' })).rejects.toThrow('disabled');
        relay.setHumanTakeoverEnabledGetter(() => true);
        await expect(relay.execute('w', 'p', { action: 'request_human', text: 'MFA' })).rejects.toThrow('Unsupported desktop');
        expect(a.send).not.toHaveBeenCalled();
    });
    it('holds deadlines while human owns the conversation, drops late observations and isolates other conversations', async () => {
        vi.useFakeTimers();
        const relay = enabled(), a = client('a'), b = client('b');
        relay.setHumanTakeoverEnabledGetter(() => true);
        relay.advertise(a, 'w', true, undefined, true);
        const late = relay.execute('w', 'p', { action: 'snapshot' }, undefined, undefined, 'turn').catch(error => error);
        const first = request(a); expect(first.humanTakeoverEnabled).toBe(true);
        relay.takeoverState(b, state('turn')); // wrong socket cannot pause
        relay.takeoverState(a, state('wrong')); // nor can a stale turn
        relay.takeoverState(a, state('turn'));
        const pending = relay.execute('w', 'p', { action: 'read' }, undefined, undefined, 'turn');
        const read = request(a);
        await vi.advanceTimersByTimeAsync(600_000);
        relay.reply(a, { id: first.id, ok: true, result: { elements: [], title: 'private secret' } });
        expect((await late).message).toContain('observation discarded');
        const other = relay.execute('w', 'other', { action: 'snapshot' }); const own = request(a);
        relay.reply(a, { id: own.id, ok: true, result: { elements: [] } }); await other;
        relay.takeoverState(a, state('turn', 'agent'));
        relay.reply(a, { id: read.id, ok: true, result: { text: 'refreshed', handoffNote: 'ready' } });
        expect(await pending).toMatchObject({ text: 'refreshed', handoffNote: 'ready' });
        expect(vi.getTimerCount()).toBe(0);
    });
    it.each(['stop', 'disable', 'disconnect', 'finish'])('terminates held continuation on %s without replay', async action => {
        const relay = enabled(), a = client('a'); let on = true;
        relay.setHumanTakeoverEnabledGetter(() => on); relay.advertise(a, 'w', true, undefined, true);
        const pending = relay.execute('w', 'p', { action: 'request_human', text: 'MFA' }, undefined, undefined, 'turn').catch(error => error);
        relay.takeoverState(a, state('turn'));
        if (action === 'stop') relay.takeoverState(a, state('turn', 'terminated'));
        if (action === 'disable') { on = false; relay.syncPolicies(); }
        if (action === 'disconnect') relay.disconnect(a);
        if (action === 'finish') relay.finishProcess('w', 'p');
        expect(await pending).toBeInstanceOf(Error);
        expect(a.send.mock.calls.map(([data]) => JSON.parse(data)).filter(message => message.type === 'browser-command')).toHaveLength(1);
    });
    it('retains a human pause across workspace switch with background off and composes with navigation waits', async () => {
        const relay = enabled(), a = client('a'); relay.setHumanTakeoverEnabledGetter(() => true);
        relay.advertise(a, 'w', true, undefined, true);
        const pending = relay.execute('w', 'p', { action: 'request_human', text: 'MFA' }, undefined, undefined, 'turn');
        const original = request(a); relay.takeoverState(a, state('turn'));
        relay.advertise(a, 'other', true, undefined, true);
        relay.syncPolicies();
        // Explicit Return is available in the owning browser surface after switching back.
        relay.advertise(a, 'w', true, undefined, true);
        relay.takeoverState(a, state('turn', 'agent'));
        relay.reply(a, { id: original.id, ok: true, result: { elements: [], handoffNote: 'ready' } });
        expect(await pending).toMatchObject({ handoffNote: 'ready' });
    });
    it('marks server-delayed commands for main-process revalidation across a handoff', async () => {
        const relay = enabled(), a = client('a'); relay.setHumanTakeoverEnabledGetter(() => true); relay.advertise(a, 'w', true, undefined, true);
        const first = relay.execute('w', 'p', { action: 'snapshot' }, undefined, undefined, 'turn');
        const original = request(a); relay.reply(a, { id: original.id, ok: true, result: { elements: [] } }); await first;
        const before = relay.getHumanTakeoverRevision('w', 'p');
        relay.takeoverState(a, state('turn')); relay.takeoverState(a, state('turn', 'agent'));
        const delayed = relay.execute('w', 'p', { action: 'navigate', direction: 'back' }, undefined, undefined, 'turn', before);
        expect(request(a).validateAfterTakeover).toBe(true);
        relay.reply(a, { id: request(a).id, ok: false, error: 'stale-action: page changed; replan' });
        await expect(delayed).rejects.toThrow('stale-action');
    });

    it('rejects commands from a disconnected handoff turn after reconnect instead of automatically restoring control', async () => {
        const relay = enabled(), a = client('a'); relay.setHumanTakeoverEnabledGetter(() => true); relay.advertise(a, 'w', true, undefined, true);
        const pending = relay.execute('w', 'p', { action: 'request_human', text: 'MFA' }, undefined, undefined, 'turn').catch(error => error);
        relay.takeoverState(a, state('turn')); relay.disconnect(a); await pending;
        relay.advertise(a, 'w', true, undefined, true);
        await expect(relay.execute('w', 'p', { action: 'snapshot' }, undefined, undefined, 'turn')).rejects.toThrow('continuation terminated');
        const next = relay.execute('w', 'p', { action: 'snapshot' }, undefined, undefined, 'new-turn');
        relay.reply(a, { id: request(a).id, ok: true, result: { elements: [] } }); await next;
    });

    it('revokes desktop UI policy on flag disable even between browser commands', async () => {
        const relay = enabled(), a = client('a'); let flag = true;
        relay.setHumanTakeoverEnabledGetter(() => flag); relay.advertise(a, 'w', true, undefined, true);
        const first = relay.execute('w', 'p', { action: 'snapshot' }, undefined, undefined, 'turn');
        relay.reply(a, { id: request(a).id, ok: true, result: { elements: [] } }); await first;
        flag = false; relay.syncPolicies();
        expect(JSON.parse(a.send.mock.calls.at(-1)![0])).toEqual({ type: 'browser-takeover-policy', enabled: false });
    });

});
