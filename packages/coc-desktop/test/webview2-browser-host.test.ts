import { shell } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebView2BrowserHost } from '../src/webview2-browser-host';
import { BROWSER_FRAME_CDP_EVENTS, BrowserHostError, type BrowserEventSink, type BrowserHostedView } from '../src/browser-host-contract';
import { BrowserHostManager } from '../src/browser-host-manager';
import { BrowserHistoryStore } from '../src/browser-history';
import { BrowserControlPage } from '../src/browser-control-page';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mocks = vi.hoisted(() => ({
    request: vi.fn().mockResolvedValue(undefined),
    running: true,
    rejectView: vi.fn(),
    rejectSession: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    onFailure: vi.fn<(error: BrowserHostError) => void>(),
    window: {
        isDestroyed: () => false,
        isFullScreen: () => false,
        getNativeWindowHandle: () => Buffer.alloc(8),
        getContentBounds: () => mocks.contentBounds,
        setFullScreen: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
    },
    owner: { focus: vi.fn() },
    contentBounds: { x: 100, y: 200, width: 640, height: 480 },
    dipToScreenPoint: vi.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
    onEvent: vi.fn<(message: Record<string, unknown>) => void>(),
}));

vi.mock('electron', () => ({
    BrowserWindow: { fromWebContents: () => ({ ...mocks.window, webContents: mocks.owner }) },
    screen: { dipToScreenPoint: mocks.dipToScreenPoint },
    webContents: { fromId: () => mocks.owner },
    shell: { openExternal: vi.fn() },
}));

vi.mock('../src/webview2-process', async importOriginal => ({
    ...await importOriginal<typeof import('../src/webview2-process')>(),
    WebView2Process: class {
        constructor(_binary: () => string, _profile: string, onEvent: (message: Record<string, unknown>) => void, onFailure: (error: BrowserHostError) => void) {
            mocks.onEvent.mockImplementation(onEvent);
            mocks.onFailure.mockImplementation(onFailure);
        }
        get running() { return mocks.running; }
        request = mocks.request;
        rejectView = mocks.rejectView;
        rejectSession = mocks.rejectSession;
        dispose = mocks.dispose;
    },
}));

const sink: BrowserEventSink = { state: vi.fn(), newTab: vi.fn(), download: vi.fn(), closeRequested: vi.fn(), openMenuRequested: vi.fn(), focusAddressRequested: vi.fn(), reopenClosedRequested: vi.fn() };
const bounds = { x: 10, y: 20, width: 300, height: 200 };

describe('WebView2 ClickOnce transport', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.request.mockReset().mockResolvedValue(undefined); });
    it('passes opt-in explicitly and binds launch requests to a live exact native source', async () => {
        const application = vi.fn();
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: 'https://fixture.test/', clickOnceEnabled: true }, { ...sink, application });
        expect(mocks.request).toHaveBeenCalledWith('open', expect.objectContaining({ clickOnceEnabled: true }));
        const url = 'https://fixture.test/app.application?value=synthetic%2Fvalue';
        for (const kind of ['navigation', 'new-window', 'download']) {
            mocks.onEvent({ event: 'application', viewId: '7:tab:1', kind, url });
            expect(application).toHaveBeenLastCalledWith({ kind, url }, expect.any(Function));
        }
        const current = application.mock.calls.at(-1)![1];
        expect(current()).toBe(true);
        mocks.onEvent({ event: 'document-starting', viewId: '7:tab:1' });
        expect(current()).toBe(false);
        mocks.onEvent({ event: 'application', viewId: '7:tab:1', kind: 'download',
            url: 'https://fixture.test/deploy?value=original', deploymentUrl: url, mimeType: 'application/x-ms-application' });
        expect(application).toHaveBeenLastCalledWith({ kind: 'download', url: 'https://fixture.test/deploy?value=original', deploymentUrl: url, mimeType: 'application/x-ms-application' }, expect.any(Function));
        const beforeNavigate = application.mock.calls.at(-1)![1];
        await view.navigate('https://fixture.test/next');
        expect(beforeNavigate()).toBe(false);
        mocks.onEvent({ event: 'application', viewId: '7:tab:1', kind: 'navigation', url });
        const beforeClose = application.mock.calls.at(-1)![1];
        await view.close();
        expect(beforeClose()).toBe(false);
        mocks.onEvent({ event: 'application', viewId: '7:tab:1', kind: 'navigation', url });
        expect(application).toHaveBeenCalledTimes(5);
        await host.dispose();
    });
    it('rejects disabled, foreign, malformed and non-deployment requests', async () => {
        const application = vi.fn();
        const host = new WebView2BrowserHost('profile');
        await host.create({ ownerId: 7, viewId: 'off', sessionKey: 'workspace', url: 'https://fixture.test/' }, { ...sink, application });
        await host.create({ ownerId: 8, viewId: 'on', sessionKey: 'other', url: 'https://fixture.test/', clickOnceEnabled: true }, { ...sink, application });
        for (const message of [
            { viewId: '7:off:1', kind: 'navigation', url: 'https://fixture.test/app.application' },
            { viewId: 'foreign', kind: 'navigation', url: 'https://fixture.test/app.application' },
            { viewId: '8:on:2', kind: 'navigation', url: 'file:///app.application' },
            { viewId: '8:on:2', kind: 'navigation', url: 'https://fixture.test/report.pdf' },
            { viewId: '8:on:2', kind: 'execute', url: 'https://fixture.test/app.application' },
            { viewId: '8:on:2', kind: { toString: 'invalid' }, url: 'https://fixture.test/app.application' },
            { viewId: '8:on:2', kind: 'download', url: 'https://fixture.test/deploy', mimeType: {} },
        ]) mocks.onEvent({ event: 'application', ...message });
        expect(application).not.toHaveBeenCalled();
        await host.dispose();
    });
});

