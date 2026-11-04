import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAnnotationBridge, type BrowserAnnotationIdentity } from '../src/browser-annotation-bridge';
import type { BrowserAnnotationTabSink } from '../src/browser-annotation-tab';

const identity: BrowserAnnotationIdentity = { viewId: 'tab', sessionKey: 'clone/workspace', requestId: 'generation-1' };
const request = (action: 'start' | 'stop' | 'remove', fields = {}) => ({ ...identity, action, ...fields });
let sinks: BrowserAnnotationTabSink[];
let manager: { startAnnotation: ReturnType<typeof vi.fn>; stopAnnotation: ReturnType<typeof vi.fn>; removeAnnotation: ReturnType<typeof vi.fn>; setAnnotationEnabled: ReturnType<typeof vi.fn> };
let bridge: BrowserAnnotationBridge;
let send: ReturnType<typeof vi.fn>;
beforeEach(() => {
    sinks = [];
    manager = {
        startAnnotation: vi.fn(async (_owner, _view, _session, sink) => { sinks.push(sink); return true; }),
        stopAnnotation: vi.fn(async () => {}),
        removeAnnotation: vi.fn(async () => {}),
        setAnnotationEnabled: vi.fn(async () => {}),
    };
    bridge = new BrowserAnnotationBridge(manager);
    send = vi.fn();
});

