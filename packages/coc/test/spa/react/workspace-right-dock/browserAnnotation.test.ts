import { describe, expect, it, vi } from 'vitest';
import { BrowserAnnotationSession, type BrowserAnnotationNotification, type DesktopBrowserAnnotation } from '../../../../src/server/spa/client/react/shared/file-path/browser-annotation';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function fixture() {
    const listeners = new Set<(event: BrowserAnnotationNotification) => void>();
    const off = vi.fn();
    const bridge = {
        supported: true,
        start: vi.fn(async () => true), stop: vi.fn(async () => {}), setEnabled: vi.fn(async () => {}),
        onEvent: vi.fn((callback: (event: BrowserAnnotationNotification) => void) => {
            listeners.add(callback);
            return () => { listeners.delete(callback); off(); };
        }),
    } satisfies DesktopBrowserAnnotation;
    const notify = vi.fn();
    const session = new BrowserAnnotationSession(bridge, 'view-a', 'clone-workspace', notify);
    const event = (overrides = {}): BrowserAnnotationNotification => ({ ...session.identity, type: 'events', events: [], ...overrides });
    const emit = (value = event()) => { for (const listener of listeners) listener(value); };
    return { bridge, session, notify, event, emit, off, listeners };
}

describe('BrowserAnnotationSession', () => {
    it('subscribes before start and accepts events before the startup reply', async () => {
        const f = fixture();
        f.bridge.start.mockImplementation(async () => { expect(f.listeners.size).toBe(1); f.emit(); return true; });
        await expect(f.session.start()).resolves.toBe(true);
        expect(f.notify).toHaveBeenCalledWith(f.event());
        await f.session.stop();
        expect(f.bridge.stop).toHaveBeenCalledWith(f.session.identity);
        expect(f.off).toHaveBeenCalledTimes(1);
    });

    it.each(['element', 'area'] as const)('delivers %s metadata and immediate intent unchanged', async kind => {
        const f = fixture();
        await f.session.start();
        const selection = {
            type: 'selection' as const, kind, immediate: true,
            rect: { x: 1.25, y: 2.5, width: 30.75, height: 40.5 },
            page: { url: 'https://example.com', title: '<untrusted>',
                viewport: { width: 800, height: 600, devicePixelRatio: 2 } },
            ...(kind === 'element' ? { element: { selector: '#target', shadowHosts: [], tag: 'div',
                id: 'target', classes: ['content'], text: 'Rendered text', outerHTML: '<div>Rendered text</div>' } } : {}),
        };
        const notification: BrowserAnnotationNotification = { ...f.session.identity, type: 'events', events: [selection, { type: 'comment', comment: 'Please fix this', selection }] };
        f.emit(notification);
        expect(f.notify).toHaveBeenCalledWith(notification);
        expect(f.notify.mock.calls[0][0]).toBe(notification);
        await f.session.stop();
    });

    it('coalesces start and stop, with synchronous delivery revocation', async () => {
        const f = fixture();
        const start = f.session.start();
        expect(f.session.start()).toBe(start);
        await start;
        const stop = f.session.stop();
        expect(f.session.stop()).toBe(stop);
        f.emit();
        expect(f.notify).not.toHaveBeenCalled();
        await stop;
        expect(f.bridge.start).toHaveBeenCalledTimes(1);
        expect(f.bridge.stop).toHaveBeenCalledTimes(1);
        await expect(f.session.start()).resolves.toBe(false);
    });

    it.each(['viewId', 'sessionKey', 'requestId'])('rejects a notification with a foreign %s', async key => {
        const f = fixture();
        await f.session.start();
        f.emit(f.event({ [key]: 'foreign' }));
        expect(f.notify).not.toHaveBeenCalled();
        await f.session.stop();
    });

    it('does not reactivate when Stop overtakes a pending Start', async () => {
        const f = fixture();
        const pending = deferred<boolean>();
        f.bridge.start.mockReturnValue(pending.promise);
        const start = f.session.start();
        await Promise.resolve();
        const staleListener = [...f.listeners][0];
        await f.session.stop();
        staleListener(f.event());
        pending.resolve(true);
        await expect(start).resolves.toBe(false);
        expect(f.notify).not.toHaveBeenCalled();
    });

    it('never starts when stopped before invocation', async () => {
        const f = fixture();
        const start = f.session.start();
        await f.session.stop();
        await expect(start).resolves.toBe(false);
        expect(f.bridge.start).not.toHaveBeenCalled();
        expect(f.listeners.size).toBe(0);
    });

    it('handles an early ended notification and rejects the late successful reply', async () => {
        const f = fixture();
        f.bridge.start.mockImplementation(async () => {
            f.emit({ ...f.session.identity, type: 'ended', reason: 'navigation' });
            return true;
        });
        await expect(f.session.start()).resolves.toBe(false);
        expect(f.notify).toHaveBeenCalledTimes(1);
        expect(f.listeners.size).toBe(0);
        await f.session.stop();
        expect(f.bridge.stop).not.toHaveBeenCalled();
    });

    it.each(['refused', 'failed', 'unsupported'])('releases listeners on %s startup', async outcome => {
        const f = fixture();
        if (outcome === 'unsupported') f.bridge.supported = false;
        if (outcome === 'refused') f.bridge.start.mockResolvedValue(false);
        if (outcome === 'failed') f.bridge.start.mockRejectedValue(new Error('injection failed'));
        if (outcome === 'failed') await expect(f.session.start()).rejects.toThrow('injection failed');
        else await expect(f.session.start()).resolves.toBe(false);
        expect(f.listeners.size).toBe(0);
        await expect(f.session.start()).resolves.toBe(false);
    });

    it('preserves stop errors after revoking delivery', async () => {
        const f = fixture();
        await f.session.start();
        f.bridge.stop.mockRejectedValue(new Error('cleanup failed'));
        await expect(f.session.stop()).rejects.toThrow('cleanup failed');
        f.emit();
        expect(f.notify).not.toHaveBeenCalled();
        expect(f.listeners.size).toBe(0);
    });

    it('mints immutable, distinct identities for retry and other workspaces', async () => {
        const f = fixture();
        await f.session.start();
        const oldListener = [...f.listeners][0];
        await f.session.stop();
        const otherNotify = vi.fn();
        const retry = new BrowserAnnotationSession(f.bridge, 'view-a', 'other-workspace', otherNotify);
        expect(Object.isFrozen(retry.identity)).toBe(true);
        expect(retry.identity.requestId).not.toBe(f.session.identity.requestId);
        expect(retry.identity.requestId).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
        await retry.start();
        f.emit();
        oldListener(f.event());
        expect(otherNotify).not.toHaveBeenCalled();
        f.emit({ ...retry.identity, type: 'events', events: [] });
        expect(otherNotify).toHaveBeenCalledTimes(1);
        expect(f.notify).not.toHaveBeenCalled();
        await retry.stop();
    });
});
