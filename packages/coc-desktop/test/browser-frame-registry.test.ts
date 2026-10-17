import { describe, expect, it, vi } from 'vitest';
import { BrowserFrameRegistry, type BrowserCdpListener } from '../src/browser-frame-registry';

function fixture() {
    let event!: BrowserCdpListener;
    const changed = vi.fn();
    const send = vi.fn(async (method: string, _params?: Record<string, unknown>, session?: string): Promise<unknown> => {
        if (method === 'Page.getFrameTree') return { frameTree: { frame: {
            id: session ? 'child' : 'root', loaderId: 'document', securityOrigin: session ? 'http://child.test' : 'http://root.test',
        }, ...(session ? {} : { childFrames: [{ frame: { id: 'child', parentId: 'root', loaderId: 'child-document', securityOrigin: 'http://child.test' } }] }) } };
        if (method === 'Runtime.enable') event('Runtime.executionContextCreated', {
            context: { id: session ? 2 : 1, origin: session ? 'http://child.test' : 'http://root.test', auxData: { frameId: session ? 'child' : 'root', isDefault: true } },
        }, session);
        if (method === 'Runtime.evaluate') return { result: { value: String(_params?.expression).includes('document.readyState') ? true : 'fixture' } };
        return {};
    });
    const registry = new BrowserFrameRegistry(send, changed);
    const off = vi.fn();
    const start = () => registry.start(listener => { event = listener; return off; });
    return { registry, send, changed, off, start, event: (...args: Parameters<BrowserCdpListener>) => event(...args) };
}

