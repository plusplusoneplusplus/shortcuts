// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_CURSOR_TAG, buildBrowserCursorExpression, type BrowserCursorCommand, type BrowserCursorPoint } from '../src/browser-control-cursor';
import { buildBrowserDomExpression, type BrowserDomReadPage, type BrowserDomSnapshot } from '../src/browser-control-dom';

interface Overlay { host: HTMLElement; layer: HTMLElement; cursor: HTMLElement; point?: BrowserCursorPoint }

function draw(command: BrowserCursorCommand): BrowserCursorPoint | undefined {
    return window.eval(buildBrowserCursorExpression(command));
}

function overlay(): Overlay | undefined {
    return (window as Window & { __cocCursorOverlay?: Overlay }).__cocCursorOverlay;
}

function texts(): string[] {
    return [...overlay()!.layer.children].map(child => child.textContent ?? '').filter(Boolean);
}

beforeEach(() => {
    vi.useFakeTimers();
    draw({ op: 'remove' });
    Reflect.deleteProperty(window, '__cocBrowserControl');
    document.body.innerHTML = '<input id="field" value="hello"><select id="pick"><option>One</option></select><p>Page text</p>';
});

afterEach(() => { vi.useRealTimers(); });

describe('browser cursor overlay script', () => {
    it('injects one inert closed-shadow host without moving focus, selection or layout', () => {
        const field = document.getElementById('field') as HTMLInputElement;
        field.focus();
        field.setSelectionRange(1, 3);
        const bodyChildren = document.body.children.length;

        expect(draw({ op: 'click', point: { x: 40, y: 50 } })).toEqual({ x: 40, y: 50 });
        draw({ op: 'click', point: { x: 60, y: 70 } });

        const hosts = document.querySelectorAll(BROWSER_CURSOR_TAG);
        expect(hosts).toHaveLength(1);
        const host = hosts[0] as HTMLElement;
        expect(host.parentElement).toBe(document.documentElement);
        expect(host.shadowRoot).toBeNull();
        expect(host.getAttribute('aria-hidden')).toBe('true');
        expect(host.style.getPropertyValue('position')).toBe('fixed');
        expect(host.style.getPropertyValue('z-index')).toBe('2147483647');
        expect(host.style.getPropertyValue('pointer-events')).toBe('none');
        expect(host.style.getPropertyValue('width')).toBe('0px');
        expect(host.style.getPropertyValue('height')).toBe('0px');
        expect(document.activeElement).toBe(field);
        expect([field.selectionStart, field.selectionEnd]).toEqual([1, 3]);
        expect(document.body.children.length).toBe(bodyChildren);
    });

    it('moves the cursor to the click point and plays a ripple that ends after about 600ms', () => {
        draw({ op: 'click', point: { x: 10, y: 20 } });
        draw({ op: 'click', point: { x: 100, y: 200 } });
        const state = overlay()!;
        expect(state.cursor.style.transform).toBe('translate(100px, 200px)');
        expect(state.cursor.style.opacity).toBe('1');
        expect(state.point).toEqual({ x: 100, y: 200 });
        const ripples = [...state.layer.children].filter(child => child !== state.cursor);
        expect(ripples).toHaveLength(2);
        expect((ripples[1] as HTMLElement).style.left).toBe('84px');
        vi.advanceTimersByTime(600);
        expect([...state.layer.children]).toEqual([state.cursor]);
    });

    it('starts from the supplied last point in a new document', () => {
        expect(draw({ op: 'click', point: { x: 5, y: 6 }, from: { x: 300, y: 400 } })).toEqual({ x: 5, y: 6 });
        // An existing document point wins over the caller's remembered point.
        expect(draw({ op: 'key', key: 'Enter', from: { x: 300, y: 400 } })).toEqual({ x: 5, y: 6 });
    });

    it('highlights a field with a typing label and leaves the cursor at its centre', () => {
        draw({ op: 'field', rect: { x: 10, y: 40, width: 100, height: 20 }, label: 'typing…' });
        const state = overlay()!;
        expect(state.point).toEqual({ x: 60, y: 50 });
        const box = [...state.layer.children].find(child => (child as HTMLElement).style.width === '104px') as HTMLElement;
        expect(box.style.left).toBe('8px');
        expect(box.style.top).toBe('38px');
        expect(texts()).toEqual(['typing…']);
    });

    it('labels a selected value and truncates very long labels', () => {
        draw({ op: 'field', rect: { x: 0, y: 0, width: 50, height: 20 }, label: `Selected: ${'x'.repeat(200)}` });
        expect(texts()[0]).toHaveLength(80);
    });

    it('shows a key chip below the focused rect without moving the cursor', () => {
        draw({ op: 'click', point: { x: 7, y: 8 } });
        draw({ op: 'key', key: 'Enter', rect: { x: 20, y: 30, width: 40, height: 10 } });
        const state = overlay()!;
        expect(state.point).toEqual({ x: 7, y: 8 });
        const chip = [...state.layer.children].find(child => child.textContent === '⌨ Enter') as HTMLElement;
        expect(chip.style.left).toBe('20px');
        expect(chip.style.top).toBe('46px');
    });

    it('shows a direction arrow for scroll', () => {
        draw({ op: 'scroll', point: { x: 50, y: 60 }, direction: 'up' });
        expect(texts()).toEqual(['↑']);
        expect(overlay()!.point).toEqual({ x: 50, y: 60 });
    });

    it('fades the cursor after about 3s idle and brings it back on the next action', () => {
        draw({ op: 'click', point: { x: 1, y: 2 } });
        vi.advanceTimersByTime(2999);
        expect(overlay()!.cursor.style.opacity).toBe('1');
        vi.advanceTimersByTime(1);
        expect(overlay()!.cursor.style.opacity).toBe('0');
        draw({ op: 'key', key: 'Tab' });
        expect(overlay()!.cursor.style.opacity).toBe('1');
        expect(overlay()!.cursor.style.transform).toBe('translate(1px, 2px)');
    });

    it('hides and restores the drawing layer inside the shadow root only', () => {
        draw({ op: 'click', point: { x: 1, y: 2 } });
        const state = overlay()!;
        const hostStyle = state.host.getAttribute('style');
        expect(draw({ op: 'hide' })).toEqual({ x: 1, y: 2 });
        expect(state.layer.style.visibility).toBe('hidden');
        expect(state.host.getAttribute('style')).toBe(hostStyle);
        draw({ op: 'show' });
        expect(state.layer.style.visibility).toBe('visible');
        expect(draw({ op: 'hide' })).toEqual({ x: 1, y: 2 });
        draw({ op: 'click', point: { x: 3, y: 4 } });
        expect(state.layer.style.visibility).toBe('visible');
    });

    it('hide and show are no-ops before anything is drawn', () => {
        expect(draw({ op: 'hide' })).toBeUndefined();
        expect(draw({ op: 'show' })).toBeUndefined();
        expect(document.querySelector(BROWSER_CURSOR_TAG)).toBeNull();
    });

    it('removes the host, timers and state', () => {
        draw({ op: 'click', point: { x: 1, y: 2 } });
        const host = overlay()!.host;
        expect(draw({ op: 'remove' })).toBeUndefined();
        expect(host.isConnected).toBe(false);
        expect(overlay()).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('re-attaches a host the page removed', () => {
        draw({ op: 'click', point: { x: 1, y: 2 } });
        overlay()!.host.remove();
        draw({ op: 'click', point: { x: 3, y: 4 } });
        expect(document.querySelectorAll(BROWSER_CURSOR_TAG)).toHaveLength(1);
    });

    it('ignores non-finite geometry and never throws into the page', () => {
        expect(() => draw({ op: 'click', point: { x: Number.NaN, y: 1 } })).not.toThrow();
        expect(() => draw({ op: 'field', rect: null as never, label: 'x' })).not.toThrow();
        expect(() => draw({ op: 'scroll', point: { x: 1, y: Infinity }, direction: 'down' })).not.toThrow();
    });

    it('stays out of DOM snapshots and page reads', () => {
        draw({ op: 'click', point: { x: 1, y: 2 } });
        draw({ op: 'key', key: 'Enter' });
        for (const all of [false, true]) {
            const snapshot = window.eval(buildBrowserDomExpression({ action: 'snapshot', nextRef: 1, all })) as BrowserDomSnapshot;
            expect(JSON.stringify(snapshot)).not.toMatch(/Enter|coc-ai-cursor/);
        }
        const read = window.eval(buildBrowserDomExpression({ action: 'read', paged: true })) as BrowserDomReadPage;
        expect(read.text).toContain('Page text');
        expect(read.text).not.toContain('Enter');
    });
});