describe('owner-bound annotation bridge', () => {
    it('transports main-captured PNGs only through their original owner and request lease', async () => {
        const other = vi.fn();
        await bridge.command(10, request('start'), send);
        await bridge.command(11, request('start'), other);
        const event = { type: 'selection' as const, kind: 'area' as const, immediate: false, captureId: '1',
            rect: { x: 10, y: 20, width: 30, height: 40 },
            page: { url: 'https://fixture.test/', title: 'Fixture', viewport: { width: 800, height: 600, devicePixelRatio: 1 } },
            image: { dataUrl: 'data:image/png;base64,cG5n', width: 30, height: 40 } };
        sinks[0].events([event]);
        expect(send).toHaveBeenCalledExactlyOnceWith({ ...identity, type: 'events', events: [event] });
        expect(other).not.toHaveBeenCalled();
        await bridge.command(10, request('stop'), send);
        await bridge.command(10, request('start', { requestId: 'replacement' }), send);
        sinks[0].events([event]);
        expect(send).toHaveBeenCalledTimes(1);
        bridge.clearOwner(11);
        sinks[1].events([event]);
        expect(other).not.toHaveBeenCalled();
    });

    it('passes only exact identity to the manager and tags selections and termination', async () => {
        expect(await bridge.command(10, request('start'), send)).toBe(true);
        expect(manager.startAnnotation).toHaveBeenCalledWith(10, identity.viewId, identity.sessionKey, expect.anything());
        sinks[0].events([]);
        expect(send).toHaveBeenLastCalledWith({ ...identity, type: 'events', events: [] });
        sinks[0].ended('failed', new Error('Capture unavailable'));
        expect(send).toHaveBeenLastCalledWith({ ...identity, type: 'ended', reason: 'failed', error: 'Capture unavailable' });
        sinks[0].events([]);
        expect(send).toHaveBeenCalledTimes(2);
        expect(await bridge.command(10, request('start', { requestId: 'retry' }), send)).toBe(true);
    });

    it.each([null, {}, [], { ...request('start'), action: 'evaluate' },
        request('start', { viewId: '' }), request('start', { viewId: 'x'.repeat(513) }),
        request('start', { sessionKey: '' }), request('start', { requestId: '' }),
        request('start', { requestId: 'x'.repeat(129) }), request('start', { requestId: 'bad\nrequest' }),
        { action: 'policy', sessionKey: identity.sessionKey, enabled: 'false' },
    ])('rejects malformed requests without invoking native methods: %j', async input => {
        await expect(bridge.command(10, input, send)).rejects.toThrow(TypeError);
        expect(manager.startAnnotation).not.toHaveBeenCalled();
        expect(manager.stopAnnotation).not.toHaveBeenCalled();
        expect(manager.setAnnotationEnabled).not.toHaveBeenCalled();
    });

    it('isolates equal view IDs across windows and rejects duplicate start in one window', async () => {
        await bridge.command(10, request('start'), send);
        await bridge.command(11, request('start'), send);
        await expect(bridge.command(10, request('start', { requestId: 'duplicate' }), send)).rejects.toThrow('already');
        await bridge.command(12, request('stop'), send);
        expect(manager.stopAnnotation).not.toHaveBeenCalled();
        await bridge.command(10, request('stop'), send);
        expect(manager.stopAnnotation).toHaveBeenCalledWith(10, identity.viewId, identity.sessionKey);
        sinks[1].events([]);
        expect(send).toHaveBeenCalledOnce();
    });

    it('ignores old-generation and foreign-session Stop without affecting the current mode', async () => {
        await bridge.command(10, request('start'), send);
        await bridge.command(10, request('stop', { requestId: 'stale' }), send);
        await bridge.command(10, request('stop', { sessionKey: 'another-clone/workspace' }), send);
        expect(manager.stopAnnotation).not.toHaveBeenCalled();
        sinks[0].events([]);
        expect(send).toHaveBeenCalledOnce();
    });

    it('revokes delivery as soon as Stop starts and returns false for late startup', async () => {
        let finishStart!: (value: boolean) => void;
        let finishStop!: () => void;
        manager.startAnnotation.mockImplementation((_o, _v, _s, sink) => {
            sinks.push(sink);
            return new Promise<boolean>(resolve => { finishStart = resolve; });
        });
        manager.stopAnnotation.mockImplementation(() => new Promise<void>(resolve => { finishStop = resolve; }));
        const starting = bridge.command(10, request('start'), send);
        const stopping = bridge.command(10, request('stop'), send);
        sinks[0].events([]);
        expect(send).not.toHaveBeenCalled();
        finishStart(true);
        expect(await starting).toBe(false);
        finishStop();
        await stopping;
    });

    it('cannot erase a replacement with late startup, events, termination or Stop completion', async () => {
        let finishStart!: (value: boolean) => void;
        let finishStop!: () => void;
        manager.startAnnotation.mockImplementationOnce((_o, _v, _s, sink) => {
            sinks.push(sink);
            return new Promise<boolean>(resolve => { finishStart = resolve; });
        });
        manager.stopAnnotation.mockImplementationOnce(() => new Promise<void>(resolve => { finishStop = resolve; }));
        const starting = bridge.command(10, request('start'), send);
        const stopping = bridge.command(10, request('stop'), send);
        sinks[0].ended('stop');
        expect(await bridge.command(10, request('start', { requestId: 'replacement' }), send)).toBe(true);
        finishStart(true);
        expect(await starting).toBe(false);
        finishStop();
        await stopping;
        sinks[0].events([]);
        sinks[0].ended('failed');
        sinks[1].events([]);
        expect(send.mock.calls).toEqual([
            [{ ...identity, type: 'ended', reason: 'stop' }],
            [{ ...identity, requestId: 'replacement', type: 'events', events: [] }],
        ]);
    });

    it.each(['clearOwner', 'dispose'] as const)('revokes pending startup and old-document notifications on %s', async action => {
        let finish!: (value: boolean) => void;
        manager.startAnnotation.mockImplementationOnce((_o, _v, _s, sink) => {
            sinks.push(sink);
            return new Promise<boolean>(resolve => { finish = resolve; });
        });
        const starting = bridge.command(10, request('start'), send);
        if (action === 'clearOwner') bridge.clearOwner(10); else bridge.dispose();
        await bridge.command(10, request('start', { requestId: 'replacement' }), send);
        sinks[0].events([]);
        sinks[0].ended('stop');
        finish(true);
        expect(await starting).toBe(false);
        sinks[1].events([]);
        expect(send).toHaveBeenCalledOnce();
        expect(send.mock.calls[0][0].requestId).toBe('replacement');
    });

    it('routes pin removal only to the current owner, view, workspace and generation', async () => {
        await bridge.command(10, request('start'), send);
        for (const [owner, fields] of [[11, {}], [10, { viewId: 'other' }],
            [10, { sessionKey: 'other/workspace' }], [10, { requestId: 'old' }]] as const) {
            await bridge.command(owner, request('remove', { id: '1', ...fields }), send);
        }
        expect(manager.removeAnnotation).not.toHaveBeenCalled();
        await bridge.command(10, request('remove', { id: '1' }), send);
        expect(manager.removeAnnotation).toHaveBeenCalledExactlyOnceWith(10, identity.viewId, identity.sessionKey, '1');
        sinks[0].events([{ type: 'delete', id: '1' }]);
        expect(send).toHaveBeenLastCalledWith({ ...identity, type: 'events', events: [{ type: 'delete', id: '1' }] });
        await bridge.command(10, request('stop'), send);
        await bridge.command(10, request('start', { requestId: 'replacement' }), send);
        await bridge.command(10, request('remove', { id: '1' }), send);
        expect(manager.removeAnnotation).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, null, 1, '', '0', '01', '-1', '1.5', '9007199254740992'])('rejects malformed removal ID %j', async id => {
        await bridge.command(10, request('start'), send);
        await expect(bridge.command(10, request('remove', { id }), send)).rejects.toThrow(TypeError);
        expect(manager.removeAnnotation).not.toHaveBeenCalled();
    });

    it('ignores removal during Stop or after owner revocation and preserves removal errors', async () => {
        await bridge.command(10, request('start'), send);
        manager.removeAnnotation.mockRejectedValueOnce(new Error('Guest failure'));
        await expect(bridge.command(10, request('remove', { id: '1' }), send)).rejects.toThrow('Guest failure');
        manager.removeAnnotation.mockClear();
        let finish!: () => void;
        manager.stopAnnotation.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        const stopping = bridge.command(10, request('stop'), send);
        await bridge.command(10, request('remove', { id: '1' }), send);
        finish(); await stopping;
        await bridge.command(10, request('start', { requestId: 'new' }), send);
        bridge.clearOwner(10);
        await bridge.command(10, request('remove', { id: '1', requestId: 'new' }), send);
        expect(manager.removeAnnotation).not.toHaveBeenCalled();
    });

    it('forwards live policy with concrete owner/session independently of a mode', async () => {
        await bridge.command(10, { action: 'policy', sessionKey: identity.sessionKey, enabled: false }, send);
        expect(manager.setAnnotationEnabled).toHaveBeenCalledWith(10, identity.sessionKey, false);
    });

    it('preserves errors and permits explicit retry after admission or teardown failure', async () => {
        manager.startAnnotation.mockRejectedValueOnce(new Error('Takeover required'));
        await expect(bridge.command(10, request('start'), send)).rejects.toThrow('Takeover required');
        await bridge.command(10, request('start'), send);
        manager.stopAnnotation.mockRejectedValueOnce(new Error('Cleanup failed'));
        await expect(bridge.command(10, request('stop'), send)).rejects.toThrow('Cleanup failed');
        expect(await bridge.command(10, request('start', { requestId: 'retry' }), send)).toBe(true);
        sinks[0].ended('failed');
        sinks[1].events([]);
        expect(send).toHaveBeenCalledOnce();
    });
});
