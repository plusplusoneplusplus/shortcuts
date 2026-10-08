/**
 * Tests for the preload bridge.
 *
 * REGRESSION: the preload runs sandboxed, where `require` can only load the
 * 'electron' builtin. It once imported its IPC channel names from
 * './find-in-page' / './devtunnel-modal'; that relative require threw
 * "module not found" inside the sandbox, the preload died, `window.cocDesktop`
 * never existed, and the injected find bar silently bailed — Ctrl+F did
 * nothing anywhere in the desktop app. The channel names are now local
 * literals in preload.ts; these tests pin (a) that preload.ts stays free of
 * relative/non-electron imports and (b) that its literals stay in sync with
 * the real exported constants.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    FIND_IN_PAGE_CHANNEL,
    STOP_FIND_IN_PAGE_CHANNEL,
    FIND_RESULT_CHANNEL,
    OPEN_FIND_BAR_CHANNEL,
    CLOSE_FIND_BAR_CHANNEL,
} from '../src/find-in-page';
import {
    DEVTUNNEL_MODAL_SUBMIT_CHANNEL,
    DEVTUNNEL_MODAL_CANCEL_CHANNEL,
} from '../src/devtunnel-modal';
import {
    REPORT_ISSUE_SUBMIT_CHANNEL,
    REPORT_ISSUE_CANCEL_CHANNEL,
} from '../src/report-issue';
import {
    SCREENSHOT_OVERLAY_INIT_CHANNEL,
    SCREENSHOT_CROP_CHANNEL,
    SCREENSHOT_CANCEL_CHANNEL,
    SCREENSHOT_ANNOTATE_INIT_CHANNEL,
    SCREENSHOT_ANNOTATE_DONE_CHANNEL,
    SCREENSHOT_ANNOTATE_CANCEL_CHANNEL,
    SCREENSHOT_ATTACH_CHANNEL,
} from '../src/screenshot-capture';
import {
    POPOUT_NAV_CHANNEL,
    POPOUT_NAVIGATE_CHANNEL,
    POPOUT_OPEN_EXTERNAL_CHANNEL,
    POPOUT_COPY_URL_CHANNEL,
    POPOUT_STATE_CHANNEL,
} from '../src/popout-chrome';
import { MENU_COPY_CHANNEL, MENU_COPY_HANDLED_CHANNEL } from '../src/terminal-copy';
import {
    HTML_PAGE_SESSION_KEY,
    HTML_PAGE_VIEW_PREFIX,
    toHtmlPageLoadState,
    toHtmlPageOpenResult,
} from '../src/html-page-policy';
import {
    BROWSER_VIEW_OPEN_CHANNEL,
    BROWSER_VIEW_ADOPT_CHANNEL,
    BROWSER_VIEW_NAVIGATE_CHANNEL,
    BROWSER_VIEW_NAV_CHANNEL,
    BROWSER_VIEW_SET_BOUNDS_CHANNEL,
    BROWSER_VIEW_HIDE_CHANNEL,
    BROWSER_VIEW_CLOSE_CHANNEL,
    BROWSER_OPEN_EXTERNAL_CHANNEL,
    BROWSER_VIEW_STATE_CHANNEL,
    BROWSER_VIEW_NEW_TAB_CHANNEL,
    BROWSER_VIEW_DOWNLOAD_CHANNEL,
    BROWSER_PREFERENCES_GET_CHANNEL,
    BROWSER_PREFERENCES_SET_CHANNEL,
    BROWSER_IMPORT_COOKIES_CHANNEL,
    BROWSER_CLEAR_DATA_CHANNEL,
    BROWSER_PREFERENCES_CHANGED_CHANNEL,
    BROWSER_VIEW_FOCUS_ADDRESS_REQUESTED_CHANNEL,
    BROWSER_VIEW_OPEN_MENU_REQUESTED_CHANNEL,
    BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL,
    BROWSER_VIEW_CLOSED_CHANNEL,
    BROWSER_VIEW_FOCUS_CHANNEL,
    BROWSER_HOST_FOCUS_CHANNEL,
    BROWSER_VIEW_OPEN_EXTERNAL_CHANNEL,
    BROWSER_SOURCE_KINDS,
} from '../src/browser-view-policy';

const exposeInMainWorld = vi.fn();
const send = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();
const getPathForFile = vi.fn();
const invoke = vi.fn();

vi.mock('electron', () => ({
    contextBridge: { exposeInMainWorld: (...args: unknown[]) => exposeInMainWorld(...args) },
    ipcRenderer: {
        send: (...args: unknown[]) => send(...args),
        invoke: (...args: unknown[]) => invoke(...args),
        on: (...args: unknown[]) => on(...args),
        removeListener: (...args: unknown[]) => removeListener(...args),
    },
    webUtils: {
        getPathForFile: (...args: unknown[]) => getPathForFile(...args),
    },
}));

const preloadSource = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/preload.ts'),
    'utf8',
);

describe('preload sandbox-safety', () => {
    it('imports nothing but the electron builtin (sandboxed require)', () => {
        const imports = [...preloadSource.matchAll(/^import\s[^;]*?from\s+['"]([^'"]+)['"]/gms)]
            .map((m) => m[1]);
        expect(imports).toEqual(['electron']);
    });
});

describe('preload bridge', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        vi.stubGlobal('document', new EventTarget());
        await import('../src/preload');
    });
    afterEach(() => vi.unstubAllGlobals());

    function exposedApi(): any {
        expect(exposeInMainWorld).toHaveBeenCalledWith('cocDesktop', expect.anything());
        return exposeInMainWorld.mock.calls[0][1];
    }

    it('returns native keyboard focus to the host on pointer and DOM focus changes, without intercepting keys', () => {
        document.dispatchEvent(new Event('pointerdown'));
        document.dispatchEvent(new Event('focusin'));
        expect(send.mock.calls).toEqual([[BROWSER_HOST_FOCUS_CHANNEL], [BROWSER_HOST_FOCUS_CHANNEL]]);
        document.dispatchEvent(new Event('keydown'));
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('does not steal focus when the renderer webview receives DOM focus', () => {
        const event = new Event('focusin');
        const closest = vi.fn(() => ({}));
        Object.defineProperty(event, 'target', { value: { closest } });
        document.dispatchEvent(event);
        expect(closest).toHaveBeenCalledWith('webview');
        expect(send).not.toHaveBeenCalled();
    });

    it('routes local browser preferences, confirmed cleanup, focus and broadcasts through the desktop bridge', async () => {
        const api = exposedApi().browser;
        await api.getPreferences();
        expect(invoke).toHaveBeenCalledWith(BROWSER_PREFERENCES_GET_CHANNEL);
        await api.setDefaultEngine('webview2');
        expect(invoke).toHaveBeenCalledWith(BROWSER_PREFERENCES_SET_CHANNEL, 'webview2');
        await api.importCookies('view', 'app.example.com', 'session=token');
        expect(invoke).toHaveBeenCalledWith(BROWSER_IMPORT_COOKIES_CHANNEL, 'view', 'app.example.com', 'session=token', undefined);
        await api.importCookies(null, 'app.example.com', 'session=token', 'webview2');
        expect(invoke).toHaveBeenCalledWith(BROWSER_IMPORT_COOKIES_CHANNEL, null, 'app.example.com', 'session=token', 'webview2');
        await api.clearData('electron');
        expect(invoke).toHaveBeenCalledWith(BROWSER_CLEAR_DATA_CHANNEL, 'electron');
        api.focus('view');
        expect(send).toHaveBeenCalledWith(BROWSER_VIEW_FOCUS_CHANNEL, 'view');
        const offChanged = api.onPreferencesChanged(vi.fn());
        const offClosed = api.onClosed(vi.fn());
        expect(on).toHaveBeenCalledWith(BROWSER_PREFERENCES_CHANGED_CHANNEL, expect.any(Function));
        expect(on).toHaveBeenCalledWith(BROWSER_VIEW_CLOSED_CHANNEL, expect.any(Function));
        offChanged();
        offClosed();
        expect(removeListener).toHaveBeenCalledWith(BROWSER_PREFERENCES_CHANGED_CHANNEL, expect.any(Function));
        expect(removeListener).toHaveBeenCalledWith(BROWSER_VIEW_CLOSED_CHANNEL, expect.any(Function));
    });

    it('find.query sends on the real find-in-page channel', () => {
        const api = exposedApi();
        api.find.query('needle', { findNext: true, forward: true });
        expect(send).toHaveBeenCalledWith(FIND_IN_PAGE_CHANNEL, 'needle', { findNext: true, forward: true });
    });

    it('find.stop sends on the real stop channel', () => {
        exposedApi().find.stop();
        expect(send).toHaveBeenCalledWith(STOP_FIND_IN_PAGE_CHANNEL);
    });

    it('find.onResult subscribes on the real result channel and unsubscribes', () => {
        const cb = vi.fn();
        const unsubscribe = exposedApi().find.onResult(cb);
        expect(on).toHaveBeenCalledWith(FIND_RESULT_CHANNEL, expect.any(Function));
        unsubscribe();
        expect(removeListener).toHaveBeenCalledWith(FIND_RESULT_CHANNEL, expect.any(Function));
    });

    it('find.openBar / find.closeBar send on the real bar channels', () => {
        const api = exposedApi();
        api.find.openBar();
        expect(send).toHaveBeenCalledWith(OPEN_FIND_BAR_CHANNEL);
        api.find.closeBar();
        expect(send).toHaveBeenCalledWith(CLOSE_FIND_BAR_CHANNEL);
    });

    it('devtunnelModal submit/cancel send on the real devtunnel channels', () => {
        const api = exposedApi();
        api.devtunnelModal.submit('tunnel-1');
        expect(send).toHaveBeenCalledWith(DEVTUNNEL_MODAL_SUBMIT_CHANNEL, 'tunnel-1');
        api.devtunnelModal.cancel();
        expect(send).toHaveBeenCalledWith(DEVTUNNEL_MODAL_CANCEL_CHANNEL);
    });

    it('reportIssue submit/cancel send on the real report-issue channels', () => {
        const api = exposedApi();
        api.reportIssue.submit('Crash on open', 'Steps to reproduce…');
        expect(send).toHaveBeenCalledWith(
            REPORT_ISSUE_SUBMIT_CHANNEL,
            'Crash on open',
            'Steps to reproduce…',
        );
        api.reportIssue.cancel();
        expect(send).toHaveBeenCalledWith(REPORT_ISSUE_CANCEL_CHANNEL);
    });

    it('the report-issue channel literals in preload.ts match report-issue.ts', () => {
        const source = readFileSync(
            path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/preload.ts'),
            'utf8',
        );
        expect(source).toContain(`'${REPORT_ISSUE_SUBMIT_CHANNEL}'`);
        expect(source).toContain(`'${REPORT_ISSUE_CANCEL_CHANNEL}'`);
    });

    it('screenshot.crop / cancel send on the real screenshot channels', () => {
        const api = exposedApi();
        const rect = { x: 1, y: 2, width: 3, height: 4 };
        api.screenshot.crop(rect);
        expect(send).toHaveBeenCalledWith(SCREENSHOT_CROP_CHANNEL, rect);
        api.screenshot.cancel();
        expect(send).toHaveBeenCalledWith(SCREENSHOT_CANCEL_CHANNEL);
    });

    it('screenshot.onOverlayInit subscribes on the real overlay channel and unsubscribes', () => {
        const cb = vi.fn();
        const unsubscribe = exposedApi().screenshot.onOverlayInit(cb);
        expect(on).toHaveBeenCalledWith(SCREENSHOT_OVERLAY_INIT_CHANNEL, expect.any(Function));
        unsubscribe();
        expect(removeListener).toHaveBeenCalledWith(
            SCREENSHOT_OVERLAY_INIT_CHANNEL,
            expect.any(Function),
        );
    });

    it('screenshot.done / cancelAnnotate send on the real annotate channels', () => {
        const api = exposedApi();
        api.screenshot.done('data:image/png;base64,ABC');
        expect(send).toHaveBeenCalledWith(SCREENSHOT_ANNOTATE_DONE_CHANNEL, 'data:image/png;base64,ABC');
        api.screenshot.cancelAnnotate();
        expect(send).toHaveBeenCalledWith(SCREENSHOT_ANNOTATE_CANCEL_CHANNEL);
    });

    it('screenshot.onAnnotateInit subscribes on the real annotate channel and unsubscribes', () => {
        const cb = vi.fn();
        const unsubscribe = exposedApi().screenshot.onAnnotateInit(cb);
        expect(on).toHaveBeenCalledWith(SCREENSHOT_ANNOTATE_INIT_CHANNEL, expect.any(Function));
        unsubscribe();
        expect(removeListener).toHaveBeenCalledWith(
            SCREENSHOT_ANNOTATE_INIT_CHANNEL,
            expect.any(Function),
        );
    });

    it('screenshot.onScreenshotAttach subscribes on the real attach channel, relays the payload, and unsubscribes', () => {
        const cb = vi.fn();
        const unsubscribe = exposedApi().screenshot.onScreenshotAttach(cb);
        expect(on).toHaveBeenCalledWith(SCREENSHOT_ATTACH_CHANNEL, expect.any(Function));
        // The registered listener should hand the SPA just the PNG data URL (drop the event arg).
        const listener = on.mock.calls.find((c) => c[0] === SCREENSHOT_ATTACH_CHANNEL)![1];
        listener({ sender: 'ignored' }, 'data:image/png;base64,ABC');
        expect(cb).toHaveBeenCalledWith('data:image/png;base64,ABC');
        unsubscribe();
        expect(removeListener).toHaveBeenCalledWith(
            SCREENSHOT_ATTACH_CHANNEL,
            expect.any(Function),
        );
    });

    it('getPathForFile returns the absolute path webUtils reports', () => {
        const file = { name: 'notes.md' } as unknown as File;
        getPathForFile.mockReturnValue('/home/u/repo/notes.md');
        expect(exposedApi().getPathForFile(file)).toBe('/home/u/repo/notes.md');
        expect(getPathForFile).toHaveBeenCalledWith(file);
    });

    it('getPathForFile returns null for a File that is not backed by disk', () => {
        const api = exposedApi();
        // Electron hands back an empty string for a synthesized Blob/File.
        getPathForFile.mockReturnValue('');
        expect(api.getPathForFile({} as unknown as File)).toBeNull();
        // …and it throws if the argument is not a real File at all.
        getPathForFile.mockImplementation(() => {
            throw new TypeError('not a File');
        });
        expect(api.getPathForFile({} as unknown as File)).toBeNull();
    });

    it('popout nav / navigate / openExternal / copyUrl send on the real popout channels', () => {
        const api = exposedApi();
        api.popout.nav('back');
        expect(send).toHaveBeenCalledWith(POPOUT_NAV_CHANNEL, 'back');
        api.popout.navigate('https://example.com');
        expect(send).toHaveBeenCalledWith(POPOUT_NAVIGATE_CHANNEL, 'https://example.com');
        api.popout.openExternal();
        expect(send).toHaveBeenCalledWith(POPOUT_OPEN_EXTERNAL_CHANNEL);
        api.popout.copyUrl();
        expect(send).toHaveBeenCalledWith(POPOUT_COPY_URL_CHANNEL);
    });

    it('menu.onCopy subscribes on the real menu-copy channel and unsubscribes', () => {
        const cb = vi.fn();
        const unsubscribe = exposedApi().menu.onCopy(cb);
        expect(on).toHaveBeenCalledWith(MENU_COPY_CHANNEL, expect.any(Function));
        const listener = on.mock.calls.find((c) => c[0] === MENU_COPY_CHANNEL)![1];
        listener({ sender: 'ignored' });
        expect(cb).toHaveBeenCalledTimes(1);
        unsubscribe();
        expect(removeListener).toHaveBeenCalledWith(MENU_COPY_CHANNEL, expect.any(Function));
    });

    it('menu.copyHandled replies on the real handled channel', () => {
        exposedApi().menu.copyHandled();
        expect(send).toHaveBeenCalledWith(MENU_COPY_HANDLED_CHANNEL);
    });

    it('popout.onState subscribes on the real state channel, relays the payload, and unsubscribes', () => {
        const cb = vi.fn();
        const unsubscribe = exposedApi().popout.onState(cb);
        expect(on).toHaveBeenCalledWith(POPOUT_STATE_CHANNEL, expect.any(Function));
        const listener = on.mock.calls.find((c) => c[0] === POPOUT_STATE_CHANNEL)![1];
        const state = { url: 'http://127.0.0.1:1/#popout/canvas', canGoBack: true, canGoForward: false, loading: false };
        listener({ sender: 'ignored' }, state);
        expect(cb).toHaveBeenCalledWith(state);
        unsubscribe();
        expect(removeListener).toHaveBeenCalledWith(POPOUT_STATE_CHANNEL, expect.any(Function));
    });
    it('htmlPage is a thin wrapper that drives prefixed file views over the browser channels', async () => {
        const api = exposedApi();
        const view = HTML_PAGE_VIEW_PREFIX + 'p1';
        invoke.mockResolvedValue({ ok: true, engine: 'electron', sourceKind: 'file' });
        await expect(api.htmlPage.open('p1', '/w/index.html')).resolves.toEqual({ ok: true });
        expect(invoke).toHaveBeenCalledWith(BROWSER_VIEW_OPEN_CHANNEL, view, { kind: 'file', path: '/w/index.html' }, HTML_PAGE_SESSION_KEY, undefined);
        const rect = { x: 1, y: 2, width: 3, height: 4 };
        api.htmlPage.setBounds('p1', rect);
        expect(send).toHaveBeenCalledWith(BROWSER_VIEW_SET_BOUNDS_CHANNEL, view, rect);
        api.htmlPage.hide('p1');
        expect(send).toHaveBeenCalledWith(BROWSER_VIEW_HIDE_CHANNEL, view);
        api.htmlPage.reload('p1');
        expect(send).toHaveBeenCalledWith(BROWSER_VIEW_NAV_CHANNEL, view, 'reload');
        api.htmlPage.openExternal('p1');
        expect(send).toHaveBeenCalledWith(BROWSER_VIEW_OPEN_EXTERNAL_CHANNEL, view);
        api.htmlPage.close('p1');
        expect(send).toHaveBeenCalledWith(BROWSER_VIEW_CLOSE_CHANNEL, view);
    });

    it.each([
        { ok: true, engine: 'electron', sourceKind: 'file' },
        { ok: true, engine: 'electron', sourceKind: 'file', embed: 'webview', src: 'file:///preview/page.html', partition: 'attachment-token' },
        ...['invalid', 'not-absolute', 'not-html', 'missing', 'not-file', 'bad-id', 'busy', 'bad-session', 'no-window']
            .map(reason => ({ ok: false, reason, message: 'detail', engine: 'electron' })),
    ])('htmlPage.open keeps its reply shape for %o (in sync with html-page-policy)', async (result) => {
        invoke.mockResolvedValue(result);
        await expect(exposedApi().htmlPage.open('p1', '/w/index.html')).resolves.toEqual(toHtmlPageOpenResult(result));
    });

    it('htmlPage.onState maps only prefixed view states (in sync with html-page-policy) and unsubscribes', () => {
        const cb = vi.fn();
        const unsubscribe = exposedApi().htmlPage.onState(cb);
        const listener = on.mock.calls.find((c) => c[0] === BROWSER_VIEW_STATE_CHANNEL)![1];
        const base = { engine: 'electron', sourceKind: 'file', url: 'file:///w/index.html', title: 'A', canGoBack: false, canGoForward: false, loading: false };
        const states = [
            { ...base, loading: true },
            base,
            { ...base, error: 'ERR_FILE_NOT_FOUND', errorCode: 'navigation-failed' },
            { ...base, url: '' },
        ];
        for (const state of states) { listener({ sender: 'ignored' }, { ...state, viewId: HTML_PAGE_VIEW_PREFIX + 'p1' }); }
        listener({ sender: 'ignored' }, { ...base, sourceKind: 'url', viewId: 'b1', url: 'https://a.test/' });
        expect(cb.mock.calls.map(c => c[0])).toEqual(states.map(state => toHtmlPageLoadState('p1', state)));
        unsubscribe();
        expect(removeListener).toHaveBeenCalledWith(BROWSER_VIEW_STATE_CHANNEL, listener);
    });

    it('browser advertises the source kinds this build supports', () => {
        expect(exposedApi().browser.sources).toEqual(BROWSER_SOURCE_KINDS);
        expect(exposedApi().browser.sources).toEqual(['url', 'file']);
    });

    it('browser.open passes url and file sources through unchanged', async () => {
        const api = exposedApi();
        invoke.mockResolvedValue({ ok: true, engine: 'electron', sourceKind: 'file' });
        await expect(api.browser.open('f1', { kind: 'file', path: '/w/index.html' }, 'ws-1')).resolves.toEqual({ ok: true, engine: 'electron', sourceKind: 'file' });
        expect(invoke).toHaveBeenCalledWith(BROWSER_VIEW_OPEN_CHANNEL, 'f1', { kind: 'file', path: '/w/index.html' }, 'ws-1', undefined);
        await api.browser.open('b1', { kind: 'url', url: 'https://example.com/' }, 'ws-1', 'webview2');
        expect(invoke).toHaveBeenCalledWith(BROWSER_VIEW_OPEN_CHANNEL, 'b1', { kind: 'url', url: 'https://example.com/' }, 'ws-1', 'webview2');
        api.browser.openViewExternal('f1');
        expect(send).toHaveBeenCalledWith(BROWSER_VIEW_OPEN_EXTERNAL_CHANNEL, 'f1');
    });

    it('browser methods use the real browser-view channels', async () => {
        const api = exposedApi();
        invoke.mockResolvedValue({ ok: true });
        await expect(api.browser.open('b1', 'https://example.com/', 'ws-1')).resolves.toEqual({ ok: true });
        expect(invoke).toHaveBeenCalledWith(BROWSER_VIEW_OPEN_CHANNEL, 'b1', 'https://example.com/', 'ws-1', undefined);
        await expect(api.browser.adopt('b1', 42)).resolves.toEqual({ ok: true });
        expect(invoke).toHaveBeenCalledWith(BROWSER_VIEW_ADOPT_CHANNEL, 'b1', 42);
        await api.browser.navigate('b1', 'https://example.org/');
        expect(invoke).toHaveBeenCalledWith(BROWSER_VIEW_NAVIGATE_CHANNEL, 'b1', 'https://example.org/');
        invoke.mockResolvedValue(true);
        await expect(api.browser.openExternal('https://example.org/')).resolves.toBe(true);
        expect(invoke).toHaveBeenCalledWith(BROWSER_OPEN_EXTERNAL_CHANNEL, 'https://example.org/');
        for (const action of ['back', 'forward', 'reload', 'stop']) {
            api.browser.nav('b1', action);
            expect(send).toHaveBeenCalledWith(BROWSER_VIEW_NAV_CHANNEL, 'b1', action);
        }
        const rect = { x: 1, y: 2, width: 3, height: 4 };
        api.browser.setBounds('b1', rect);
        expect(send).toHaveBeenCalledWith(BROWSER_VIEW_SET_BOUNDS_CHANNEL, 'b1', rect);
        api.browser.hide('b1');
        expect(send).toHaveBeenCalledWith(BROWSER_VIEW_HIDE_CHANNEL, 'b1');
        api.browser.close('b1');
        expect(send).toHaveBeenCalledWith(BROWSER_VIEW_CLOSE_CHANNEL, 'b1');
    });

    it.each([
        ['onFocusAddressRequested', BROWSER_VIEW_FOCUS_ADDRESS_REQUESTED_CHANNEL, { viewId: 'b1' }],
        ['onOpenMenuRequested', BROWSER_VIEW_OPEN_MENU_REQUESTED_CHANNEL, { viewId: 'b1' }],
        ['onCloseRequested', BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL, { viewId: 'b1' }],
        ['onState', BROWSER_VIEW_STATE_CHANNEL, { viewId: 'b1', url: 'https://a.test/', title: 'A', canGoBack: false, canGoForward: false, loading: false }],
        ['onNewTab', BROWSER_VIEW_NEW_TAB_CHANNEL, { openerViewId: 'b1', url: 'https://b.test/' }],
        ['onDownload', BROWSER_VIEW_DOWNLOAD_CHANNEL, { viewId: 'b1', url: 'https://a.test/f.zip', ok: true }],
    ])('browser.%s relays payloads on the real channel and unsubscribes', (method, channel, payload) => {
        const cb = vi.fn();
        const unsubscribe = exposedApi().browser[method](cb);
        const listener = on.mock.calls.find((c) => c[0] === channel)![1];
        listener({ sender: 'ignored' }, payload);
        expect(cb).toHaveBeenCalledWith(payload);
        unsubscribe();
        expect(removeListener).toHaveBeenCalledWith(channel, listener);
    });
});