describe('view-private browser frame contexts', () => {
    it('reports a loading document separately from an available execution context', async () => {
        const h = fixture();
        const original = h.send.getMockImplementation()!;
        h.send.mockImplementation((method, params, session) => method === 'Runtime.evaluate' && String(params?.expression).includes('document.readyState')
            ? Promise.resolve({ result: { value: false } }) : original(method, params, session));
        await h.start();
        const root = h.registry.metadata()[0];
        expect(root.status).toBe('loading');
        expect(h.registry.resolve(root.id).context).toBe(1);
    });

    it('exposes opaque bounded metadata and directs execution to the default frame context', async () => {
        const h = fixture();
        await h.start();
        const frames = h.registry.metadata();
        expect(frames).toHaveLength(2);
        expect(frames[0]).toMatchObject({ id: expect.stringMatching(/^f/), origin: 'http://root.test', status: 'ready', depth: 0 });
        expect(frames[1]).toMatchObject({ parent: frames[0].id, depth: 1 });
        expect(frames[0]).not.toHaveProperty('context');
        expect(await h.registry.evaluate('42', frames[0].id)).toBe('fixture');
        expect(h.send).toHaveBeenLastCalledWith('Runtime.evaluate', {
            expression: '42', contextId: 1, returnByValue: true, awaitPromise: false,
        }, undefined);
    });

    it('initializes only owned related iframe sessions and routes OOPIF execution privately', async () => {
        const h = fixture();
        await h.start();
        h.event('Target.attachedToTarget', { sessionId: 'private-session', targetInfo: { type: 'iframe', targetId: 'child' } });
        await h.registry.refresh();
        const child = h.registry.metadata()[1];
        await h.registry.evaluate('42', child.id);
        expect(h.send).toHaveBeenLastCalledWith('Runtime.evaluate', {
            expression: '42', contextId: 2, returnByValue: true, awaitPromise: false,
        }, 'private-session');
        h.event('Target.attachedToTarget', { sessionId: 'foreign', targetInfo: { type: 'iframe', targetId: 'foreign' } });
        await expect(h.registry.refresh()).rejects.toThrow('ancestry');
        expect(h.send.mock.calls.some(call => call[0] === 'Runtime.enable' && call[2] === 'foreign')).toBe(false);
    });

    it('authenticates an OOPIF embedding when root Page.getFrameTree omits it', async () => {
        const h = fixture();
        const original = h.send.getMockImplementation()!;
        h.send.mockImplementation(async (method, params, session) => {
            if (method === 'Page.getFrameTree' && !session) return { frameTree: {
                frame: { id: 'root', loaderId: 'document', securityOrigin: 'http://root.test' },
            } };
            if (method === 'DOM.getFrameOwner') return { backendNodeId: 7 };
            if (method === 'DOM.resolveNode') return { object: { objectId: 'private-owner-object' } };
            if (method === 'Runtime.callFunctionOn') return { result: { value: true } };
            return original(method, params, session);
        });

        await h.start();
        h.event('Target.attachedToTarget', { sessionId: 'private-session', targetInfo: { type: 'iframe', targetId: 'child' } });
        await h.registry.refresh();
        expect(h.registry.metadata()[1]).toMatchObject({ parent: h.registry.metadata()[0].id, status: 'ready' });
        const proof = h.send.mock.calls.findIndex(call => call[0] === 'Runtime.callFunctionOn');
        const childEnable = h.send.mock.calls.findIndex(call => call[0] === 'Runtime.enable' && call[2] === 'private-session');
        expect(proof).toBeGreaterThan(-1);
        expect(childEnable).toBeGreaterThan(proof);
        expect(h.send).toHaveBeenCalledWith('Runtime.releaseObject', { objectId: 'private-owner-object' }, undefined);
    });

    it('retires nested sessions when the parent detaches without child events', async () => {
        const h = fixture();
        await h.start();
        h.event('Target.attachedToTarget', { sessionId: 'parent-session', targetInfo: { type: 'iframe', targetId: 'child' } });
        await h.registry.refresh();
        h.event('Target.attachedToTarget', { sessionId: 'nested-session', targetInfo: { type: 'iframe', targetId: 'nested-child' } }, 'parent-session');
        h.event('Target.detachedFromTarget', { sessionId: 'parent-session' });
        await h.registry.refresh();
        await h.registry.stop();
        expect(h.send.mock.calls.some(call => call[0] === 'Target.detachFromTarget')).toBe(false);
        expect(h.registry.metadata()).toEqual([]);
    });

    it('rejects detached contexts and ignores isolated-world contexts', async () => {
        const h = fixture();
        await h.start();
        const root = h.registry.metadata()[0];
        h.event('Runtime.executionContextCreated', { context: { id: 99, auxData: { frameId: 'root', isDefault: false } } });
        expect(h.registry.resolve(root.id).context).toBe(1);
        h.event('Runtime.executionContextDestroyed', { executionContextId: 1 });
        await expect(h.registry.evaluate('42', root.id)).rejects.toThrow('stale frame');
        h.event('Page.frameDetached', { frameId: 'root', reason: 'remove' });
        expect(() => h.registry.resolve(root.id)).toThrow('stale frame');
    });

    it('invalidates same-document refs without losing its usable execution context', async () => {
        const h = fixture();
        await h.start();
        const first = h.registry.metadata()[0];
        h.event('Page.navigatedWithinDocument', { frameId: 'root' });
        const next = h.registry.metadata()[0];
        expect(next.id).not.toBe(first.id);
        expect(next.document).not.toBe(first.document);
        await expect(h.registry.evaluate('42', first.id)).rejects.toThrow('stale frame');
        expect(await h.registry.evaluate('42', next.id)).toBe('fixture');
        expect(h.changed).toHaveBeenCalled();
    });

    it('rejects contexts after view disposal and ignores late event resurrection', async () => {
        const h = fixture();
        await h.start();
        const first = h.registry.metadata()[0];
        h.registry.dispose();
        h.event('Page.frameNavigated', { frame: { id: 'root', loaderId: 'late' } });
        expect(h.registry.metadata()).toEqual([]);
        await expect(h.registry.evaluate('42', first.id)).rejects.toThrow('stale frame');
        expect(h.off).toHaveBeenCalledOnce();
    });

    it('rejects late results after navigation instead of publishing a prior document', async () => {
        const h = fixture();
        await h.start();
        let resolve!: (value: unknown) => void;
        h.send.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        const pending = h.registry.evaluate('42');
        h.event('Page.frameNavigated', { frame: { id: 'root', loaderId: 'replacement', securityOrigin: 'http://root.test' } });
        resolve({ result: { value: 'late' } });
        await expect(pending).rejects.toThrow('stale browser frame');
        expect(h.changed).toHaveBeenCalled();
    });

    it('bounds discovery and removes subscriptions and owned sessions when disabled', async () => {
        const h = fixture();
        await h.start();
        for (let i = 0; i < 50; i++) h.event('Page.frameAttached', { frameId: `child-${i}`, parentFrameId: 'root' });
        expect(h.registry.metadata()).toHaveLength(32);
        expect(h.registry.truncated).toBe('frame-limit');
        const first = h.registry.metadata();
        const second = h.registry.metadata(32);
        expect(second).toHaveLength(20);
        expect(second.some(frame => first.some(prior => frame.id === prior.id))).toBe(false);
        await h.registry.stop();
        expect(h.off).toHaveBeenCalledOnce();
        expect(h.registry.metadata()).toEqual([]);
        expect(h.send).toHaveBeenCalledWith('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
    });
});
