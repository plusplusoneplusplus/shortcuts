import { describe, expect, it, vi } from 'vitest';
import { isBrowserControlRelease, lazyBrowserControl, type BrowserControl } from '../src/browser-control-engine';

function engine(name: string): BrowserControl & { name: string } {
    return {
        name,
        async mouse() {}, async key() {}, async insertText() {},
        async evaluate() { return { value: this.name }; },
        async callOnFrameOwner() { return undefined; },
        async createIsolatedWorld() { return 1; }, async addDocumentStartScript() { return 's'; }, async removeDocumentStartScript() {},
        async frameTree() { return { frame: { id: 'main' } }; },
        async enableFrameEvents() {}, async disableFrameEvents() {}, async enableContextEvents() {}, async disableContextEvents() {},
        async setChildFrameAttach() {}, async detachTarget() {},
        async layoutMetrics() { return { clientWidth: 1, clientHeight: 1, pageX: 0, pageY: 0 }; },
        async screenshot() { return ''; }, async setFocusEmulation() {},
        onEvent: vi.fn(() => () => {}),
    };
}

describe('lazy browser control', () => {
    it('resolves the engine on every call and keeps its this binding', async () => {
        let current = engine('first');
        const control = lazyBrowserControl(() => current);
        expect(await control.evaluate('1')).toEqual({ value: 'first' });
        current = engine('second');
        expect(await control.evaluate('1')).toEqual({ value: 'second' });
    });

    it('checks every call before dispatch, tells releases apart and lets event subscription bypass the check', async () => {
        const target = engine('view');
        const before = vi.fn((call: keyof BrowserControl, args: readonly unknown[]) => {
            if (!isBrowserControlRelease(call, args)) throw new Error('cancelled');
        });
        const control = lazyBrowserControl(() => target, before);
        await expect(control.mouse({ type: 'down', x: 1, y: 1 })).rejects.toThrow('cancelled');
        await expect(control.key({ type: 'down', key: 'a' })).rejects.toThrow('cancelled');
        await expect(control.evaluate('1')).rejects.toThrow('cancelled');
        await expect(control.mouse({ type: 'up', x: 1, y: 1 })).resolves.toBeUndefined();
        await expect(control.key({ type: 'up', key: 'a' })).resolves.toBeUndefined();
        control.onEvent(() => {});
        await control.waitForEvents!();
        expect(target.onEvent).toHaveBeenCalledOnce();
        expect(before).toHaveBeenCalledTimes(5);
    });

    it('rejects, not throws, when the engine is gone', async () => {
        const control = lazyBrowserControl(() => { throw new Error('Browser tab closed'); });
        const reply = control.evaluate('1');
        await expect(reply).rejects.toThrow('Browser tab closed');
    });
});