describe('WebView2 private frame event transport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.request.mockReset().mockResolvedValue(undefined);
        mocks.dispose.mockReset().mockResolvedValue(undefined);
        mocks.running = true;
    });

    async function opened() {
        const host = new WebView2BrowserHost('profile');
        const root = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: 'https://fixture.test/' }, sink);
        const event = (method: string, params: Record<string, unknown>, sessionId?: string, viewId = '7:tab:1') =>
            mocks.onEvent({ event: 'cdp-event', viewId, method, params, ...(sessionId ? { sessionId } : {}) });
        return { host, root, event };
    }

    it('leaves the disabled path unsubscribed and sends only legacy root commands', async () => {
        const h = await opened();
        await h.root.cdp!('Runtime.evaluate', { expression: '42' });
        expect(mocks.request.mock.calls.map(([op]) => op)).toEqual(['open', 'cdp']);
        expect(mocks.request).toHaveBeenLastCalledWith('cdp', { viewId: '7:tab:1', method: 'Runtime.evaluate', params: { expression: '42' } });
        await h.host.dispose();
    });

    it('activates the owner before transferring focus to the embedded WebView', async () => {
        const h = await opened();
        const order: string[] = [];
        mocks.window.show.mockImplementationOnce(() => { order.push('show'); });
        mocks.window.focus.mockImplementationOnce(() => { order.push('window-focus'); });
        mocks.request.mockImplementationOnce(async () => { order.push('webview-focus'); });
        try {
            await h.root.focus();
            expect(order).toEqual(['show', 'window-focus', 'webview-focus']);
            expect(mocks.request).toHaveBeenLastCalledWith('focus', { viewId: '7:tab:1' });
        } finally {
            await h.host.dispose();
        }
    });

    it('rejects focus on a closed view without activating its owner', async () => {
        const h = await opened();
        try {
            await h.root.close();
            mocks.request.mockClear();
            await expect(h.root.focus()).rejects.toThrow('Browser tab is closed');
            expect(mocks.window.show).not.toHaveBeenCalled();
            expect(mocks.window.focus).not.toHaveBeenCalled();
            expect(mocks.request).not.toHaveBeenCalled();
        } finally {
            await h.host.dispose();
        }
    });

    it('awaits allowlisted native subscriptions before enabling domains and disposes only at the last subscriber', async () => {
        const h = await opened();
        let release!: () => void;
        mocks.request.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
        const first = vi.fn();
        const second = vi.fn();
        const off = h.root.onCdpEvent!(first);
        const offSecond = h.root.onCdpEvent!(second);
        const enable = h.root.cdp!('Runtime.enable');
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        expect(mocks.request.mock.calls.filter(([op]) => op === 'cdp')).toHaveLength(0);
        release();
        await h.root.waitForCdpEvents!();
        await enable;
        expect(mocks.request.mock.calls.filter(([op, payload]) => op === 'cdp-subscribe' && payload.enabled)
            .map(([, payload]) => payload.method)).toEqual(BROWSER_FRAME_CDP_EVENTS);
        expect(mocks.request).toHaveBeenLastCalledWith('cdp', { viewId: '7:tab:1', method: 'Runtime.enable', params: {} });
        h.event('Page.frameAttached', { frameId: 'child' });
        expect(first).toHaveBeenCalledWith('Page.frameAttached', { frameId: 'child' }, undefined);
        expect(second).toHaveBeenCalledOnce();
        off();
        off();
        await h.root.waitForCdpEvents!();
        expect(mocks.request.mock.calls.filter(([op, payload]) => op === 'cdp-subscribe' && !payload.enabled)).toHaveLength(0);
        offSecond();
        await h.root.waitForCdpEvents!();
        expect(mocks.request.mock.calls.filter(([op, payload]) => op === 'cdp-subscribe' && !payload.enabled)).toHaveLength(BROWSER_FRAME_CDP_EVENTS.length);
        h.event('Page.frameAttached', {});
        expect(second).toHaveBeenCalledOnce();
        await h.host.dispose();
    });

    it('binds nested iframe sessions to their exact native view and invalidates detached descendants', async () => {
        const h = await opened();
        const other = await h.host.create({ ownerId: 8, viewId: 'other', sessionKey: 'other', url: 'https://fixture.test/' }, sink);
        const listener = vi.fn();
        h.root.onCdpEvent!(listener);
        other.onCdpEvent!(vi.fn());
        await Promise.all([h.root.waitForCdpEvents!(), other.waitForCdpEvents!()]);
        h.event('Target.attachedToTarget', { sessionId: 'child', targetInfo: { type: 'iframe' } });
        h.event('Target.attachedToTarget', { sessionId: 'nested', targetInfo: { type: 'iframe' } }, 'child');
        h.event('Runtime.executionContextCreated', { context: { id: 42 } }, 'nested');
        expect(listener).toHaveBeenLastCalledWith('Runtime.executionContextCreated', { context: { id: 42 } }, 'nested');
        await h.root.cdp!('Runtime.evaluate', { expression: '42' }, 'nested');
        expect(mocks.request).toHaveBeenLastCalledWith('cdp', { viewId: '7:tab:1', method: 'Runtime.evaluate', params: { expression: '42' }, sessionId: 'nested' });
        await expect(other.cdp!('Runtime.enable', {}, 'nested')).rejects.toThrow('does not belong');
        h.event('Target.detachedFromTarget', { sessionId: 'child' });
        expect(mocks.rejectSession.mock.calls).toEqual([['7:tab:1', 'child'], ['7:tab:1', 'nested']]);
        await expect(h.root.cdp!('Runtime.enable', {}, 'nested')).rejects.toThrow('does not belong');
        h.event('Runtime.executionContextsCleared', {}, 'nested');
        expect(listener).toHaveBeenCalledTimes(4);
        await h.host.dispose();
    });

    it('rejects unsupported installed runtime explicitly and rolls back partial subscriptions', async () => {
        const h = await opened();
        const error = new BrowserHostError('native-unavailable', 'unsupported-runtime: frame control requires session-qualified CDP; selected engine unchanged.');
        mocks.request.mockImplementation(async (op, payload) => {
            if (op === 'cdp-subscribe' && payload.enabled && payload.method === BROWSER_FRAME_CDP_EVENTS[2]) throw error;
        });
        const off = h.root.onCdpEvent!(vi.fn());
        await expect(h.root.waitForCdpEvents!()).rejects.toBe(error);
        await expect(h.root.cdp!('Runtime.enable')).rejects.toBe(error);
        expect(mocks.request.mock.calls.filter(([op, payload]) => op === 'cdp-subscribe' && !payload.enabled)).toHaveLength(BROWSER_FRAME_CDP_EVENTS.length);
        expect(h.root.snapshot().engine).toBe('webview2');
        off();
        await h.root.waitForCdpEvents!();
        await h.root.cdp!('Runtime.enable');
        await h.host.dispose();
    });

    it('completes native unsubscription before a rapid replacement subscriber becomes ready', async () => {
        const h = await opened();
        const listener = vi.fn();
        const off = h.root.onCdpEvent!(listener);
        await h.root.waitForCdpEvents!();
        mocks.request.mockClear();
        off();
        const replacementOff = h.root.onCdpEvent!(listener);
        await h.root.waitForCdpEvents!();
        const subscriptions = mocks.request.mock.calls.filter(([op]) => op === 'cdp-subscribe');
        expect(subscriptions.map(([, payload]) => payload.enabled)).toEqual([
            ...BROWSER_FRAME_CDP_EVENTS.map(() => false), ...BROWSER_FRAME_CDP_EVENTS.map(() => true),
        ]);
        off();
        h.event('Page.frameAttached', {});
        expect(listener).toHaveBeenCalledOnce();
        replacementOff();
        await h.root.waitForCdpEvents!();
        await h.host.dispose();
    });

    it('fails closed on oversized or invalid event data and preserves the native failure reason', async () => {
        const h = await opened();
        const listener = vi.fn();
        h.root.onCdpEvent!(listener);
        await h.root.waitForCdpEvents!();
        h.event('Page.frameNavigated', { value: '\u754c'.repeat(300_001) });
        expect(listener).toHaveBeenCalledExactlyOnceWith('Inspector.detached', { reason: expect.stringContaining('transport limit') });
        await expect(h.root.cdp!('Page.enable')).rejects.toThrow('transport limit');
        expect(mocks.rejectView).toHaveBeenCalledWith('7:tab:1', expect.objectContaining({ reason: 'invalid' }));
        await h.host.dispose();
    });

    it.each(['close', 'crash', 'helper-crash'])('cleans event listeners and refuses late session messages after %s', async outcome => {
        const h = await opened();
        const listener = vi.fn();
        h.root.onCdpEvent!(listener);
        await h.root.waitForCdpEvents!();
        if (outcome === 'close') await h.root.close();
        else if (outcome === 'helper-crash') mocks.onFailure(new BrowserHostError('runtime-crashed', 'Synthetic helper crash'));
        else mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { url: 'https://fixture.test/', title: '', loading: false, canGoBack: false, canGoForward: false, errorCode: 'runtime-crashed' } });
        h.event('Target.attachedToTarget', { sessionId: 'late', targetInfo: { type: 'iframe' } });
        expect(listener).not.toHaveBeenCalled();
        await expect(h.root.cdp!('Runtime.enable', {}, 'late')).rejects.toThrow(/closed|crashed|crash/i);
        await h.host.dispose();
    });

    it('does not install remaining subscriptions when closure races native admission', async () => {
        const h = await opened();
        let release!: () => void;
        mocks.request.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
        h.root.onCdpEvent!(vi.fn());
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        await h.root.close();
        release();
        await Promise.resolve();
        await Promise.resolve();
        expect(mocks.request.mock.calls.filter(([op]) => op === 'cdp-subscribe')).toHaveLength(1);
        await h.host.dispose();
    });
});

