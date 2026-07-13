/**
 * Unit tests for find-in-page (Ctrl+F / Cmd+F) support.
 *
 * The module is electron-free, so we can assert the pure count formatter and
 * the IPC channel names directly, and drive both generated scripts against
 * minimal DOM/window stubs:
 *   - the SPA-side shortcut script: opens the bar ONLY when the keydown wasn't
 *     already handled (defaultPrevented) by the SPA's own search;
 *   - the find-bar page script (runs in its own WebContentsView): typing,
 *     Enter/Shift+Enter, prev/next, Escape-close, and match counts.
 *
 * REGRESSION (bar lives outside the page): an in-page bar fought the find it
 * drove — the query matched its own input (+1 counts), find activation stole
 * focus mid-typing, editing clobbered the caret, and stopping wiped it. The
 * WebContentsView bar is immune by construction; these tests pin the IPC
 * behavior that architecture relies on.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    formatFindCount,
    buildFindShortcutScript,
    buildFindBarPageScript,
    buildFindBarHtml,
    FIND_IN_PAGE_CHANNEL,
    STOP_FIND_IN_PAGE_CHANNEL,
    FIND_RESULT_CHANNEL,
    OPEN_FIND_BAR_CHANNEL,
    CLOSE_FIND_BAR_CHANNEL,
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
        const channels = [
            FIND_IN_PAGE_CHANNEL,
            STOP_FIND_IN_PAGE_CHANNEL,
            FIND_RESULT_CHANNEL,
            OPEN_FIND_BAR_CHANNEL,
            CLOSE_FIND_BAR_CHANNEL,
        ];
        expect(new Set(channels).size).toBe(channels.length);
        for (const c of channels) {
            expect(c.startsWith('coc-desktop:')).toBe(true);
        }
    });
});

// --- Minimal DOM/window harnesses for the generated scripts --------------------

interface FakeEl {
    id: string;
    style: Record<string, string>;
    textContent: string;
    value: string;
    addEventListener: (type: string, cb: (e: unknown) => void) => void;
    dispatch: (type: string, e: unknown) => void;
    focus: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
}

function makeEl(id: string): FakeEl {
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    return {
        id,
        style: {},
        textContent: '',
        value: '',
        addEventListener(type, cb) {
            (listeners[type] ||= []).push(cb);
        },
        dispatch(type, e) {
            (listeners[type] || []).forEach((f) => f(e));
        },
        focus: vi.fn(),
        select: vi.fn(),
    };
}

describe('buildFindShortcutScript (SPA side)', () => {
    interface ShortcutHarness {
        win: Record<string, unknown>;
        openBar: ReturnType<typeof vi.fn>;
        keydown: (e: unknown) => void;
    }

    function runShortcut(withApi = true): ShortcutHarness {
        const winListeners: Record<string, Array<(e: unknown) => void>> = {};
        const openBar = vi.fn();
        const win: Record<string, unknown> = {
            addEventListener(type: string, cb: (e: unknown) => void) {
                (winListeners[type] ||= []).push(cb);
            },
        };
        if (withApi) {
            win.cocDesktop = { find: { openBar } };
        }
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        new Function('window', buildFindShortcutScript())(win);
        return { win, openBar, keydown: (e) => (winListeners['keydown'] || []).forEach((f) => f(e)) };
    }

    it('opens the bar on Ctrl+F / Cmd+F', () => {
        const h = runShortcut();
        const e = { ctrlKey: true, metaKey: false, key: 'f', defaultPrevented: false, preventDefault: vi.fn() };
        h.keydown(e);
        expect(h.openBar).toHaveBeenCalledTimes(1);
        expect(e.preventDefault).toHaveBeenCalled();
        h.keydown({ ctrlKey: false, metaKey: true, key: 'F', defaultPrevented: false, preventDefault: vi.fn() });
        expect(h.openBar).toHaveBeenCalledTimes(2);
    });

    it('defers to the SPA when the keydown was already handled', () => {
        const h = runShortcut();
        const e = { ctrlKey: true, metaKey: false, key: 'f', defaultPrevented: true, preventDefault: vi.fn() };
        h.keydown(e);
        expect(h.openBar).not.toHaveBeenCalled();
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('ignores other keydowns', () => {
        const h = runShortcut();
        h.keydown({ ctrlKey: true, metaKey: false, key: 'g', defaultPrevented: false, preventDefault: vi.fn() });
        h.keydown({ ctrlKey: false, metaKey: false, key: 'f', defaultPrevented: false, preventDefault: vi.fn() });
        expect(h.openBar).not.toHaveBeenCalled();
    });

    it('bails out cleanly when the preload find bridge is absent', () => {
        const h = runShortcut(false);
        expect(h.win.__cocFindShortcutInstalled).toBeUndefined();
    });

    it('is idempotent — a second injection is a no-op', () => {
        const addEventListener = vi.fn();
        const win: Record<string, unknown> = {
            __cocFindShortcutInstalled: true,
            cocDesktop: { find: { openBar: vi.fn() } },
            addEventListener,
        };
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        new Function('window', buildFindShortcutScript())(win);
        expect(addEventListener).not.toHaveBeenCalled();
    });
});

describe('buildFindBarPageScript (bar page)', () => {
    interface BarHarness {
        input: FakeEl;
        count: FakeEl;
        prev: FakeEl;
        next: FakeEl;
        close: FakeEl;
        win: Record<string, unknown>;
        query: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        closeBar: ReturnType<typeof vi.fn>;
        onResultCb: (r: { activeMatchOrdinal: number; matches: number }) => void;
        focusBar: () => void;
    }

    function runBar(): BarHarness {
        const els: Record<string, FakeEl> = {
            'find-input': makeEl('find-input'),
            'find-count': makeEl('find-count'),
            'find-prev': makeEl('find-prev'),
            'find-next': makeEl('find-next'),
            'find-close': makeEl('find-close'),
        };
        const doc = { getElementById: (id: string) => els[id] };
        const query = vi.fn();
        const stop = vi.fn();
        const closeBar = vi.fn();
        let onResultCb: BarHarness['onResultCb'] = () => {};
        const win: Record<string, unknown> = {
            cocDesktop: {
                find: {
                    query,
                    stop,
                    closeBar,
                    onResult: (cb: BarHarness['onResultCb']) => {
                        onResultCb = cb;
                        return () => {};
                    },
                },
            },
        };
        const immediate = (fn: () => void) => {
            fn();
            return 0;
        };
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        new Function('window', 'document', 'setTimeout', 'clearTimeout', buildFindBarPageScript())(
            win, doc, immediate, () => {},
        );
        return {
            input: els['find-input'],
            count: els['find-count'],
            prev: els['find-prev'],
            next: els['find-next'],
            close: els['find-close'],
            win,
            query,
            stop,
            closeBar,
            get onResultCb() {
                return onResultCb;
            },
            focusBar: () => (win.__cocFindBarFocus as () => void)(),
        } as BarHarness;
    }

    // REGRESSION: Electron findInPage semantics — findNext:true BEGINS a new
    // find session, findNext:false advances within it. These were once
    // inverted, so typing never started a session and Enter couldn't advance.
    it('typing a query starts a NEW find session (findNext: true)', () => {
        const h = runBar();
        h.input.value = 'needle';
        h.input.dispatch('input', {});
        expect(h.query).toHaveBeenCalledWith('needle', { findNext: true, forward: true });
    });

    it('Enter / Shift+Enter advance within the session (findNext: false)', () => {
        const h = runBar();
        h.input.value = 'needle';
        h.input.dispatch('keydown', { key: 'Enter', shiftKey: false, preventDefault: vi.fn() });
        expect(h.query).toHaveBeenLastCalledWith('needle', { findNext: false, forward: true });
        h.input.dispatch('keydown', { key: 'Enter', shiftKey: true, preventDefault: vi.fn() });
        expect(h.query).toHaveBeenLastCalledWith('needle', { findNext: false, forward: false });
    });

    it('prev/next buttons advance within the session (findNext: false)', () => {
        const h = runBar();
        h.input.value = 'needle';
        h.prev.dispatch('click', {});
        expect(h.query).toHaveBeenLastCalledWith('needle', { findNext: false, forward: false });
        h.next.dispatch('click', {});
        expect(h.query).toHaveBeenLastCalledWith('needle', { findNext: false, forward: true });
    });

    it('clearing the query stops the find instead of querying', () => {
        const h = runBar();
        h.input.value = '';
        h.input.dispatch('input', {});
        expect(h.stop).toHaveBeenCalled();
        expect(h.query).not.toHaveBeenCalled();
        expect(h.count.textContent).toBe('');
    });

    it('Escape and the close button ask the host to close the bar', () => {
        const h = runBar();
        h.input.dispatch('keydown', { key: 'Escape', preventDefault: vi.fn() });
        expect(h.closeBar).toHaveBeenCalledTimes(1);
        h.close.dispatch('click', {});
        expect(h.closeBar).toHaveBeenCalledTimes(2);
    });

    it('Ctrl+F inside the bar reselects the query', () => {
        const h = runBar();
        const e = { ctrlKey: true, metaKey: false, key: 'f', preventDefault: vi.fn() };
        h.input.dispatch('keydown', e);
        expect(e.preventDefault).toHaveBeenCalled();
        expect(h.input.focus).toHaveBeenCalled();
        expect(h.input.select).toHaveBeenCalled();
    });

    it('renders the match count from results; blank when the query is empty', () => {
        const h = runBar();
        h.input.value = 'needle';
        h.onResultCb({ activeMatchOrdinal: 2, matches: 5 });
        expect(h.count.textContent).toBe('2/5');
        h.onResultCb({ activeMatchOrdinal: 0, matches: 0 });
        expect(h.count.textContent).toBe('No results');
        h.input.value = '';
        h.onResultCb({ activeMatchOrdinal: 1, matches: 1 });
        expect(h.count.textContent).toBe('');
    });

    it('__cocFindBarFocus focuses, selects, and re-runs a present query as a new session', () => {
        const h = runBar();
        h.input.value = 'needle';
        h.focusBar();
        expect(h.input.focus).toHaveBeenCalled();
        expect(h.input.select).toHaveBeenCalled();
        expect(h.query).toHaveBeenLastCalledWith('needle', { findNext: true, forward: true });
    });

    it('__cocFindBarFocus with an empty query does not search', () => {
        const h = runBar();
        h.focusBar();
        expect(h.query).not.toHaveBeenCalled();
    });
});

describe('buildFindBarHtml', () => {
    it('contains the controls the page script binds to, and the script itself', () => {
        const html = buildFindBarHtml();
        for (const id of ['find-input', 'find-count', 'find-prev', 'find-next', 'find-close']) {
            expect(html).toContain(`id="${id}"`);
        }
        expect(html).toContain('<script>');
        expect(html).toContain('__cocFindBarFocus');
    });
});
