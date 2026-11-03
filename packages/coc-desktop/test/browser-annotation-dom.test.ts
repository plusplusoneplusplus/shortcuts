// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBrowserAnnotationExpression, type BrowserAnnotationCommand, type BrowserAnnotationResult } from '../src/browser-annotation-dom';
import { browserAnnotationSnapshot } from '../src/browser-annotation-snapshot';

const session = 'fixture-generation';
let root: ShadowRoot;
let host: HTMLElement;
let target: HTMLElement;

function run(action: BrowserAnnotationCommand['action'], token = session): BrowserAnnotationResult {
    return window.eval(buildBrowserAnnotationExpression({ action, session: token })) as BrowserAnnotationResult;
}

function mouse(type: string, x = 20, y = 30, init: MouseEventInit = {}, recipient: EventTarget = host) {
    const event = new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y, ...init });
    recipient.dispatchEvent(event);
    return event;
}

function escape() {
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

function geometry(element: Element, x = 10.25, y = 20.5, width = 80.5, height = 30.25) {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON() {} });
}

beforeEach(() => {
    document.body.innerHTML = '<button id="target">Pick me</button>';
    target = document.querySelector<HTMLElement>('#target')!;
    geometry(target);
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
        const result = attachShadow.call(this, init);
        if (init.mode === 'closed') { root = result; host = this as HTMLElement; }
        return result;
    });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) });
});

const attachShadow = Element.prototype.attachShadow;

afterEach(() => {
    run('stop');
    run('stop', 'replacement');
    vi.restoreAllMocks();
    document.head.querySelectorAll('style').forEach(element => element.remove());
    window.history.replaceState(null, '', '/');
});