describe('WebView2 owner-scoped native popups', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.request.mockReset().mockResolvedValue(undefined);
        mocks.dispose.mockReset().mockResolvedValue(undefined);
        mocks.running = true;
    });

    async function opened() {
        const popups = new Map<string, BrowserHostedView>();
        const sink: BrowserEventSink = {
            state: vi.fn(), newTab: vi.fn(), download: vi.fn(), closeRequested: vi.fn(), openMenuRequested: vi.fn(),
            controlPopoutOpened: vi.fn((id, popup) => popups.set(id, popup)),
            controlPopoutClosed: vi.fn(id => popups.delete(id)), controlFocused: vi.fn(),
            controlStopRequested: vi.fn(),
        };
        const host = new WebView2BrowserHost('profile');
        const root = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: 'https://fixture.test/' }, sink);
        const event = (suffix: number, url = 'https://fixture.test/popup') =>
            mocks.onEvent({ event: 'popup-opened', viewId: `7:tab:1:popup:${suffix}`, rootId: '7:tab:1', url });
        event(1);
        const [id, popup] = [...popups][0];
        return { host, root, sink, popups, id, popup, event };
    }

    it.each(['jpeg', 'png'] as const)('forwards shared %s screenshot CDP options unchanged for roots and popups', async format => {
        const h = await opened();
        for (const [view, viewId] of [[h.root, '7:tab:1'], [h.popup, '7:tab:1:popup:1']] as const) {
            mocks.request.mockResolvedValueOnce({ cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 } })
                .mockResolvedValueOnce({ result: { value: { valueJson: '1', valueTruncated: false } } })
                .mockResolvedValueOnce({ data: 'fixture==' });
            const page = new BrowserControlPage((method, params) => view.cdp!(method, params));
            expect(await page.screenshot(undefined, format)).toEqual({
                data: 'fixture==', mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
            });
            expect(mocks.request).toHaveBeenLastCalledWith('cdp', {
                viewId, method: 'Page.captureScreenshot', params: {
                    format, ...(format === 'jpeg' ? { quality: 75 } : {}), captureBeyondViewport: true,
                    clip: { x: 0, y: 0, width: 800, height: 600, scale: 1 },
                },
            });
        }
        await h.host.dispose();
    });

    it('uses an explicit native-only activity command and forwards Stop with its public owner-bound popup id', async () => {
        const h = await opened();
        await h.popup.setControlActivity!('turn');
        expect(mocks.request).toHaveBeenLastCalledWith('control-activity', { viewId: '7:tab:1:popup:1', turnId: 'turn' });
        mocks.onEvent({ event: 'control-stop', viewId: '7:tab:1:popup:1', turnId: 'turn' });
        expect(h.sink.controlStopRequested).toHaveBeenCalledExactlyOnceWith(h.id, 'turn');
        await h.popup.setControlActivity!(null);
        expect(mocks.request).toHaveBeenLastCalledWith('control-activity', { viewId: '7:tab:1:popup:1', turnId: null });
        mocks.request.mockClear();
        await h.root.setControlActivity!('turn');
        expect(mocks.request).not.toHaveBeenCalled();
        await h.popup.close();
        mocks.onEvent({ event: 'control-stop', viewId: '7:tab:1:popup:1', turnId: 'turn' });
        expect(h.sink.controlStopRequested).toHaveBeenCalledOnce();
        await h.host.dispose();
    });

    it('registers correlated native popups and routes control, zoom, navigation and focus to their own handle', async () => {
        const h = await opened();
        expect(h.id).toMatch(/^browser-popout-/);
        mocks.onEvent({ event: 'state', viewId: '7:tab:1:popup:1', state: {
            url: 'https://fixture.test/redirect', title: 'Popup', canGoBack: true, canGoForward: false, loading: false,
        } });
        expect(h.popup.snapshot()).toMatchObject({ viewId: h.id, url: 'https://fixture.test/redirect', title: 'Popup', engine: 'webview2' });
        expect(h.root.snapshot()).toMatchObject({ title: '', url: 'https://fixture.test/' });
        expect(h.sink.state).not.toHaveBeenCalled();
        mocks.request.mockResolvedValueOnce({ result: { value: 42 } });
        await expect(h.popup.cdp!('Runtime.evaluate', { expression: '42' })).resolves.toEqual({ result: { value: 42 } });
        expect(mocks.request).toHaveBeenLastCalledWith('cdp', { viewId: '7:tab:1:popup:1', method: 'Runtime.evaluate', params: { expression: '42' } });
        await h.popup.focus();
        expect(mocks.request).toHaveBeenLastCalledWith('focus', { viewId: '7:tab:1:popup:1' });
        await h.popup.navigate('https://fixture.test/next');
        expect(mocks.request).toHaveBeenLastCalledWith('navigate', { viewId: '7:tab:1:popup:1', url: 'https://fixture.test/next' });
        await h.popup.nav('back');
        expect(mocks.request).toHaveBeenLastCalledWith('nav', { viewId: '7:tab:1:popup:1', action: 'back' });
        await h.popup.setPageZoom!(150);
        expect(mocks.request).toHaveBeenLastCalledWith('page-zoom', { viewId: '7:tab:1:popup:1', pageZoomPercent: 150 });
        mocks.request.mockClear();
        await h.popup.setBounds(null);
        expect(mocks.request).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'control-focused', viewId: '7:tab:1:popup:1' });
        expect(h.sink.controlFocused).toHaveBeenCalledOnce();
        await h.host.dispose();
    });

    it('ignores duplicate, foreign, invalid and late opener events; permits blank authentication popups', async () => {
        const h = await opened();
        h.event(1);
        for (const message of [
            { viewId: '8:tab:1:popup:2', rootId: '7:tab:1', url: 'https://fixture.test/' },
            { viewId: '7:tab:1:popup:2', rootId: '8:tab:1', url: 'https://fixture.test/' },
            { viewId: '7:tab:1:popup:2', rootId: '7:tab:1', url: 'file:///preview.html' },
            { viewId: '7:tab:1:popup:wrong', rootId: '7:tab:1', url: 'https://fixture.test/' },
        ]) mocks.onEvent({ event: 'popup-opened', ...message });
        expect(h.popups.size).toBe(1);
        h.event(2, 'about:blank');
        expect(h.popups.size).toBe(2);
        await h.root.close();
        h.event(3);
        expect(h.popups.size).toBe(0);
        expect(h.sink.controlPopoutOpened).toHaveBeenCalledTimes(2);
        await h.host.dispose();
    });

    it.each(['popup-closed', 'crash'])('retires only the affected popup on %s and ignores late state', async outcome => {
        const h = await opened();
        h.event(2);
        if (outcome === 'crash') {
            mocks.onEvent({ event: 'state', viewId: '7:tab:1:popup:1', state: {
                url: 'https://fixture.test/popup', title: '', canGoBack: false, canGoForward: false, loading: false,
                errorCode: 'runtime-crashed', error: 'Popup crashed',
            } });
        } else mocks.onEvent({ event: 'popup-closed', viewId: '7:tab:1:popup:1', rootId: '7:tab:1' });
        expect(h.sink.controlPopoutClosed).toHaveBeenCalledExactlyOnceWith(h.id);
        expect(mocks.rejectView).toHaveBeenCalledWith('7:tab:1:popup:1');
        await expect(h.popup.cdp!('Runtime.evaluate')).rejects.toThrow('closed');
        await expect(h.root.cdp!('Runtime.evaluate')).resolves.toBeUndefined();
        expect(h.popups.size).toBe(1);
        mocks.onEvent({ event: 'popup-closed', viewId: '7:tab:1:popup:1' });
        mocks.onEvent({ event: 'control-focused', viewId: '7:tab:1:popup:1' });
        expect(h.sink.controlPopoutClosed).toHaveBeenCalledTimes(1);
        expect(h.sink.controlFocused).not.toHaveBeenCalled();
        await h.host.dispose();
    });

    it('closes an individual popup without closing its root or siblings', async () => {
        const h = await opened();
        h.event(2);
        await h.popup.close();
        expect(mocks.request).toHaveBeenLastCalledWith('close', { viewId: '7:tab:1:popup:1' });
        expect(h.popups.size).toBe(1);
        await expect(h.root.cdp!('Runtime.evaluate')).resolves.toBeUndefined();
        await h.host.dispose();
    });

    it.each(['close', 'root-crash', 'helper-crash', 'dispose', 'failed-dispose'])('cleans popup handles and owner listeners on %s', async outcome => {
        const h = await opened();
        h.event(2);
        if (outcome === 'close') await h.root.close();
        else if (outcome === 'root-crash') mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: {
            url: 'https://fixture.test/', title: '', loading: false, canGoBack: false, canGoForward: false,
            errorCode: 'runtime-crashed', error: 'Root crashed',
        } });
        else if (outcome === 'helper-crash') mocks.onFailure(new BrowserHostError('runtime-crashed', 'Helper crashed'));
        else if (outcome === 'failed-dispose') {
            mocks.dispose.mockRejectedValueOnce(new Error('Shutdown failed'));
            await expect(h.host.dispose()).rejects.toThrow('Shutdown failed');
        } else await h.host.dispose();
        expect(h.popups.size).toBe(0);
        expect(h.sink.controlPopoutClosed).toHaveBeenCalledTimes(2);
        await expect(h.popup.cdp!('Runtime.evaluate')).rejects.toThrow('closed');
        if (outcome === 'root-crash' || outcome === 'helper-crash') {
            h.event(3);
            expect(h.popups.size).toBe(0);
            expect(h.sink.controlPopoutOpened).toHaveBeenCalledTimes(2);
        }
        if (outcome !== 'helper-crash' && outcome !== 'root-crash') {
            expect(mocks.window.removeListener).toHaveBeenCalledWith('move', expect.any(Function));
            expect(mocks.window.removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
        } else expect(h.sink.state).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'runtime-crashed' }));
        await h.host.dispose();
    });

    it('makes actual WebView2 popup handles discoverable and controllable only in the owning manager workspace', async () => {
        const host = new WebView2BrowserHost('profile');
        const manager = new BrowserHostManager({
            history: { recordVisit: async () => true, updateTitle: async () => true, flush: async () => {}, clearEngine: async () => true },
            hosts: { webview2: host, electron: { ...host, engine: 'electron', availability: async () => ({ engine: 'electron', available: true }), create: vi.fn(), clearData: vi.fn(), dispose: vi.fn() } },
            fileHost: { create: vi.fn(), dispose: vi.fn() },
            getDefault: () => 'webview2', saveDefault: () => {}, getPageZoom: () => 100, savePageZoom: () => {}, send: vi.fn(), changed: vi.fn(),
        });
        vi.spyOn(host, 'availability').mockResolvedValue({ engine: 'webview2', available: true });
        manager.bindControlScope(7, 'workspace', 'workspace');
        manager.bindControlScope(8, 'other', 'other');
        expect(await manager.open(7, 'tab', 'https://fixture.test/', 'workspace')).toMatchObject({ ok: true });
        mocks.onEvent({ event: 'popup-opened', viewId: '7:tab:1:popup:1', rootId: '7:tab:1', url: 'https://fixture.test/popup' });
        mocks.onEvent({ event: 'state', viewId: '7:tab:1:popup:1', state: {
            url: 'https://fixture.test/popup', title: 'Popup', canGoBack: false, canGoForward: false, loading: false,
        } });
        const run = (ownerId: number, workspaceId: string, command: { action: 'tabs' } | { action: 'select'; tab: string }) =>
            manager.executeControl(ownerId, { id: 'r', processId: 'p', workspaceId, command });
        const tabs = (await run(7, 'workspace', { action: 'tabs' })).tabs!;
        const popup = tabs.find(tab => tab.title === 'Popup')!;
        expect(popup.id).toMatch(/^t7:browser-popout-/);
        expect((await run(8, 'other', { action: 'tabs' })).tabs).toEqual([]);
        await expect(run(8, 'other', { action: 'select', tab: popup.id })).rejects.toThrow('not found');
        mocks.request.mockImplementation(async (op, payload) => op === 'cdp' ? {
            result: { value: { title: 'Popup', url: 'https://fixture.test/popup', elements: [], nextRef: 1 } },
        } : undefined);
        expect((await run(7, 'workspace', { action: 'select', tab: popup.id })).tab).toBe(popup.id);
        expect(mocks.request).toHaveBeenCalledWith('focus', { viewId: '7:tab:1:popup:1' });
        const waiting = manager.executeControl(7, { id: 'wait', processId: 'p', workspaceId: 'workspace', selectedTab: popup.id, command: { action: 'wait', ms: 30_000 } });
        mocks.onEvent({ event: 'popup-closed', viewId: '7:tab:1:popup:1' });
        await expect(waiting).rejects.toThrow('popout closed');
        expect((await run(7, 'workspace', { action: 'tabs' })).tabs).toHaveLength(1);
        await manager.dispose();
    });
});

