// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserControlPage } from '../src/browser-control-page';
import type { BrowserCursorCommand } from '../src/browser-control-cursor';
import type { BrowserCdpListener } from '../src/browser-frame-registry';

interface Overlay { layer: HTMLElement; cursor: HTMLElement }
const overlay = () => (window as Window & { __cocCursorOverlay?: Overlay }).__cocCursorOverlay;
const target = { x: 10, y: 20, width: 80, height: 30, optionSteps: 1 };

/** Runs cursor expressions in jsdom, like the engine would in the top-level document. */
function fixture() {
    const events: string[] = [];
    const send = vi.fn(async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
        const expression = String(params?.expression ?? '');
        if (method === 'Runtime.evaluate' && expression.includes('__cocCursorOverlay')) {
            events.push(`cursor:${/"op":"(\w+)"/.exec(expression)![1]}`);
            return { result: { value: window.eval(expression) } };
        }
        events.push(method === 'Runtime.evaluate' ? 'evaluate' : method);
        if (method === 'Page.captureScreenshot') {
            events.push(`overlay:${overlay()?.layer.style.visibility || 'none'}`);
            return { data: 'aGVsbG8=' };
        }
        if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 } };
        if (method === 'Runtime.evaluate' && expression.includes('valueJson')) return { result: { value: { valueJson: '1', valueTruncated: false } } };
        return method === 'Runtime.evaluate' ? { result: { value: target } } : {};
    });
    return { send, events, page: new BrowserControlPage(send, 'linux') };
}

function drawn(send: ReturnType<typeof fixture>['send']): BrowserCursorCommand[] {
    return send.mock.calls.flatMap(([method, params]) => {
        const expression = String(params?.expression ?? '');
        if (method !== 'Runtime.evaluate' || !expression.includes('__cocCursorOverlay')) return [];
        return [JSON.parse(/\)\((\{.*\})\); \} catch/s.exec(expression)![1])];
    });
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.eval('delete window.__cocCursorOverlay');
    document.documentElement.querySelectorAll('coc-ai-cursor').forEach(node => node.remove());
    document.body.innerHTML = '<input id="field">';
});
afterEach(() => { vi.restoreAllMocks(); });