describe('shared annotation selection injection', () => {
    it('installs idempotently in a closed shadow root, with isolated styling and a maximum stacking level', () => {
        const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
        expect(run('start')).toEqual({ active: true, events: [] });
        const firstHost = host;
        expect(host.shadowRoot).toBeNull();
        expect(root.mode).toBe('closed');
        expect(host.parentElement).toBe(document.documentElement);
        expect(host.style.getPropertyValue('all')).toBe('initial');
        expect(setProperty).toHaveBeenCalledWith('all', 'initial', 'important');
        expect(host.style.zIndex).toBe('2147483647');
        expect(root.querySelector('style')?.textContent).toContain('all: initial');
        expect(run('start')).toEqual({ active: true, events: [] });
        expect(host).toBe(firstHost);
    });

    it('hit-tests behind the shield and highlights the hovered element with its tag and size', () => {
        run('start');
        vi.mocked(document.elementFromPoint).mockImplementation(() => {
            expect(host.style.display).toBe('none');
            return target;
        });
        mouse('pointermove');
        expect(document.elementFromPoint).toHaveBeenCalledWith(20, 30);
        expect(host.style.display).toBe('block');
        expect(root.querySelector<HTMLElement>('.outline')?.hidden).toBe(false);
        expect(root.querySelector<HTMLElement>('.outline')?.style.left).toBe('10.25px');
        expect(root.querySelector<HTMLElement>('.outline')?.style.width).toBe('80.5px');
        expect(root.querySelector('.label')?.textContent).toBe('button 81 x 30');
        expect(run('drain').events).toEqual([]);
        vi.mocked(document.elementFromPoint).mockReturnValue(null);
        mouse('pointermove');
        expect(root.querySelector<HTMLElement>('.outline')?.hidden).toBe(true);
    });

    it('selects an element, swallows page clicks and preserves fractional CSS coordinates', () => {
        const clicked = vi.fn();
        target.addEventListener('click', clicked);
        document.body.addEventListener('click', clicked);
        run('start');
        expect(mouse('click', 20, 30, {}, target).defaultPrevented).toBe(true);
        expect(clicked).not.toHaveBeenCalled();
        expect(run('drain')).toEqual({
            active: true,
            events: [{ type: 'selection', kind: 'element', tag: 'button', rect: { x: 10.25, y: 20.5, width: 80.5, height: 30.25 }, immediate: false, ...browserAnnotationSnapshot(target) }],
        });
        expect(run('drain').events).toEqual([]);
    });

    it.each([{ ctrlKey: true }, { metaKey: true }])('marks a modifier click for an immediate comment: %j', modifiers => {
        run('start');
        mouse('click', 20, 30, modifiers);
        expect(run('drain').events).toMatchObject([{ kind: 'element', immediate: true }]);
    });

    it('selects a reverse Shift-drag area and ignores the trailing compatibility click', () => {
        run('start');
        mouse('pointerdown', 200, 150, { shiftKey: true });
        mouse('pointermove', 40.5, 50.25, { shiftKey: true });
        expect(root.querySelector('.label')?.textContent).toBe('Area 160 x 100');
        mouse('pointerup', 40.5, 50.25, { shiftKey: true });
        mouse('click', 40.5, 50.25);
        expect(run('drain').events).toEqual([{
            type: 'selection', kind: 'area', rect: { x: 40.5, y: 50.25, width: 159.5, height: 99.75 }, immediate: false, ...browserAnnotationSnapshot(),
        }]);
    });

    it('clips area selection to the viewport and rejects tiny or cancelled drags', () => {
        run('start');
        mouse('pointerdown', 10, 20, { shiftKey: true });
        mouse('pointerup', 100000, 100000);
        expect(run('drain').events).toMatchObject([{ rect: { x: 10, y: 20, width: window.innerWidth - 10, height: window.innerHeight - 20 } }]);
        escape();
        mouse('pointerdown', 10, 20, { shiftKey: true });
        mouse('pointerup', 11, 21);
        expect(run('drain').events).toEqual([]);
        mouse('pointerdown', 10, 20, { shiftKey: true });
        mouse('pointercancel');
        mouse('pointerup', 80, 90);
        mouse('click');
        expect(run('drain').events).toEqual([]);
    });

    it('does not request immediate send for an area, even with Ctrl held', () => {
        run('start');
        mouse('pointerdown', 10, 20, { shiftKey: true, ctrlKey: true });
        mouse('pointerup', 80, 90, { ctrlKey: true });
        expect(run('drain').events).toMatchObject([{ kind: 'area', immediate: false }]);
    });

    it('ignores secondary clicks, Shift-clicks and elements outside the visible viewport', () => {
        run('start');
        mouse('click', 20, 30, { button: 2 });
        mouse('click', 20, 30, { shiftKey: true });
        geometry(target, -100, -100, 10, 10);
        mouse('click');
        expect(run('drain').events).toEqual([]);
    });

    it('snapshots metadata at selection time before the page changes or the host drains', () => {
        document.title = 'Selected page';
        target.className = 'primary action';
        Object.defineProperty(target, 'innerText', { configurable: true, value: 'Visible label' });
        run('start');
        mouse('click');
        document.title = 'Changed page';
        target.id = 'changed';
        target.remove();
        expect(run('drain').events).toMatchObject([{
            page: { title: 'Selected page', url: location.href, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio } },
            element: { selector: '#target', tag: 'button', id: 'target', classes: ['primary', 'action'], text: 'Visible label', outerHTML: '<button id="target" class="primary action">Pick me</button>' },
        }]);
        document.title = '';
    });

    it('clears stale hover geometry after resize without swallowing the next selection', () => {
        run('start');
        mouse('pointermove');
        window.dispatchEvent(new Event('resize'));
        expect(root.querySelector<HTMLElement>('.outline')?.hidden).toBe(true);
        mouse('click');
        expect(run('drain').events).toMatchObject([{ kind: 'element' }]);
    });

    it('clips element selection to the visible viewport and ancestor overflow', () => {
        const wrapper = document.createElement('div');
        wrapper.style.overflow = 'hidden';
        target.replaceWith(wrapper);
        wrapper.append(target);
        geometry(wrapper, 20, 25, 30, 20);
        run('start');
        mouse('click');
        expect(run('drain').events).toMatchObject([{ rect: { x: 20, y: 25, width: 30, height: 20 } }]);
    });

    it('finds an open-shadow target and treats an iframe as an opaque element', () => {
        const shadowHost = document.createElement('div');
        document.body.append(shadowHost);
        const shadow = shadowHost.attachShadow({ mode: 'open' });
        shadow.append(target);
        Object.defineProperty(shadow, 'elementFromPoint', { value: () => target });
        vi.mocked(document.elementFromPoint).mockReturnValue(shadowHost);
        run('start');
        mouse('click');
        expect(run('drain').events).toMatchObject([{ tag: 'button' }]);
        escape();
        const frame = document.createElement('iframe');
        document.body.append(frame);
        geometry(frame);
        vi.mocked(document.elementFromPoint).mockReturnValue(frame);
        mouse('click');
        expect(run('drain').events).toMatchObject([{ tag: 'iframe' }]);
    });

    it('keeps light-DOM fixed-position page rules outside the overlay and protects its host', () => {
        const rule = document.createElement('style');
        rule.textContent = '[style*="position: fixed"] { background: black !important; display: none !important; } .outline { background: black !important; }';
        document.head.append(rule);
        run('start');
        mouse('pointermove');
        expect(window.getComputedStyle(host).backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(window.getComputedStyle(host).display).toBe('block');
        const outline = root.querySelector<HTMLElement>('.outline')!;
        expect(outline.getRootNode()).toBe(root);
        expect(document.querySelector('.outline')).toBeNull();
        expect(root.querySelector('style')?.textContent).toContain('background: rgb(37 99 235 / 12%)');
        expect(outline.style.background).toBe('');
    });

    it.each(['mousedown', 'mouseup', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'beforeinput', 'input', 'submit', 'keydown', 'keyup'])('swallows page input %s while active and releases it on stop', name => {
        run('start');
        const listener = vi.fn();
        target.addEventListener(name, listener);
        const input = new Event(name, { bubbles: true, cancelable: true });
        target.dispatchEvent(input);
        expect(input.defaultPrevented).toBe(true);
        expect(listener).not.toHaveBeenCalled();
        run('stop');
        target.dispatchEvent(new Event(name, { bubbles: true }));
        expect(listener).toHaveBeenCalledOnce();
    });

    it('exits on Escape, removes every listener, and can restart', () => {
        run('start');
        const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
        host.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(host.isConnected).toBe(false);
        expect(run('drain')).toEqual({ active: false, events: [{ type: 'exit', reason: 'escape' }] });
        expect(Reflect.has(window, '__cocBrowserAnnotation')).toBe(false);
        expect(mouse('click', 20, 30, {}, target).defaultPrevented).toBe(false);
        expect(run('start').active).toBe(true);
    });

    it.each(['pagehide', 'beforeunload', 'hashchange', 'popstate'])('tears down on %s and stays inactive on BFCache restore', name => {
        run('start');
        window.dispatchEvent(new Event(name));
        window.dispatchEvent(new Event('pageshow'));
        expect(host.isConnected).toBe(false);
        expect(run('drain')).toEqual({ active: false, events: [{ type: 'exit', reason: 'navigation' }] });
    });

    it('fails closed on a silent URL change before handling another page click', () => {
        run('start');
        window.history.pushState(null, '', '#new-document');
        const event = mouse('click', 20, 30, {}, target);
        expect(event.defaultPrevented).toBe(false);
        expect(host.isConnected).toBe(false);
        expect(run('drain')).toEqual({ active: false, events: [{ type: 'exit', reason: 'navigation' }] });
    });

    it('disposes after a page removes its host rather than leaving swallowing listeners installed', async () => {
        run('start');
        host.remove();
        await Promise.resolve();
        expect(run('drain')).toEqual({ active: false, events: [{ type: 'exit', reason: 'removed' }] });
        expect(mouse('click', 20, 30, {}, target).defaultPrevented).toBe(false);
    });

    it('rejects stale drains and stops without affecting the replacement mode', () => {
        run('start');
        const previous = host;
        run('start', 'replacement');
        expect(previous.isConnected).toBe(false);
        expect(run('stop')).toEqual({ active: false, events: [] });
        mouse('click');
        expect(run('drain')).toEqual({ active: false, events: [] });
        expect(run('drain', 'replacement')).toMatchObject({ active: true, events: [{ type: 'selection' }] });
    });

    it('bounds reports and removes the overlay when the host stops draining', () => {
        run('start');
        for (let i = 0; i < 40 && host.isConnected; i++) { mouse('click', 20, 30, {}, target); escape(); }
        expect(host.isConnected).toBe(false);
        const result = run('drain');
        expect(result.active).toBe(false);
        expect(result.events).toHaveLength(33);
        expect(result.events.at(-1)).toEqual({ type: 'exit', reason: 'overflow' });
    });
});