describe('WebView2 controlled document readiness', () => {
    it('keeps open pending after native acknowledgement until the redirected document completes', async () => {
        const host = new WebView2BrowserHost('profile');
        vi.spyOn(host, 'availability').mockResolvedValue({ engine: 'webview2', available: true });
        const manager = new BrowserHostManager({
            history: { recordVisit: async () => true, updateTitle: async () => true, flush: async () => {}, clearEngine: async () => true },
            hosts: { webview2: host, electron: { ...host, engine: 'electron', create: vi.fn(), dispose: vi.fn() } },
            fileHost: { create: vi.fn(), dispose: vi.fn() },
            getDefault: () => 'webview2', saveDefault: () => {}, getPageZoom: () => 100, savePageZoom: () => {}, send: vi.fn(), changed: vi.fn(),
        });
        manager.bindControlScope(7, 'workspace', 'workspace');
        let nativeId = '';
        let pollObserved!: () => void;
        const polling = new Promise<void>(resolve => { pollObserved = resolve; });
        const create = host.create.bind(host);
        vi.spyOn(host, 'create').mockImplementation(async (...args) => {
            const view = await create(...args);
            const snapshot = view.snapshot.bind(view);
            let controlReadyChecked = false;
            view.waitForControlReady = async () => { controlReadyChecked = true; };
            view.snapshot = () => {
                const state = snapshot();
                if (controlReadyChecked && state.loading) pollObserved();
                return state;
            };
            return view;
        });
        const state = (loading: boolean, url: string, title = '') => mocks.onEvent({
            event: 'state', viewId: nativeId, state: { url, title, loading, canGoBack: false, canGoForward: false },
        });
        mocks.request.mockReset().mockImplementation(async (op, payload) => {
            if (op === 'open') {
                nativeId = payload.viewId;
                // Native acknowledgement precedes NavigationStarting. The initial
                // blank document must remain loading throughout that interval.
                state(true, 'about:blank');
            }
            if (op === 'cdp') return { result: { value: {
                title: 'Workflow fixture', url: 'https://fixture.test/destination', elements: [], nextRef: 1,
            } } };
        });
        try {
            const opened = manager.executeControl(7, {
                id: 'open', processId: 'conversation', workspaceId: 'workspace',
                command: { action: 'open', url: 'https://fixture.test/start' },
            });
            await polling;
            expect(mocks.request.mock.calls.some(([op]) => op === 'cdp')).toBe(false);
            const redirectPolling = new Promise<void>(resolve => { pollObserved = resolve; });
            state(true, 'https://fixture.test/destination'); // Redirect is still loading.
            await redirectPolling;
            expect(mocks.request.mock.calls.some(([op]) => op === 'cdp')).toBe(false);
            state(false, 'https://fixture.test/destination', 'Workflow fixture');
            await expect(opened).resolves.toMatchObject({ title: 'Workflow fixture', url: 'https://fixture.test/destination' });
            expect(mocks.request.mock.calls.filter(([op]) => op === 'cdp')).toHaveLength(1);
            expect(mocks.request.mock.calls.some(([op]) => op === 'navigate')).toBe(false);
        } finally {
            await manager.dispose();
        }
    });
});

