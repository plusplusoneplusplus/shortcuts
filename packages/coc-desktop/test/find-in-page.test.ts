/**
 * Unit tests for find-in-page (Ctrl+F / Cmd+F) support.
 *
 * The module is electron-free, so we can assert the pure count formatter and the
 * IPC channel names directly, and drive the injected find-bar script against a
 * minimal DOM/window stub to verify the behaviour that actually matters:
 *   - Ctrl+F / Cmd+F opens the bar,
 *   - but ONLY when the keydown wasn't already handled (defaultPrevented) by the
 *     SPA's own search — the anti-conflict guard,
 *   - Escape closes it and clears the selection,
 *   - and match counts render from `found-in-page` results.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    formatFindCount,
    buildFindBarScript,
    FIND_IN_PAGE_CHANNEL,
    STOP_FIND_IN_PAGE_CHANNEL,
    FIND_RESULT_CHANNEL,
} from '../src/find-in-page';

describe('formatFindCount', () => {
    it('renders active/total for a normal match', () => {
        expect(formatFindCount(3, 12)).toBe('3/12');
        expect(formatFindCount(1, 1)).toBe('1/1');
    });

    it('reads "No results" when there are zero matches', () => {
        expect(formatFindCount(0, 0)).toBe('No results');
    });

    it('treats missing/negative totals as no results', () => {
        expect(formatFindCount(0, undefined as unknown as number)).toBe('No results');
        expect(formatFindCount(0, -1)).toBe('No results');
    });
});

describe('IPC channel names', () => {
    it('are distinct and namespaced', () => {
        const channels = [FIND_IN_PAGE_CHANNEL, STOP_FIND_IN_PAGE_CHANNEL, FIND_RESULT_CHANNEL];
        expect(new Set(channels).size).toBe(3);
        for (const c of channels) {
            expect(c.startsWith('coc-desktop:')).toBe(true);
        }
    });
});

// --- Minimal DOM/window harness for the injected script ------------------------

interface FakeEl {
    tag: string;
    style: Record<string, string>;
    parentNode: FakeEl | null;
    textContent: string;
    value: string;
    type: string;
    children: FakeEl[];
    setAttribute: (k: string, v: string) => void;
    appendChild: (c: FakeEl) => void;
    addEventListener: (type: string, cb: (e: unknown) => void) => void;
    dispatch: (type: string, e: unknown) => void;
    focus: () => void;
    select: () => void;
}

function makeEl(tag: string): FakeEl {
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    return {
        tag,
        style: {},
        parentNode: null,
        textContent: '',
        value: '',
        type: '',
        children: [],
        setAttribute: () => {},
        appendChild(c: FakeEl) {
            this.children.push(c);
            c.parentNode = this;
        },
        addEventListener(type, cb) {
            (listeners[type] ||= []).push(cb);
        },
        dispatch(type, e) {
            (listeners[type] || []).forEach((f) => f(e));
        },
        focus: () => {},
        select: () => {},
    };
}

interface Harness {
    created: FakeEl[];
    body: FakeEl;
    winKeydown: (e: unknown) => void;
    onResultCb: (r: { activeMatchOrdinal: number; matches: number }) => void;
    query: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    el: (tag: string) => FakeEl;
}

function runFindBar(): Harness {
    const created: FakeEl[] = [];
    const body = makeEl('body');
    const doc = {
        body,
        createElement: (tag: string) => {
            const el = makeEl(tag);
            created.push(el);
            return el;
        },
    };
    const winListeners: Record<string, Array<(e: unknown) => void>> = {};
    const query = vi.fn();
    const stop = vi.fn();
    let onResultCb: (r: { activeMatchOrdinal: number; matches: number }) => void = () => {};
    const win: Record<string, unknown> = {
        cocDesktop: {
            find: {
                query,
                stop,
                onResult: (cb: typeof onResultCb) => {
                    onResultCb = cb;
                    return () => {};
                },
            },
        },
        addEventListener(type: string, cb: (e: unknown) => void) {
            (winListeners[type] ||= []).push(cb);
        },
    };

    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const run = new Function('window', 'document', 'setTimeout', 'clearTimeout', buildFindBarScript());
    run(win, doc, setTimeout, clearTimeout);

    return {
        created,
        body,
        winKeydown: (e) => (winListeners['keydown'] || []).forEach((f) => f(e)),
        get onResultCb() {
            return onResultCb;
        },
        query,
        stop,
        el: (tag: string) => created.find((c) => c.tag === tag)!,
    } as Harness;
}

describe('buildFindBarScript (functional)', () => {
    it('is idempotent — a second injection is a no-op', () => {
        const win: Record<string, unknown> = { __cocFindBarInstalled: true };
        const createElement = vi.fn();
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        const run = new Function('window', 'document', 'setTimeout', 'clearTimeout', buildFindBarScript());
        run(win, { body: null, createElement }, setTimeout, clearTimeout);
        expect(createElement).not.toHaveBeenCalled();
    });

    it('bails out cleanly when the preload find bridge is absent', () => {
        const win: Record<string, unknown> = {};
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        const run = new Function('window', 'document', 'setTimeout', 'clearTimeout', buildFindBarScript());
        expect(() =>
            run(win, { body: null, createElement: () => makeEl('x') }, setTimeout, clearTimeout),
        ).not.toThrow();
        expect(win.__cocFindBarInstalled).toBeUndefined();
    });

    it('opens the bar on Ctrl+F', () => {
        const h = runFindBar();
        const bar = h.el('div');
        // Closed initially — the script hides it via cssText, not style.display.
        expect(bar.style.display).not.toBe('flex');
        expect(bar.parentNode).toBeNull();
        const e = { ctrlKey: true, metaKey: false, key: 'f', defaultPrevented: false, preventDefault: vi.fn() };
        h.winKeydown(e);
        expect(e.preventDefault).toHaveBeenCalled();
        expect(bar.style.display).toBe('flex');
        expect(bar.parentNode).toBe(h.body);
    });

    it('opens the bar on Cmd+F (macOS metaKey)', () => {
        const h = runFindBar();
        const bar = h.el('div');
        const e = { ctrlKey: false, metaKey: true, key: 'f', defaultPrevented: false, preventDefault: vi.fn() };
        h.winKeydown(e);
        expect(e.preventDefault).toHaveBeenCalled();
        expect(bar.style.display).toBe('flex');
    });

    it('defers to the SPA when the keydown was already handled', () => {
        const h = runFindBar();
        const bar = h.el('div');
        const e = { ctrlKey: true, metaKey: false, key: 'f', defaultPrevented: true, preventDefault: vi.fn() };
        h.winKeydown(e);
        expect(e.preventDefault).not.toHaveBeenCalled();
        expect(bar.style.display).not.toBe('flex');
        expect(bar.parentNode).toBeNull();
    });

    it('renders the match count from found-in-page results while open', () => {
        const h = runFindBar();
        const input = h.el('input');
        const count = h.el('span');
        h.winKeydown({ ctrlKey: true, metaKey: false, key: 'f', defaultPrevented: false, preventDefault: vi.fn() });
        input.value = 'needle';
        h.onResultCb({ activeMatchOrdinal: 2, matches: 5 });
        expect(count.textContent).toBe('2/5');
        h.onResultCb({ activeMatchOrdinal: 0, matches: 0 });
        expect(count.textContent).toBe('No results');
    });

    it('Escape closes the bar and clears the selection', () => {
        const h = runFindBar();
        const bar = h.el('div');
        const input = h.el('input');
        h.winKeydown({ ctrlKey: true, metaKey: false, key: 'f', defaultPrevented: false, preventDefault: vi.fn() });
        expect(bar.style.display).toBe('flex');
        input.dispatch('keydown', { key: 'Escape', preventDefault: vi.fn() });
        expect(bar.style.display).toBe('none');
        expect(h.stop).toHaveBeenCalled();
    });
});