describe('closed-shadow comment editor', () => {
    const input = () => root.querySelector<HTMLTextAreaElement>('textarea')!;
    const editor = () => root.querySelector<HTMLElement>('.editor')!;
    const save = () => root.querySelector<HTMLButtonElement>('.save')!;
    const cancel = () => root.querySelectorAll<HTMLButtonElement>('button')[1];
    const type = (value: string) => {
        input().value = value;
        return input().dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, cancelable: true }));
    };
    const clickControl = (element: Element) => {
        Object.defineProperty(root, 'elementFromPoint', { configurable: true, value: () => element });
        return mouse('click', 20, 30, {}, element);
    };
    const key = (value: string, init: KeyboardEventInit = {}) => {
        const event = new KeyboardEvent('keydown', { key: value, bubbles: true, composed: true, cancelable: true, ...init });
        (root.activeElement ?? host).dispatchEvent(event);
        return event;
    };

    it('opens and focuses an accessible editor next to the picked element without exposing it to page CSS', () => {
        run('start'); mouse('click');
        expect(editor().hidden).toBe(false);
        expect(editor().getAttribute('role')).toBe('dialog');
        expect(input().getAttribute('aria-label')).toBe('Comment');
        expect(input().maxLength).toBe(8000);
        expect(root.activeElement).toBe(input());
        expect(save().disabled).toBe(true);
        expect(editor().style.left).toBe('10.25px');
        expect(editor().style.top).toBe('58.75px');
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('clamps the editor inside the viewport near the right and bottom edges', () => {
        geometry(target, innerWidth - 40, innerHeight - 40, 30, 30);
        run('start'); mouse('click');
        expect(parseFloat(editor().style.left)).toBe(innerWidth - 300);
        expect(parseFloat(editor().style.top)).toBe(innerHeight - 198);
    });

    it('keeps native typing, composition, caret keys and user paste defaults while stopping page handlers', () => {
        run('start'); mouse('click');
        const pageInput = vi.fn();
        const names = ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'paste', 'copy', 'cut'];
        for (const name of names) window.addEventListener(name, pageInput);
        try {
            expect(key('a').defaultPrevented).toBe(false);
            expect(key('ArrowLeft').defaultPrevented).toBe(false);
            expect(key('Enter').defaultPrevented).toBe(false);
            for (const name of names.filter(name => name !== 'keydown')) {
                const event = new Event(name, { bubbles: true, composed: true, cancelable: true });
                input().dispatchEvent(event);
                expect(event.defaultPrevented).toBe(false);
            }
            expect(type('hello')).toBe(true);
            expect(save().disabled).toBe(false);
            expect(pageInput).not.toHaveBeenCalled();
            const pageEvent = new Event('input', { bubbles: true, cancelable: true });
            target.dispatchEvent(pageEvent);
            expect(pageEvent.defaultPrevented).toBe(true);
        } finally { for (const name of names) window.removeEventListener(name, pageInput); }
    });

    it('preserves pointer defaults inside the textarea without exposing them to page listeners', () => {
        run('start'); mouse('click');
        Object.defineProperty(root, 'elementFromPoint', { value: () => input() });
        const pageClick = vi.fn();
        document.addEventListener('click', pageClick);
        try {
            for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'wheel']) {
                expect(mouse(name, 20, 30, {}, input()).defaultPrevented).toBe(false);
            }
            expect(pageClick).not.toHaveBeenCalled();
        } finally { document.removeEventListener('click', pageClick); }
    });

    it.each([{ ctrlKey: true }, { metaKey: true }, {}])('saves original metadata and the full comment once, with modifier intent %j', modifiers => {
        run('start'); mouse('click', 20, 30, modifiers);
        const selection = run('drain').events[0];
        const value = '  Please fix this\n<script>untrusted text</script>  ';
        type(value);
        target.textContent = 'Changed';
        document.title = 'New title';
        clickControl(save());
        expect(run('drain')).toEqual({ active: true, events: [{ type: 'comment', comment: value, selection }] });
        expect(editor().hidden).toBe(true);
        expect(input().value).toBe('');
        expect(document.activeElement).toBe(host);
        expect(run('drain').events).toEqual([]);
        document.title = '';
    });

    it.each([['empty', ''], ['whitespace', '   \n'], ['oversized', 'x'.repeat(8001)]])('refuses %s drafts', (_name, value) => {
        run('start'); mouse('click'); run('drain');
        type(value);
        expect(save().disabled).toBe(true);
        clickControl(save());
        expect(editor().hidden).toBe(false);
        expect(run('drain').events).toEqual([]);
    });

    it('accepts a comment exactly at the 8000-unit limit without trimming or truncation', () => {
        run('start'); mouse('click'); run('drain');
        const value = ' ' + '😀'.repeat(3999) + ' ';
        type(value);
        expect(value.length).toBe(8000);
        expect(save().disabled).toBe(false);
        clickControl(save());
        expect(run('drain').events).toMatchObject([{ type: 'comment', comment: value }]);
    });

    it('saves an area with its original fractional rectangle and no immediate-send intent', () => {
        run('start');
        mouse('pointerdown', 10.5, 20.5, { shiftKey: true });
        mouse('pointerup', 100.75, 70.75);
        const selection = run('drain').events[0];
        type('This region'); clickControl(save());
        expect(run('drain').events).toEqual([{ type: 'comment', comment: 'This region', selection }]);
        expect(selection).toMatchObject({ kind: 'area', immediate: false, rect: { x: 10.5, y: 20.5, width: 90.25, height: 50.25 } });
    });

    it('keeps the draft and selection fixed when clicking or dragging outside the editor', () => {
        run('start'); mouse('click'); run('drain'); type('Keep this');
        mouse('pointermove', 200, 200);
        mouse('click', 200, 200, {}, target);
        mouse('pointerdown', 200, 200, { shiftKey: true });
        mouse('pointerup', 300, 300);
        expect(input().value).toBe('Keep this');
        expect(root.querySelector('.label')?.textContent).toBe('button 81 x 30');
        expect(run('drain').events).toEqual([]);
    });

    it('Cancel discards the draft and permits another selection', () => {
        run('start'); mouse('click'); run('drain'); type('Discard');
        clickControl(cancel());
        expect(run('drain')).toEqual({ active: true, events: [] });
        expect(editor().hidden).toBe(true);
        expect(input().value).toBe('');
        mouse('click', 20, 30, {}, target);
        expect(editor().hidden).toBe(false);
        expect(input().value).toBe('');
    });

    it('first Escape closes the editor; a second press exits, while key repeat does not', () => {
        run('start'); mouse('click'); run('drain'); type('Discard');
        expect(key('Escape').defaultPrevented).toBe(true);
        expect(editor().hidden).toBe(true);
        expect(run('drain')).toEqual({ active: true, events: [] });
        key('Escape', { repeat: true });
        expect(run('drain')).toEqual({ active: true, events: [] });
        key('Escape');
        expect(run('drain')).toEqual({ active: false, events: [{ type: 'exit', reason: 'escape' }] });
    });

    it('traps Tab in editor controls, skips disabled Save and supports keyboard Save and Cancel', () => {
        run('start'); mouse('click'); run('drain');
        expect(key('Tab').defaultPrevented).toBe(true);
        expect(root.activeElement).toBe(cancel());
        key('Tab'); expect(root.activeElement).toBe(input());
        key('Tab', { shiftKey: true }); expect(root.activeElement).toBe(cancel());
        key('Tab'); type('Keyboard save');
        key('Tab'); expect(root.activeElement).toBe(save());
        key('Enter');
        expect(run('drain').events).toMatchObject([{ type: 'comment', comment: 'Keyboard save' }]);
        mouse('click'); run('drain');
        key('Tab'); key(' ');
        expect(editor().hidden).toBe(true);
        expect(run('drain').events).toEqual([]);
    });

    it.each(['stop', 'pagehide', 'removed'])('removes an open editor and releases input on %s', async reason => {
        run('start'); mouse('click'); run('drain'); type('Private draft');
        if (reason === 'stop') run('stop');
        else if (reason === 'removed') { host.remove(); await Promise.resolve(); }
        else window.dispatchEvent(new Event(reason));
        expect(host.isConnected).toBe(false);
        expect(input().value).toBe('');
        expect(mouse('click', 20, 30, {}, target).defaultPrevented).toBe(false);
    });
});