describe('WebView2 native focus handoff', () => {
    it('exposes CDP results only for the live owner-qualified native tab', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        mocks.request.mockResolvedValueOnce({ result: { value: 42 } });
        await expect(view.cdp!('Runtime.evaluate', { expression: '6 * 7' })).resolves.toEqual({ result: { value: 42 } });
        expect(mocks.request).toHaveBeenLastCalledWith('cdp', { viewId: '7:tab:1', method: 'Runtime.evaluate', params: { expression: '6 * 7' } });
        mocks.request.mockRejectedValueOnce(new Error('Protocol error'));
        await expect(view.cdp!('Bad.command')).rejects.toThrow('Protocol error');
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: {
            url: 'https://example.test', title: '', canGoBack: false, canGoForward: false, loading: false,
            errorCode: 'runtime-crashed', error: 'Page crashed',
        } });
        await expect(view.cdp!('Runtime.evaluate')).rejects.toThrow('Page crashed');
        await view.close();
        expect(mocks.rejectView).toHaveBeenCalledWith('7:tab:1');
        await expect(view.cdp!('Runtime.evaluate')).rejects.toThrow('Browser tab is closed');
    });

    it('initializes, changes and restores page zoom through native controller commands', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test', pageZoomPercent: 150 }, sink);
        expect(mocks.request).toHaveBeenCalledWith('open', expect.objectContaining({ pageZoomPercent: 150 }));
        await view.setBounds(null);
        await view.setPageZoom!(175);
        expect(mocks.request).toHaveBeenLastCalledWith('page-zoom', { viewId: '7:tab:1', pageZoomPercent: 175 });
        await view.navigate('https://other.test/');
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: {
            url: 'https://other.test/', title: '', canGoBack: true, canGoForward: false, loading: false,
            errorCode: 'runtime-crashed', error: 'Crashed',
        } });
        await view.nav('reload');
        expect(mocks.request).toHaveBeenCalledWith('open', expect.objectContaining({ pageZoomPercent: 175, url: 'https://other.test/' }));
        mocks.request.mockRejectedValueOnce(new Error('Zoom unsupported'));
        await expect(view.setPageZoom!(125)).rejects.toThrow('Zoom unsupported');
        await view.setPageZoom!(100);
        expect(mocks.request).toHaveBeenLastCalledWith('page-zoom', { viewId: '7:tab:1', pageZoomPercent: 100 });
        await view.close();
    });

    beforeEach(() => {
        mocks.request.mockReset().mockResolvedValue(undefined);
        mocks.owner.focus.mockClear();
        vi.mocked(sink.closeRequested).mockClear();
        vi.mocked(sink.openMenuRequested).mockClear();
        vi.mocked(sink.focusAddressRequested!).mockClear();
        mocks.running = true;
        mocks.contentBounds = { x: 100, y: 200, width: 640, height: 480 };
        mocks.dipToScreenPoint.mockReset().mockImplementation(point => point);
        mocks.window.on.mockClear();
        mocks.window.setFullScreen.mockClear();
    });

    it('includes the live content origin in physical screen pixels, independent of viewport bounds', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        mocks.dipToScreenPoint.mockImplementation(({ x, y }) => ({ x: x * 1.5, y: y * 1.5 }));
        await view.setBounds(bounds);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', {
            viewId: '7:tab:1', bounds: { ...bounds, contentOrigin: { x: 150, y: 300 } },
        });
        mocks.contentBounds = { x: -800, y: 226, width: 640, height: 480 };
        await view.setBounds(bounds);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', {
            viewId: '7:tab:1', bounds: { ...bounds, contentOrigin: { x: -1200, y: 339 } },
        });
        await view.setBounds(null);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', { viewId: '7:tab:1', bounds: null });
    });

    it('refreshes the origin when the owner moves or resizes and preserves it in fullscreen', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.contentBounds = { x: 50, y: 80, width: 800, height: 600 };
        for (const [event, reposition] of mocks.window.on.mock.calls) {
            if (event === 'move' || event === 'resize') {
                reposition();
                expect(mocks.request).toHaveBeenLastCalledWith('bounds', {
                    viewId: '7:tab:1', bounds: { ...bounds, contentOrigin: { x: 50, y: 80 } },
                });
            }
        }
        mocks.onEvent({ event: 'fullscreen', viewId: '7:tab:1', fullscreen: true });
        expect(mocks.window.setFullScreen).toHaveBeenLastCalledWith(true);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', {
            viewId: '7:tab:1', bounds: { x: 0, y: 0, width: 800, height: 600, contentOrigin: { x: 50, y: 80 } },
        });
        mocks.onEvent({ event: 'fullscreen', viewId: '7:tab:1', fullscreen: false });
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', {
            viewId: '7:tab:1', bounds: { ...bounds, contentOrigin: { x: 50, y: 80 } },
        });
    });

    it('keeps a hidden background-controlled view rendering off-screen at its last size, without focus', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        const fresh = await host.create({ ownerId: 7, viewId: 'fresh', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        await view.setBounds(null);
        mocks.request.mockClear();
        await view.setBackgroundControl!(true);
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith('bounds', {
            viewId: '7:tab:1', bounds: { x: -(bounds.width + 64), y: 0, width: bounds.width, height: bounds.height, contentOrigin: { x: 100, y: 200 } },
        });
        // Idempotent, and a real placement still wins while background control is on.
        await view.setBackgroundControl!(true);
        await view.setBounds(bounds);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', { viewId: '7:tab:1', bounds: { ...bounds, contentOrigin: { x: 100, y: 200 } } });
        await view.setBounds(null);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', expect.objectContaining({ bounds: expect.objectContaining({ x: -(bounds.width + 64) }) }));
        await view.setBackgroundControl!(false);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', { viewId: '7:tab:1', bounds: null });
        // A view never placed on screen gets an ordinary desktop viewport.
        await fresh.setBackgroundControl!(true);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', {
            viewId: '7:fresh:2', bounds: { x: -1344, y: 0, width: 1280, height: 800, contentOrigin: { x: 100, y: 200 } },
        });
        expect(mocks.request).not.toHaveBeenCalledWith('focus', expect.anything());
        expect(mocks.window.focus).not.toHaveBeenCalled();
    });

    it('forwards close only for the matching live visible native view', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'remote-workspace', url: 'https://example.test' }, sink);
        mocks.onEvent({ event: 'close-requested', viewId: '7:tab:1' });
        expect(sink.closeRequested).not.toHaveBeenCalled();
        await view.setBounds(bounds);
        mocks.onEvent({ event: 'close-requested', viewId: '8:tab:1' });
        expect(sink.closeRequested).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'close-requested', viewId: '7:tab:1' });
        expect(sink.closeRequested).toHaveBeenCalledOnce();
        expect(mocks.request).not.toHaveBeenCalledWith('close', expect.anything());
        await view.close();
        mocks.onEvent({ event: 'close-requested', viewId: '7:tab:1' });
        expect(sink.closeRequested).toHaveBeenCalledOnce();
    });

    it('returns focus and forwards add-menu only for a live visible source view', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'remote-workspace', url: 'https://example.test' }, sink);
        mocks.onEvent({ event: 'open-menu-requested', viewId: '7:tab:1' });
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        await view.setBounds(bounds);
        mocks.onEvent({ event: 'open-menu-requested', viewId: '8:tab:1' });
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'open-menu-requested', viewId: '7:tab:1' });
        await vi.waitFor(() => expect(sink.openMenuRequested).toHaveBeenCalledOnce());
        expect(mocks.owner.focus).toHaveBeenCalled();
        expect(mocks.request).toHaveBeenCalledWith('focus-host', { viewId: '7:tab:1' });
        await view.close();
        mocks.onEvent({ event: 'open-menu-requested', viewId: '7:tab:1' });
        expect(sink.openMenuRequested).toHaveBeenCalledOnce();
    });

    it('hands native focus back before forwarding an address request, rejecting hidden and foreign views', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'remote-workspace', url: 'https://example.test' }, sink);
        mocks.onEvent({ event: 'focus-address-requested', viewId: '7:tab:1' });
        expect(sink.focusAddressRequested).not.toHaveBeenCalled();
        await view.setBounds(bounds);
        mocks.onEvent({ event: 'focus-address-requested', viewId: '8:tab:1' });
        expect(sink.focusAddressRequested).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'focus-address-requested', viewId: '7:tab:1' });
        await vi.waitFor(() => expect(sink.focusAddressRequested).toHaveBeenCalledOnce());
        expect(mocks.request).toHaveBeenCalledWith('focus-host', { viewId: '7:tab:1' });
        expect(mocks.owner.focus.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sink.focusAddressRequested!).mock.invocationCallOrder[0]);
        await view.close();
        mocks.onEvent({ event: 'focus-address-requested', viewId: '7:tab:1' });
        expect(sink.focusAddressRequested).toHaveBeenCalledOnce();
    });

    it('returns focus and forwards reopen-closed only for a live visible source view', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'remote-workspace', url: 'https://example.test' }, sink);
        mocks.onEvent({ event: 'reopen-closed-requested', viewId: '7:tab:1' });
        expect(sink.reopenClosedRequested).not.toHaveBeenCalled();
        await view.setBounds(bounds);
        mocks.onEvent({ event: 'reopen-closed-requested', viewId: '8:tab:1' });
        expect(sink.reopenClosedRequested).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'reopen-closed-requested', viewId: '7:tab:1' });
        await vi.waitFor(() => expect(sink.reopenClosedRequested).toHaveBeenCalledOnce());
        expect(mocks.request).toHaveBeenCalledWith('focus-host', { viewId: '7:tab:1' });
        expect(mocks.owner.focus.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sink.reopenClosedRequested!).mock.invocationCallOrder[0]);
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        await view.close();
        mocks.onEvent({ event: 'reopen-closed-requested', viewId: '7:tab:1' });
        expect(sink.reopenClosedRequested).toHaveBeenCalledOnce();
    });

    it('does not start a helper when no browser view is present', async () => {
        const host = new WebView2BrowserHost('profile');
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('returns focus only for visible views belonging to the requesting window', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.request.mockClear();
        await host.focusOwner(2);
        expect(mocks.request).not.toHaveBeenCalled();
        await host.focusOwner(1);
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith('focus-host', { viewId: '1:tab:1' });
        await view.setBounds(null);
        mocks.request.mockClear();
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('ignores closed views and stopped helpers', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.running = false;
        mocks.request.mockClear();
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
        mocks.running = true;
        await view.close();
        mocks.request.mockClear();
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('surfaces native focus handoff failures', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.request.mockRejectedValueOnce(new Error('Native focus failed'));
        await expect(host.focusOwner(1)).rejects.toThrow('Native focus failed');
    });

    it('also releases native keyboard focus when the browser tabs back into the host', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.request.mockClear();
        mocks.onEvent({ event: 'focus-host', viewId: '1:tab:1' });
        expect(mocks.owner.focus).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledExactlyOnceWith('focus-host', { viewId: '1:tab:1' }));
    });
});