describe('browser control cursor overlay wiring', () => {
    it('draws nothing while the setting is off', async () => {
        const { send, page } = fixture();
        await page.click('e1');
        await page.press('Enter');
        await page.scroll('down');
        expect(drawn(send)).toEqual([]);
        expect(overlay()).toBeUndefined();
    });

    it('sends the right overlay command with view-space geometry for each shown action', async () => {
        const { send, page } = fixture();
        page.setCursorOverlay(true);
        await page.click('e1');
        await page.type('e2', 'hello');
        await page.selectOption('e3', 'Blue');
        await page.press('Enter');
        await page.scroll('up', 'e4');
        await page.scroll('down');
        expect(drawn(send)).toEqual([
            { op: 'click', point: { x: 50, y: 35 } },
            { op: 'field', rect: { x: 10, y: 20, width: 80, height: 30 }, label: 'typing…', from: { x: 50, y: 35 } },
            { op: 'field', rect: { x: 10, y: 20, width: 80, height: 30 }, label: 'Blue', from: { x: 50, y: 35 } },
            { op: 'key', key: 'Enter', from: { x: 50, y: 35 } },
            { op: 'scroll', direction: 'up', point: { x: 50, y: 35 }, from: { x: 50, y: 35 } },
            { op: 'scroll', direction: 'down', from: { x: 50, y: 35 } },
        ]);
        // The overlay call goes out before input so drawing runs alongside dispatch.
        const methods = send.mock.calls.map(([method, params]) => String(params?.expression ?? '').includes('__cocCursorOverlay') ? 'cursor' : method);
        expect(methods.slice(0, 5)).toEqual(['Runtime.evaluate', 'cursor', 'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent']);
        expect(overlay()!.cursor.style.transform).toBe('translate(50px, 35px)');
    });

    it('marks the focused editor for rich paste and adopts the page-resolved point', async () => {
        let listener!: BrowserCdpListener;
        const send = vi.fn(async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
            if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'root', loaderId: 'document' } } };
            if (method === 'Runtime.enable') listener('Runtime.executionContextCreated', { context: { id: 1, auxData: { frameId: 'root', isDefault: true } } });
            if (method === 'Runtime.evaluate') {
                const expression = String(params?.expression);
                if (expression.includes('__cocCursorOverlay')) return { result: { value: window.eval(expression) } };
                if (expression.includes('"action":"snapshot"')) return { result: { value: { title: 'T', url: 'https://fixture.test/', elements: [{ ref: 'e1', role: 'textbox', name: 'Editor', depth: 0 }], nextRef: 2 } } };
                return { result: { value: true } };
            }
            return {};
        });
        const page = new BrowserControlPage(send, 'linux');
        await page.configureFrames(true, callback => { listener = callback; return () => {}; });
        await page.snapshot();
        const field = document.getElementById('field')!;
        vi.spyOn(field, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 200, width: 40, height: 20 } as DOMRect);
        field.focus();
        page.setCursorOverlay(true);
        await page.pasteHtml('e1', () => {}, new AbortController().signal);
        const cursor = drawn(send);
        expect(cursor).toEqual([{ op: 'field', label: 'pasting…' }]);
        expect(send.mock.calls.find(([, params]) => String(params?.expression).includes('__cocCursorOverlay'))![1]).toMatchObject({ contextId: 1 });
        expect(overlay()!.cursor.style.transform).toBe('translate(120px, 210px)');
        expect(document.activeElement).toBe(field);
        await page.press('Enter');
        expect(drawn(send).at(-1)).toEqual({ op: 'key', key: 'Enter', from: { x: 120, y: 210 } });
        page.dispose();
    });

    it('hides the overlay for agent screenshots and restores it after', async () => {
        const { events, page } = fixture();
        page.setCursorOverlay(true);
        await page.click('e1');
        events.length = 0;
        await page.screenshot();
        await vi.waitFor(() => expect(events).toContain('cursor:show'));
        expect(events.slice(events.indexOf('cursor:hide'))).toEqual(['cursor:hide', 'Page.captureScreenshot', 'overlay:hidden', 'cursor:show']);
        expect(overlay()!.layer.style.visibility).toBe('visible');
    });

    it('hides a key chip drawn before the cursor has any point', async () => {
        const { events, page } = fixture();
        page.setCursorOverlay(true);
        await page.press('Enter');
        await vi.waitFor(() => expect(overlay()).toBeDefined());
        events.length = 0;
        await page.screenshot();
        await vi.waitFor(() => expect(events).toContain('cursor:show'));
        expect(events.slice(events.indexOf('cursor:hide'))).toEqual(['cursor:hide', 'Page.captureScreenshot', 'overlay:hidden', 'cursor:show']);
    });

    it('does not touch the page around screenshots when nothing was drawn', async () => {
        const { events, page } = fixture();
        page.setCursorOverlay(true);
        await page.screenshot();
        expect(events.some(event => event.startsWith('cursor:'))).toBe(false);
    });

    it('removes the overlay at once when the setting turns off', async () => {
        const { send, page } = fixture();
        page.setCursorOverlay(true);
        await page.click('e1');
        page.setCursorOverlay(false);
        await vi.waitFor(() => expect(overlay()).toBeUndefined());
        expect(drawn(send).at(-1)).toEqual({ op: 'remove' });
        expect(document.querySelector('coc-ai-cursor')).toBeNull();
        page.setCursorOverlay(false);
        expect(drawn(send).filter(command => command.op === 'remove')).toHaveLength(1);
        page.setCursorOverlay(true);
        await page.press('Enter');
        expect(drawn(send).at(-1)).toEqual({ op: 'key', key: 'Enter' });
    });

    it('removes the overlay through an out-of-queue sender and redraws on the next action', async () => {
        const { send, page } = fixture();
        const raw = vi.fn((method: string, params?: Record<string, unknown>) => send(method, params));
        page.removeCursor(raw);
        expect(raw).not.toHaveBeenCalled();
        page.setCursorOverlay(true);
        await page.click('e1');
        page.removeCursor(raw);
        await vi.waitFor(() => expect(overlay()).toBeUndefined());
        expect(raw).toHaveBeenCalledOnce();
        expect(document.querySelector('coc-ai-cursor')).toBeNull();
        page.removeCursor(raw);
        expect(raw).toHaveBeenCalledOnce();
        await page.press('Enter');
        expect(drawn(send).at(-1)).toEqual({ op: 'key', key: 'Enter' });
        expect(document.querySelectorAll('coc-ai-cursor')).toHaveLength(1);
    });

    it('logs and ignores a removal the engine rejects or throws on', async () => {
        const { page } = fixture();
        page.setCursorOverlay(true);
        await page.click('e1');
        page.removeCursor(() => { throw new Error('Synthetic detached view'); });
        await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith('[coc-desktop] Browser cursor overlay failed:', 'Synthetic detached view'));
    });

    it('glides in from the last point on a new document after navigation', async () => {
        const { send, page } = fixture();
        page.setCursorOverlay(true);
        await page.click('e1');
        // A committed navigation drops the old document's overlay and state.
        window.eval('delete window.__cocCursorOverlay');
        document.querySelector('coc-ai-cursor')!.remove();
        await page.scroll('down');
        expect(drawn(send).at(-1)).toEqual({ op: 'scroll', direction: 'down', from: { x: 50, y: 35 } });
        expect(document.querySelectorAll('coc-ai-cursor')).toHaveLength(1);
        expect(overlay()!.cursor.style.transform).toBe('translate(50px, 35px)');
    });

    it('keeps the human takeover continuation stamp across drawing and removing the cursor', async () => {
        const { send, page } = fixture();
        const original = send.getMockImplementation()!;
        send.mockImplementation(async (method, params) => String(params?.expression ?? '').includes('__cocHumanContinuation')
            ? { result: { value: window.eval(String(params!.expression)) } } : original(method, params));
        window.eval('delete window.__cocHumanContinuation');
        const before = await page.continuationStamp();
        page.setCursorOverlay(true);
        await page.click('e1');
        expect(document.querySelector('coc-ai-cursor')).not.toBeNull();
        expect(await page.continuationStamp()).toBe(before);
        page.removeCursor(send);
        await vi.waitFor(() => expect(document.querySelector('coc-ai-cursor')).toBeNull());
        expect(await page.continuationStamp()).toBe(before);
        document.body.append(document.createElement('p'));
        expect(await page.continuationStamp()).not.toBe(before);
    });

    it.each(['reject', 'hang'] as const)('never fails or delays an action when overlay drawing fails (%s)', async mode => {
        const { send, page } = fixture();
        const original = send.getMockImplementation()!;
        send.mockImplementation(async (method, params) => {
            if (String(params?.expression ?? '').includes('__cocCursorOverlay')) {
                if (mode === 'reject') throw new Error('Synthetic CSP failure');
                return new Promise(() => {});
            }
            return original(method, params);
        });
        page.setCursorOverlay(true);
        await page.click('e1');
        await page.press('Enter');
        const shot = await page.screenshot();
        expect(shot.data).toBe('aGVsbG8=');
        expect(send.mock.calls.filter(([method]) => method.startsWith('Input.'))).toHaveLength(5);
        if (mode === 'reject') expect(console.warn).toHaveBeenCalledWith('[coc-desktop] Browser cursor overlay failed:', 'Synthetic CSP failure');
    });
});
