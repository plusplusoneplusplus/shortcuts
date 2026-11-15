import { describe, expect, it, vi } from 'vitest';
import { browserControlEventFromCdp, createCdpBrowserControl, withCdpControl } from '../src/browser-cdp-control';
import type { BrowserCdpEventListener } from '../src/browser-host-contract';

function transport(reply: (method: string, params?: Record<string, unknown>, session?: string) => unknown = () => ({})) {
    const listeners = new Set<BrowserCdpEventListener>();
    const cdp = vi.fn(async (method: string, params?: Record<string, unknown>, session?: string) => reply(method, params, session));
    return {
        cdp, listeners,
        onCdpEvent: (listener: BrowserCdpEventListener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        emit: (method: string, params: Record<string, unknown>, session?: string) => { for (const listener of listeners) listener(method, params, session); },
    };
}

describe('CDP browser control adapter', () => {
    it('sends the same input commands the shared control code sent before', async () => {
        const t = transport();
        const control = createCdpBrowserControl(t);
        await control.mouse({ type: 'move', x: 1, y: 2, target: 's1' });
        await control.mouse({ type: 'down', x: 1, y: 2, button: 'left', clickCount: 1 });
        await control.mouse({ type: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: 600 });
        await control.key({ type: 'down', key: 'a', code: 'KeyA', keyCode: 65, modifiers: 4, commands: ['selectAll'] });
        await control.key({ type: 'up', key: 'a', code: 'KeyA', keyCode: 65, modifiers: 4 });
        await control.key({ type: 'char', text: 'x' });
        await control.insertText('hello');
        await control.setFocusEmulation(true);
        expect(t.cdp.mock.calls).toEqual([
            ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 2 }, 's1'],
            ['Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 2, button: 'left', clickCount: 1 }],
            ['Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1, y: 2, deltaX: 0, deltaY: 600 }],
            ['Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll'] }],
            ['Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 }],
            ['Input.dispatchKeyEvent', { type: 'char', text: 'x' }],
            ['Input.insertText', { text: 'hello' }],
            ['Emulation.setFocusEmulationEnabled', { enabled: true }],
        ]);
    });

    it('returns values, absent values and exception text from evaluation', async () => {
        const replies: unknown[] = [
            { result: { value: 3 } },
            { result: {} },
            { exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: boom' } } },
            { exceptionDetails: { text: 'Uncaught' } },
        ];
        const t = transport(() => replies.shift());
        const control = createCdpBrowserControl(t);
        expect(await control.evaluate('1+2', { context: 7, target: 's', awaitPromise: true })).toEqual({ value: 3 });
        expect(await control.evaluate('x')).toEqual({});
        expect(await control.evaluate('x')).toEqual({ exception: 'Error: boom' });
        expect(await control.evaluate('x')).toEqual({ exception: 'Uncaught' });
        expect(t.cdp.mock.calls[0]).toEqual(['Runtime.evaluate', { expression: '1+2', contextId: 7, returnByValue: true, awaitPromise: true }, 's']);
        expect(t.cdp.mock.calls[1]).toEqual(['Runtime.evaluate', { expression: 'x', returnByValue: true }]);
    });

    it('runs user source through page eval exactly as the shared page used to build it', async () => {
        const t = transport(() => ({ result: { value: 1 } }));
        const control = createCdpBrowserControl(t);
        await control.evaluate('value => value', { source: 'a = "x"; a', context: 3, awaitPromise: true });
        expect(t.cdp.mock.calls[0]).toEqual(['Runtime.evaluate', { expression: 'Promise.resolve((0, eval)("a = \\"x\\"; a")).then(value => value)',
            contextId: 3, returnByValue: true, awaitPromise: true }]);
    });

    it('calls on a frame owner and always releases the resolved object', async () => {
        const t = transport(method => method === 'DOM.getFrameOwner' ? { backendNodeId: 9 }
            : method === 'DOM.resolveNode' ? { object: { objectId: 'obj' } }
                : method === 'Runtime.callFunctionOn' ? { result: { value: true } } : {});
        const control = createCdpBrowserControl(t);
        expect(await control.callOnFrameOwner('child', { context: 4, target: 's' }, 'function(a){return a}', [1])).toEqual({ value: true });
        expect(t.cdp.mock.calls.map(([method, params, session]) => [method, params, session])).toEqual([
            ['DOM.getFrameOwner', { frameId: 'child' }, 's'],
            ['DOM.resolveNode', { backendNodeId: 9, executionContextId: 4 }, 's'],
            ['Runtime.callFunctionOn', { objectId: 'obj', functionDeclaration: 'function(a){return a}', returnByValue: true, arguments: [{ value: 1 }] }, 's'],
            ['Runtime.releaseObject', { objectId: 'obj' }, 's'],
        ]);

        const failing = transport(method => {
            if (method === 'DOM.getFrameOwner') return { backendNodeId: 9 };
            if (method === 'DOM.resolveNode') return { object: { objectId: 'obj' } };
            if (method === 'Runtime.callFunctionOn') throw new Error('gone');
            return {};
        });
        await expect(createCdpBrowserControl(failing).callOnFrameOwner('child', { context: 4 }, 'f', [])).rejects.toThrow('gone');
        expect(failing.cdp).toHaveBeenLastCalledWith('Runtime.releaseObject', { objectId: 'obj' });

        const unowned = transport(() => ({}));
        expect(await createCdpBrowserControl(unowned).callOnFrameOwner('child', { context: 4 }, 'f', [])).toBeUndefined();
    });

    it('maps frame trees, isolated worlds, layout metrics and screenshots', async () => {
        const t = transport((method) => {
            switch (method) {
                case 'Page.getFrameTree': return { frameTree: { frame: { id: 'main', securityOrigin: 'https://a.test', url: 'https://a.test/', mimeType: 'text/html', loaderId: 'L' },
                    childFrames: [{ frame: { id: 'child', parentId: 'main', name: 'n' } }] } };
                case 'Page.createIsolatedWorld': return { executionContextId: 12 };
                case 'Page.getLayoutMetrics': return { cssVisualViewport: { clientWidth: 10, clientHeight: 20, pageX: 1, pageY: 2 } };
                case 'Page.captureScreenshot': return { data: 'AAA' };
                default: return {};
            }
        });
        const control = createCdpBrowserControl(t);
        expect(await control.frameTree()).toEqual({
            frame: { id: 'main', origin: 'https://a.test', url: 'https://a.test/', mimeType: 'text/html', loaderId: 'L' },
            children: [{ frame: { id: 'child', parentId: 'main', name: 'n' } }],
        });
        expect(await control.createIsolatedWorld('main', 'world')).toBe(12);
        expect(await control.layoutMetrics()).toEqual({ clientWidth: 10, clientHeight: 20, pageX: 1, pageY: 2 });
        expect(await control.screenshot({ format: 'jpeg', quality: 75, clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 } })).toBe('AAA');
        expect(t.cdp).toHaveBeenCalledWith('Page.captureScreenshot', { format: 'jpeg', quality: 75, captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 } });
        await expect(createCdpBrowserControl(transport(() => ({}))).frameTree()).rejects.toThrow('frame tree unavailable');
        await expect(createCdpBrowserControl(transport(() => ({}))).createIsolatedWorld('main', 'w')).rejects.toThrow('Isolated world');
        await expect(createCdpBrowserControl(transport(() => ({}))).screenshot({ format: 'png', clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 } })).rejects.toThrow('no image');
    });

    it('maps frame tracking commands, including scoped child-frame auto-attach', async () => {
        const t = transport();
        const control = createCdpBrowserControl(t);
        await control.enableFrameEvents('s');
        await control.enableContextEvents();
        await control.setChildFrameAttach(true, 's');
        await control.setChildFrameAttach(false);
        await control.detachTarget('child', 's');
        await control.disableContextEvents();
        await control.disableFrameEvents();
        expect(t.cdp.mock.calls).toEqual([
            ['Page.enable', {}, 's'],
            ['Runtime.enable', {}],
            ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'iframe', exclude: false }, { exclude: true }] }, 's'],
            ['Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }],
            ['Target.detachFromTarget', { sessionId: 'child' }, 's'],
            ['Runtime.disable', undefined],
            ['Page.disable', undefined],
        ]);
    });

    it('translates CDP events and drops events control does not use', () => {
        expect(browserControlEventFromCdp('Target.attachedToTarget', { sessionId: 'c', targetInfo: { type: 'iframe', targetId: 'F' } }, 'p'))
            .toEqual({ type: 'target-attached', target: 'c', frameId: 'F', parentTarget: 'p' });
        expect(browserControlEventFromCdp('Target.attachedToTarget', { sessionId: 'c', targetInfo: { type: 'worker', targetId: 'W' } })).toBeUndefined();
        expect(browserControlEventFromCdp('Target.detachedFromTarget', { sessionId: 'c' })).toEqual({ type: 'target-detached', target: 'c' });
        expect(browserControlEventFromCdp('Page.frameAttached', { frameId: 'f', parentFrameId: 'm' }, 's'))
            .toEqual({ type: 'frame-attached', frameId: 'f', parentFrameId: 'm', target: 's' });
        expect(browserControlEventFromCdp('Page.frameNavigated', { frame: { id: 'm', url: 'https://a.test/' } }))
            .toMatchObject({ type: 'frame-navigated', frame: { id: 'm', url: 'https://a.test/' } });
        expect(browserControlEventFromCdp('Page.navigatedWithinDocument', { frameId: 'm' })).toEqual({ type: 'frame-same-document', frameId: 'm' });
        expect(browserControlEventFromCdp('Page.frameDetached', { frameId: 'f', reason: 'swap' })).toEqual({ type: 'frame-detached', frameId: 'f', swapped: true });
        expect(browserControlEventFromCdp('Page.frameDetached', { frameId: 'f', reason: 'remove' })).toEqual({ type: 'frame-detached', frameId: 'f', swapped: false });
        expect(browserControlEventFromCdp('Page.frameStartedLoading', { frameId: 'm' })).toEqual({ type: 'frame-loading', frameId: 'm' });
        expect(browserControlEventFromCdp('Page.frameStoppedLoading', { frameId: 'm' })).toEqual({ type: 'frame-stopped-loading', frameId: 'm' });
        expect(browserControlEventFromCdp('Runtime.executionContextCreated', { context: { id: 3, origin: 'https://a.test', auxData: { frameId: 'm', isDefault: true } } }, 's'))
            .toEqual({ type: 'context-created', context: 3, frameId: 'm', origin: 'https://a.test', isDefault: true, target: 's' });
        expect(browserControlEventFromCdp('Runtime.executionContextDestroyed', { executionContextId: 3 })).toEqual({ type: 'context-destroyed', context: 3 });
        expect(browserControlEventFromCdp('Runtime.executionContextsCleared', {})).toEqual({ type: 'contexts-cleared' });
        expect(browserControlEventFromCdp('Target.targetCrashed', {}, 's')).toEqual({ type: 'crashed', target: 's' });
        expect(browserControlEventFromCdp('Inspector.detached', {})).toEqual({ type: 'detached', reason: 'detached' });
        expect(browserControlEventFromCdp('Inspector.targetCrashed', {})).toEqual({ type: 'detached', reason: 'crashed' });
        expect(browserControlEventFromCdp('Network.requestWillBeSent', {})).toBeUndefined();
    });

    it('subscribes through the view transport and unsubscribes cleanly', () => {
        const t = transport();
        const view = withCdpControl({ cdp: t.cdp, onCdpEvent: t.onCdpEvent });
        const events: unknown[] = [];
        const off = view.control.onEvent(event => events.push(event));
        t.emit('Runtime.executionContextsCleared', {});
        t.emit('Network.loadingFinished', {});
        off();
        t.emit('Runtime.executionContextsCleared', {});
        expect(events).toEqual([{ type: 'contexts-cleared' }]);
        expect(t.listeners.size).toBe(0);
        expect(() => createCdpBrowserControl({ cdp: t.cdp }).onEvent(() => {})).toThrow('frame event transport unavailable');
    });
});