it.each([false, true])('preserves quoted session values and auth-cookie parts through WebView2 (with page: %s)', async withPage => {
    mocks.request.mockClear();
    const host = new WebView2BrowserHost('profile');
    const sink: BrowserEventSink = { state: vi.fn(), newTab: vi.fn(), download: vi.fn(), closeRequested: vi.fn(), openMenuRequested: vi.fn() };
    const target = withPage ? await host.create({ ownerId: 7, viewId: 'import', sessionKey: 'workspace', url: 'https://login.example.com' }, sink) : host;
    const { parseBrowserCookies } = await import('../src/browser-cookie-import');
    const cookies = parseBrowserCookies('original.example.com', JSON.stringify([
        { name: 'fixture_session', value: '"fixture\\segment"', httpOnly: true },
        { name: 'fixture_auth_0', value: 'fixture-part-0==%2F+/', httpOnly: true },
        { name: 'fixture_auth_1', value: 'fixture-part-1==', httpOnly: true },
    ]));
    mocks.request.mockClear();
    await target.importCookies!(cookies);
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(withPage ? 'import-cookies' : 'import-profile-cookies',
        { ...(withPage ? { viewId: '7:import:1' } : {}), cookies });
});

it.each([false, true])('sends pair and JSON expiry in Unix seconds to WebView2, retaining JSON sessions (with page: %s)', async withPage => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_123);
    try {
        const { parseBrowserCookies } = await import('../src/browser-cookie-import');
        const host = new WebView2BrowserHost('profile');
        const target = withPage ? await host.create({ ownerId: 7, viewId: 'import', sessionKey: 'workspace', url: 'https://login.example.com' }, sink) : host;
        mocks.request.mockClear();
        const pairs = parseBrowserCookies('original.example.com', 'fixture_pair=token');
        const json = parseBrowserCookies('original.example.com', JSON.stringify([
            { name: 'fixture_persistent', value: 'token', expires: 1_800_003_600.5 },
            { name: 'fixture_session', value: 'token', session: true, expirationDate: 1_800_003_600 },
        ]));
        await target.importCookies!(pairs);
        await target.importCookies!(json);
        expect(pairs[0].expirationDate).toBe(1_802_592_000.123);
        expect(json[0].expirationDate).toBe(1_800_003_600.5);
        expect(json[1]).not.toHaveProperty('expirationDate');
        const op = withPage ? 'import-cookies' : 'import-profile-cookies';
        const routing = withPage ? { viewId: '7:import:1' } : {};
        expect(mocks.request.mock.calls).toEqual([[op, { ...routing, cookies: pairs }], [op, { ...routing, cookies: json }]]);
    } finally { clock.mockRestore(); }
});

