// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopHtmlPageBridge, type HtmlPageLoadState } from '../../../../src/server/spa/client/react/shared/file-path/html-page-bridge';
import type { BrowserOpenResult, BrowserViewState } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

function browserBridge(sources?: string[]) {
    let listener: ((state: BrowserViewState) => void) | undefined;
    return {
        ...(sources ? { sources } : {}),
        open: vi.fn(async (): Promise<BrowserOpenResult> => ({ ok: true, engine: 'electron', sourceKind: 'file' })),
        setBounds: vi.fn(), hide: vi.fn(), close: vi.fn(), nav: vi.fn(), openViewExternal: vi.fn(),
        onState: vi.fn((callback: (state: BrowserViewState) => void) => {
            listener = callback;
            return () => { listener = undefined; };
        }),
        emit: (state: Partial<BrowserViewState> & { viewId: string }) => listener?.({
            engine: 'electron', url: '', title: '', canGoBack: false, canGoForward: false, loading: false, ...state,
        }),
    };
}

function install(desktop: Record<string, unknown>) {
    Object.defineProperty(window, 'cocDesktop', { value: desktop, configurable: true });
}

afterEach(() => { delete (window as { cocDesktop?: unknown }).cocDesktop; });

describe('desktopHtmlPageBridge selection', () => {
    it('is undefined outside the desktop app', () => {
        expect(desktopHtmlPageBridge()).toBeUndefined();
    });

    it('falls back to htmlPage when the desktop browser API has no file source', () => {
        const htmlPage = { open: vi.fn() };
        install({ htmlPage, browser: browserBridge() });
        expect(desktopHtmlPageBridge()).toBe(htmlPage);
        install({ htmlPage, browser: browserBridge(['url']) });
        expect(desktopHtmlPageBridge()).toBe(htmlPage);
    });

    it('prefers the merged browser file source and keeps one adapter per bridge', () => {
        const htmlPage = { open: vi.fn() };
        const browser = browserBridge(['url', 'file']);
        install({ htmlPage, browser });
        const bridge = desktopHtmlPageBridge();
        expect(bridge).not.toBe(htmlPage);
        expect(desktopHtmlPageBridge()).toBe(bridge);
        expect(bridge?.nav).toBeTypeOf('function');
    });
});

describe('browser file-source adapter', () => {
    it('forwards the main-approved file guest attachment metadata', async () => {
        const browser = browserBridge(['url', 'file']);
        browser.open.mockResolvedValue({
            ok: true, engine: 'electron', sourceKind: 'file', embed: 'webview',
            src: 'file:///preview/page.html', partition: 'one-use-token',
        });
        install({ browser });
        expect(await desktopHtmlPageBridge()!.open('p1', '/preview/page.html')).toEqual({
            ok: true, embed: 'webview', src: 'file:///preview/page.html', partition: 'one-use-token',
        });
    });

    it('maps page calls onto html-page:<id> browser views', async () => {
        const browser = browserBridge(['url', 'file']);
        install({ browser });
        const bridge = desktopHtmlPageBridge()!;
        await expect(bridge.open('p1', '/w/index.html')).resolves.toEqual({ ok: true });
        expect(browser.open).toHaveBeenCalledWith('html-page:p1', { kind: 'file', path: '/w/index.html' }, 'html-page');
        bridge.setBounds('p1', { x: 1, y: 2, width: 3, height: 4 });
        bridge.hide('p1');
        bridge.reload('p1');
        bridge.nav!('p1', 'back');
        bridge.openExternal('p1');
        bridge.close('p1');
        expect(browser.setBounds).toHaveBeenCalledWith('html-page:p1', { x: 1, y: 2, width: 3, height: 4 });
        expect(browser.hide).toHaveBeenCalledWith('html-page:p1');
        expect(browser.nav).toHaveBeenCalledWith('html-page:p1', 'reload');
        expect(browser.nav).toHaveBeenCalledWith('html-page:p1', 'back');
        expect(browser.openViewExternal).toHaveBeenCalledWith('html-page:p1');
        expect(browser.close).toHaveBeenCalledWith('html-page:p1');
    });

    it('reports a refused open with its reason', async () => {
        const browser = browserBridge(['url', 'file']);
        browser.open.mockResolvedValueOnce({ ok: false, reason: 'missing', message: 'gone' } as never);
        install({ browser });
        await expect(desktopHtmlPageBridge()!.open('p1', '/w/x.html')).resolves.toEqual({ ok: false, reason: 'missing' });
    });

    it('turns browser view state into page load state and ignores url views', () => {
        const browser = browserBridge(['url', 'file']);
        install({ browser });
        const states: HtmlPageLoadState[] = [];
        const off = desktopHtmlPageBridge()!.onState(state => states.push(state));
        browser.emit({ viewId: 'browser-tab', url: 'https://example.test/' });
        browser.emit({ viewId: 'html-page:p1', url: 'file:///w/x.html', loading: true });
        browser.emit({ viewId: 'html-page:p1', url: 'file:///w/x.html', canGoBack: true });
        browser.emit({ viewId: 'html-page:p1', url: 'file:///w/y.html', error: 'not found' });
        off();
        browser.emit({ viewId: 'html-page:p1', url: 'file:///w/z.html' });
        expect(states).toEqual([
            { pageId: 'p1', status: 'loading', url: 'file:///w/x.html', canGoBack: false, canGoForward: false },
            { pageId: 'p1', status: 'loaded', url: 'file:///w/x.html', canGoBack: true, canGoForward: false },
            { pageId: 'p1', status: 'failed', url: 'file:///w/y.html', error: 'not found', canGoBack: false, canGoForward: false },
        ]);
    });
});