describe('WebView2 explicit history events', () => {
    const historySink: BrowserEventSink = { ...sink, state: vi.fn(), visited: vi.fn(), titleUpdated: vi.fn() };
    const state = { url: 'https://tab.test/', title: 'Tab', canGoBack: false, canGoForward: false, loading: false };
    it('qualifies committed document events by native source, excluding same-URL popups and missing source metadata', async () => {
        const documentCommitted = vi.fn(), documentTitleUpdated = vi.fn();
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url },
            { ...historySink, documentCommitted, documentTitleUpdated });
        for (const event of ['visited', 'title-updated']) {
            mocks.onEvent({ event, viewId: '7:tab:1', sourceViewId: '7:tab:1:popup:1', url: state.url, title: 'Popup' });
            mocks.onEvent({ event, viewId: '7:tab:1', url: state.url, title: 'Unqualified' });
        }
        expect(documentCommitted).not.toHaveBeenCalled();
        expect(documentTitleUpdated).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', sourceViewId: '7:tab:1', url: state.url, title: 'Document' });
        mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', sourceViewId: '7:tab:1', url: state.url, title: 'Updated' });
        expect(documentCommitted).toHaveBeenCalledExactlyOnceWith(state.url, 'Document');
        expect(documentTitleUpdated).toHaveBeenCalledExactlyOnceWith(state.url, 'Updated');
        await view.close();
    });
    it('invalidates the committed copy identity at the start of a new native navigation', async () => {
        const navigationStarted = vi.fn();
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, { ...historySink, navigationStarted });
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
        expect(navigationStarted).toHaveBeenCalledOnce();
        await view.close();
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
        expect(navigationStarted).toHaveBeenCalledOnce();
    });

    beforeEach(() => {
        mocks.request.mockReset().mockResolvedValue(undefined);
        mocks.running = true;
        vi.mocked(historySink.visited!).mockClear();
        vi.mocked(historySink.titleUpdated!).mockClear();
        vi.mocked(historySink.state).mockClear();
    });

    it('records explicit final URLs while state replay, snapshots and placement do not record', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, historySink);
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
        view.snapshot();
        await view.setBounds(bounds);
        await view.setBounds(null);
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
        expect(historySink.visited).not.toHaveBeenCalled();
        expect(historySink.titleUpdated).not.toHaveBeenCalled();
        const url = 'http://127.0.0.1/Final?Case=Keep#fragment';
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url, title: 'Final' });
        mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', url, title: 'New title' });
        expect(historySink.visited).toHaveBeenCalledExactlyOnceWith(url, 'Final');
        expect(historySink.titleUpdated).toHaveBeenCalledExactlyOnceWith(url, 'New title');
        expect(view.snapshot()).toMatchObject(state);
        await view.close();
    });

    it('keeps popup documents independent from tab navigation state', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, historySink);
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url: 'https://auth.test/login', title: 'Sign in' });
        mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', url: 'https://auth.test/login', title: 'Signed in' });
        expect(historySink.visited).toHaveBeenCalledExactlyOnceWith('https://auth.test/login', 'Sign in');
        expect(historySink.titleUpdated).toHaveBeenCalledExactlyOnceWith('https://auth.test/login', 'Signed in');
        expect(view.snapshot()).toMatchObject(state);
        await view.close();
    });

    it('rejects malformed/non-HTTP events and callbacks for foreign or closed views', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, historySink);
        for (const event of ['visited', 'title-updated']) {
            for (const fields of [
                { url: 'file:///tmp/preview.html', title: 'Preview' },
                { url: 'about:blank', title: 'Blank' },
                { url: 'javascript:alert(1)', title: 'Script' },
                { url: 'https://exa\nmple.test/', title: 'Invalid' },
                { url: 'https://example.test/', title: 1 },
                { url: 1, title: 'Invalid' },
                { url: 'https://example.test/' },
            ]) { mocks.onEvent({ event, viewId: '7:tab:1', ...fields }); }
            mocks.onEvent({ event, viewId: '8:tab:1', url: state.url, title: state.title });
        }
        await view.close();
        for (const event of ['visited', 'title-updated']) {
            mocks.onEvent({ event, viewId: '7:tab:1', url: state.url, title: state.title });
        }
        expect(historySink.visited).not.toHaveBeenCalled();
        expect(historySink.titleUpdated).not.toHaveBeenCalled();
    });

    it('routes events to their exact owner and rejects callbacks after same-tab recreation', async () => {
        const host = new WebView2BrowserHost('profile');
        const other: BrowserEventSink = { ...historySink, visited: vi.fn(), titleUpdated: vi.fn() };
        const first = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace-a', url: state.url }, historySink);
        const second = await host.create({ ownerId: 8, viewId: 'tab', sessionKey: 'workspace-b', url: state.url }, other);
        mocks.onEvent({ event: 'visited', viewId: '8:tab:2', url: 'https://other.test/', title: 'Other' });
        expect(other.visited).toHaveBeenCalledExactlyOnceWith('https://other.test/', 'Other');
        expect(historySink.visited).not.toHaveBeenCalled();
        await first.close();
        const replacement = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace-a', url: state.url }, historySink);
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url: state.url, title: state.title });
        mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', url: state.url, title: state.title });
        expect(historySink.visited).not.toHaveBeenCalled();
        expect(historySink.titleUpdated).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'visited', viewId: '7:tab:3', url: state.url, title: state.title });
        expect(historySink.visited).toHaveBeenCalledOnce();
        await replacement.close();
        await second.close();
    });

    it('persists sanitized visits and titles without resurrecting deletions from state or title events', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-webview2-history-'));
        const history = new BrowserHistoryStore(directory);
        const pending: Promise<unknown>[] = [];
        const persistentSink: BrowserEventSink = {
            ...historySink,
            visited: (url, title) => { pending.push(history.recordVisit('webview2', url, title)); },
            titleUpdated: (url, title) => { pending.push(history.updateTitle('webview2', url, title)); },
        };
        try {
            const host = new WebView2BrowserHost('profile');
            const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, persistentSink);
            const url = 'https://user:secret@final.test/Path?q=Case#Part';
            for (let visit = 0; visit < 2; visit++) { mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url, title: 'Final' }); }
            mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', url, title: 'Updated' });
            await Promise.all(pending);
            const entries = (await history.query()).entries;
            expect(entries).toEqual([expect.objectContaining({ url: 'https://final.test/Path?q=Case#Part', title: 'Updated', visitCount: 2 })]);
            expect((await new BrowserHistoryStore(directory).query()).entries).toEqual(entries);
            await history.delete(entries[0].url);
            mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', url, title: 'Late title' });
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
            await Promise.all(pending);
            expect((await history.query()).entries).toEqual([]);
            mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url, title: 'New visit' });
            await Promise.all(pending);
            expect((await history.query()).entries).toEqual([expect.objectContaining({ visitCount: 1, title: 'New visit' })]);
            await view.close();
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
});

describe('WebView2 agent navigation approval gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.request.mockReset().mockResolvedValue(undefined);
        mocks.running = true;
    });

    async function opened(navigationGate?: (url: string, popoutViewId?: string) => boolean | Promise<boolean>) {
        const popups = new Map<string, BrowserHostedView>();
        const gateSink: BrowserEventSink = { ...sink, navigationGate: vi.fn(navigationGate ?? (() => true)),
            controlPopoutOpened: vi.fn((id, popup) => popups.set(id, popup)), controlPopoutClosed: vi.fn(id => popups.delete(id)) };
        const host = new WebView2BrowserHost('profile');
        const root = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: 'https://start.test/', navigationGate: true }, gateSink);
        return { host, root, sink: gateSink, popups };
    }
    const navigates = () => mocks.request.mock.calls.filter(call => call[0] === 'navigate');

    it('opens gated, toggles root and popup gates natively, and keeps popups gated while their root is', async () => {
        const h = await opened();
        expect(mocks.request).toHaveBeenCalledWith('open', expect.objectContaining({ viewId: '7:tab:1', navigationGate: true }));
        mocks.onEvent({ event: 'popup-opened', viewId: '7:tab:1:popup:1', rootId: '7:tab:1', url: 'https://start.test/popup' });
        const [, popup] = [...h.popups][0];
        mocks.request.mockClear();
        await popup.setNavigationGate!(true);
        expect(mocks.request).toHaveBeenLastCalledWith('navigation-gate', { viewId: '7:tab:1:popup:1', navigationGate: true });
        await popup.setNavigationGate!(false);
        expect(mocks.request).toHaveBeenLastCalledWith('navigation-gate', { viewId: '7:tab:1:popup:1', navigationGate: true });
        mocks.request.mockClear();
        await h.root.setNavigationGate!(false);
        expect(mocks.request.mock.calls).toEqual([
            ['navigation-gate', { viewId: '7:tab:1', navigationGate: false }],
            ['navigation-gate', { viewId: '7:tab:1:popup:1', navigationGate: false }],
        ]);
        mocks.request.mockClear();
        await h.root.setNavigationGate!(false);
        expect(mocks.request).not.toHaveBeenCalled();
        await h.host.dispose();
    });

    it('re-issues a natively cancelled navigation only after the sink allows it', async () => {
        let decide!: (allow: boolean) => void;
        const h = await opened(() => new Promise<boolean>(resolve => { decide = resolve; }));
        mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1', url: 'https://other.test/login' });
        expect(h.sink.navigationGate).toHaveBeenCalledExactlyOnceWith('https://other.test/login');
        await Promise.resolve();
        expect(navigates()).toEqual([]);
        decide(true);
        await vi.waitFor(() => expect(navigates()).toEqual([['navigate', { viewId: '7:tab:1', url: 'https://other.test/login', approved: true }]]));
        // Deny leaves the previous page: nothing is re-issued.
        mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1', url: 'https://blocked.test/' });
        decide(false);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(navigates()).toHaveLength(1);
        await h.host.dispose();
    });

    it('asks through the root sink with the public popout id for popup navigations', async () => {
        const h = await opened();
        mocks.onEvent({ event: 'popup-opened', viewId: '7:tab:1:popup:1', rootId: '7:tab:1', url: 'https://start.test/popup' });
        const [id] = [...h.popups][0];
        mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1:popup:1', url: 'https://sso.test/' });
        expect(h.sink.navigationGate).toHaveBeenCalledExactlyOnceWith('https://sso.test/', id);
        await vi.waitFor(() => expect(navigates()).toEqual([['navigate', { viewId: '7:tab:1:popup:1', url: 'https://sso.test/', approved: true }]]));
        await h.host.dispose();
    });

    it('drops late approvals after a newer navigation, a newer gate, closure, or invalid events', async () => {
        const decisions: Array<(allow: boolean) => void> = [];
        const h = await opened(() => new Promise<boolean>(resolve => { decisions.push(resolve); }));
        mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1', url: 'https://first.test/' });
        await h.root.navigate('https://typed.test/');
        decisions[0](true);
        mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1', url: 'https://older.test/' });
        mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1', url: 'https://newer.test/' });
        decisions[1](true);
        for (const message of [{ url: 'file:///C:/x.html' }, { url: 42 }, { viewId: 'foreign', url: 'https://x.test/' }]) {
            mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1', ...message });
        }
        expect(decisions).toHaveLength(3);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(navigates()).toEqual([['navigate', { viewId: '7:tab:1', url: 'https://typed.test/' }]]);
        await h.root.close();
        decisions[2](true);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(navigates()).toHaveLength(1);
        await h.host.dispose();
    });
});

describe('WebView2 site information facts', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.request.mockReset().mockResolvedValue(undefined); });

    it('recognizes only the native helper certificate statuses', async () => {
        const { isWebView2CertificateError } = await import('../src/webview2-browser-host');
        expect([1, 2, 3, 4, 5].every(status => isWebView2CertificateError(`Navigation failed (${status})`))).toBe(true);
        for (const error of [undefined, '', 'Navigation failed (0)', 'Navigation failed (6)', 'Navigation failed (12)', 'Certificate (2)', 'Navigation failed (2) extra']) {
            expect(isWebView2CertificateError(error)).toBe(false);
        }
    });

    it('counts cookies through the view CDP transport, never claims certificate verification, and hides failures', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'site', sessionKey: 'workspace', url: 'https://fixture.test/' }, sink);
        mocks.request.mockReset().mockImplementation(async (op: string) => op === 'cdp'
            ? { cookies: [{ name: 'sid', value: 'secret' }, { name: 'pref', value: 'x' }] } : undefined);
        const facts = await view.siteFacts!('https://fixture.test/page');
        expect(facts).toEqual({ rejectsInvalidCertificates: false, certificateError: false, cookieCount: 2 });
        expect(JSON.stringify(facts)).not.toContain('secret');
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith('cdp', { viewId: '7:site:1', method: 'Network.getCookies', params: { urls: ['https://fixture.test/page'] } });
        mocks.request.mockClear();
        expect(await view.siteFacts!()).toEqual({ rejectsInvalidCertificates: false, certificateError: false });
        expect(mocks.request).not.toHaveBeenCalled();
        const failed = { url: 'https://fixture.test/', title: '', loading: false, canGoBack: false, canGoForward: false, errorCode: 'navigation-failed' };
        mocks.onEvent({ event: 'state', viewId: '7:site:1', state: { ...failed, error: 'Navigation failed (2)' } });
        expect((await view.siteFacts!()).certificateError).toBe(true);
        mocks.onEvent({ event: 'state', viewId: '7:site:1', state: { ...failed, error: 'Navigation failed (9)' } });
        expect((await view.siteFacts!()).certificateError).toBe(false);
        mocks.request.mockRejectedValueOnce(new Error('secret=value'));
        const hidden = await view.siteFacts!('https://fixture.test/');
        expect(hidden.cookieCount).toBeUndefined();
        expect(JSON.stringify(hidden)).not.toContain('secret');
    });
});

it('offers explicit system-browser fallback without replaying authenticated/non-idempotent download URLs', async () => {
    const host = new WebView2BrowserHost('profile');
    const download = vi.fn();
    const view = await host.create({ ownerId: 7, viewId: 'fallback-download', sessionKey: 'workspace', url: 'https://files.test/source' }, { ...sink, download });
    const nativeId = mocks.request.mock.calls.filter(call => call[0] === 'open').at(-1)![1].viewId;
    mocks.onEvent({ event: 'download', viewId: nativeId, url: 'https://user:secret@files.test/file?auth=token#private' });
    expect(shell.openExternal).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledWith({ viewId: 'fallback-download', url: 'files.test', ok: false,
        error: 'WebView2 cannot manage this download. Use Open in system browser to download from the source page.' });
    expect(JSON.stringify(download.mock.calls)).not.toMatch(/secret|token|private|auth=/);
    await view.close();
    download.mockClear();
    mocks.onEvent({ event: 'download', viewId: nativeId, url: 'https://files.test/file' });
    expect(download).not.toHaveBeenCalled();
});
