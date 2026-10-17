import type { BrowserImportCookie } from './browser-cookie-import';
import { BrowserWindow, screen, shell, webContents } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BROWSER_FRAME_CDP_EVENTS, BrowserHostError, validBrowserCdpSession, type BrowserCdpEventListener, type BrowserEngineHost, type BrowserEventSink, type BrowserHostedView, type BrowserViewRequest } from './browser-host-contract';
import { validateBrowserUrl, type BrowserAvailability, type BrowserViewState } from './browser-view-policy';
import { browserMessage, WebView2Process } from './webview2-process';
import type { HtmlPageBounds } from './html-page-policy';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

interface NativeEntry {
    root?: NativeEntry;
    nativeId: string;
    request: BrowserViewRequest;
    sink: BrowserEventSink;
    state: BrowserViewState;
    bounds: HtmlPageBounds | null;
    parent: string;
    window: BrowserWindow;
    fullscreen: boolean;
    wasFullscreen: boolean;
    pageZoom: number;
    reposition(): void;
    cdpListeners: Set<BrowserCdpEventListener>;
    cdpSessions: Map<string, string | undefined>;
    cdpReady: Promise<void>;
    cdpGeneration: number;
    cdpError?: Error;
}

export class WebView2BrowserHost implements BrowserEngineHost {
    readonly engine = 'webview2' as const;
    private readonly views = new Map<string, NativeEntry>();
    private sequence = 0;
    private readonly process: WebView2Process;

    constructor(profilePath: string) {
        this.process = new WebView2Process(() => this.binary(), profilePath, message => this.event(message), error => {
            for (const entry of [...this.views.values()]) {
                if (entry.root) { this.remove(entry.nativeId, entry); continue; }
                entry.state = { ...entry.state, loading: false, errorCode: error.reason, error: error.message };
                this.clearCdp(entry);
                entry.sink.state(entry.state);
            }
        });
    }

    private binary(): string {
        // Neither non-Windows hosts nor CoC server processes load or initialize WebView2.
        return (require('@plusplusoneplusplus/coc-native') as typeof import('@plusplusoneplusplus/coc-native')).loadWebView2Binary();
    }

    async availability(): Promise<BrowserAvailability> {
        if (process.platform !== 'win32' || process.arch !== 'x64') {
            return { engine: this.engine, available: false, reason: 'unsupported-platform', message: 'WebView2 is available only on Windows x64. Use Electron on this platform.' };
        }
        try {
            const { stdout } = await execFileAsync(this.binary(), ['--check'], { timeout: 10_000, windowsHide: true });
            const result = browserMessage(JSON.parse(stdout));
            if (result?.available === true) { return { engine: this.engine, available: true }; }
            if (result?.reason === 'missing-runtime') { return {
                engine: this.engine, available: false, reason: 'missing-runtime',
                message: 'Install the Microsoft Edge WebView2 Runtime, then retry. CoC does not install it automatically.',
            }; }
            return { engine: this.engine, available: false, reason: 'native-unavailable', message: 'WebView2 capability check failed. Reinstall CoC.' };
        } catch (error) {
            return { engine: this.engine, available: false, reason: 'native-unavailable', message: error instanceof Error ? error.message : String(error) };
        }
    }

    private bounds(entry: NativeEntry): (HtmlPageBounds & { contentOrigin: { x: number; y: number } }) | null {
        if (!entry.bounds || entry.window.isDestroyed()) { return null; }
        const { x, y, width, height } = entry.window.getContentBounds();
        return {
            ...(entry.fullscreen ? { x: 0, y: 0, width, height } : entry.bounds),
            contentOrigin: screen.dipToScreenPoint({ x, y }),
        };
    }

    async create(request: BrowserViewRequest, sink: BrowserEventSink): Promise<BrowserHostedView> {
        const owner = webContents.fromId(request.ownerId);
        const window = owner ? BrowserWindow.fromWebContents(owner) : null;
        if (!window || window.isDestroyed() || window.webContents !== owner) { throw new BrowserHostError('no-window', 'Browser window is closed.'); }
        const handle = window.getNativeWindowHandle();
        const parent = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
        const id = `${request.ownerId}:${request.viewId}:${++this.sequence}`;
        const entry: NativeEntry = {
            nativeId: id, request, sink, parent, window, bounds: null, fullscreen: false, wasFullscreen: window.isFullScreen(), pageZoom: request.pageZoomPercent ?? 100,
            cdpListeners: new Set(), cdpSessions: new Map(), cdpReady: Promise.resolve(), cdpGeneration: 0,
            state: { viewId: request.viewId, engine: 'webview2', url: request.url, title: '', canGoBack: false, canGoForward: false, loading: true },
            reposition: () => {
                if (entry.bounds && !window.isDestroyed()) { void this.process.request('bounds', { viewId: id, bounds: this.bounds(entry) }).catch(error => this.viewFailure(entry, error)); }
            },
        };
        this.views.set(id, entry);
        window.on('move', entry.reposition);
        window.on('resize', entry.reposition);
        try { await this.process.request('open', { viewId: id, url: request.url, parent, pageZoomPercent: entry.pageZoom }); }
        catch (error) {
            this.remove(id, entry);
            throw error;
        }
        return this.hosted(entry);
    }

    private hosted(entry: NativeEntry): BrowserHostedView {
        const id = entry.nativeId;
        return {
            cdp: async (method, params = {}, sessionId) => {
                await entry.cdpReady;
                if (this.views.get(id) !== entry) { throw new BrowserHostError('not-found', 'Browser tab is closed.'); }
                if (entry.state.errorCode === 'runtime-crashed') { throw new BrowserHostError('runtime-crashed', entry.state.error ?? 'Browser page crashed.'); }
                if (entry.cdpError) { throw entry.cdpError; }
                if (sessionId !== undefined && (!validBrowserCdpSession(sessionId) || !entry.cdpSessions.has(sessionId))) {
                    throw new BrowserHostError('invalid', 'Browser frame session does not belong to this view.');
                }
                return this.process.request('cdp', { viewId: id, method, params, ...(sessionId !== undefined ? { sessionId } : {}) });
            },
            onCdpEvent: listener => {
                if (this.views.get(id) !== entry) { throw new BrowserHostError('not-found', 'Browser tab is closed.'); }
                if (!entry.cdpListeners.size) { this.subscribeCdp(entry, true); }
                const registration: BrowserCdpEventListener = (...args) => listener(...args);
                entry.cdpListeners.add(registration);
                let disposed = false;
                return () => {
                    if (disposed) { return; }
                    disposed = true;
                    entry.cdpListeners.delete(registration);
                    if (!entry.cdpListeners.size && this.views.get(id) === entry) {
                        entry.cdpSessions.clear();
                        this.subscribeCdp(entry, false);
                    }
                };
            },
            waitForCdpEvents: async () => {
                await entry.cdpReady;
                if (this.views.get(id) !== entry) { throw new BrowserHostError('not-found', 'Browser tab is closed.'); }
                if (entry.cdpError) { throw entry.cdpError; }
            },
            setControlActivity: turnId => entry.root && this.views.get(id) === entry
                ? this.process.request('control-activity', { viewId: id, turnId })
                : undefined,
            importCookies: cookies => this.process.request('import-cookies', { viewId: id, cookies }),
            snapshot: () => ({ ...entry.state }),
            navigate: async url => {
                entry.request.url = url;
                await this.process.request('navigate', { viewId: id, url });
            },
            nav: async action => {
                if (action === 'reload' && entry.state.errorCode === 'runtime-crashed') {
                    if (this.process.running) { await this.process.request('close', { viewId: id }); }
                    entry.state = { ...entry.state, error: undefined, errorCode: undefined, loading: true };
                    await this.process.request('open', { viewId: id, url: entry.request.url, parent: entry.parent, pageZoomPercent: entry.pageZoom });
                    await this.process.request('bounds', { viewId: id, bounds: this.bounds(entry) });
                } else { await this.process.request('nav', { viewId: id, action }); }
            },
            setPageZoom: async percent => {
                await this.process.request('page-zoom', { viewId: id, pageZoomPercent: percent });
                entry.pageZoom = percent;
            },
            setBounds: async bounds => {
                if (entry.root) { return; }
                entry.bounds = bounds;
                await this.process.request('bounds', { viewId: id, bounds: this.bounds(entry) });
            },
            focus: async () => {
                if (this.views.get(id) !== entry || entry.window.isDestroyed()) {
                    throw new BrowserHostError('not-found', 'Browser tab is closed.');
                }
                if (!entry.root) {
                    entry.window.show();
                    entry.window.focus();
                }
                await this.process.request('focus', { viewId: id });
            },
            close: async () => {
                this.remove(id, entry);
                if (this.process.running) { await this.process.request('close', { viewId: id }); }
            },
        };
    }

    private clearCdp(entry: NativeEntry): void {
        entry.cdpGeneration++;
        entry.cdpListeners.clear();
        entry.cdpSessions.clear();
        entry.cdpError = undefined;
        entry.cdpReady = Promise.resolve();
    }

    private subscribeCdp(entry: NativeEntry, enabled: boolean): void {
        const generation = ++entry.cdpGeneration;
        entry.cdpError = undefined;
        entry.cdpReady = entry.cdpReady.catch(() => {}).then(async () => {
            try {
                for (const method of BROWSER_FRAME_CDP_EVENTS) {
                    if (enabled && entry.cdpGeneration !== generation
                        || this.views.get(entry.nativeId) !== entry || entry.state.errorCode === 'runtime-crashed') { return; }
                    await this.process.request('cdp-subscribe', { viewId: entry.nativeId, method, enabled });
                }
            } catch (error) {
                if (enabled && entry.cdpGeneration === generation && this.process.running && this.views.get(entry.nativeId) === entry) {
                    await Promise.all(BROWSER_FRAME_CDP_EVENTS.map(method => this.process.request('cdp-subscribe', { viewId: entry.nativeId, method, enabled: false }).catch(() => {})));
                }
                if (entry.cdpGeneration === generation) { entry.cdpError = error instanceof Error ? error : new Error(String(error)); }
                throw error;
            }
        });
        void entry.cdpReady.catch(() => {});
    }

    private remove(id: string, entry: NativeEntry): void {
        if (this.views.get(id) !== entry) { return; }
        this.views.delete(id);
        this.clearCdp(entry);
        this.process.rejectView(id);
        if (entry.root) {
            entry.root.sink.controlPopoutClosed?.(entry.request.viewId);
            return;
        }
        this.removePopups(entry);
        entry.window.removeListener('move', entry.reposition);
        entry.window.removeListener('resize', entry.reposition);
        if (entry.fullscreen && !entry.wasFullscreen && !entry.window.isDestroyed()) { entry.window.setFullScreen(false); }
    }

    private removePopups(root: NativeEntry): void {
        for (const popup of [...this.views.values()]) {
            if (popup.root === root) { this.remove(popup.nativeId, popup); }
        }
    }

    async focusOwner(ownerId: number): Promise<void> {
        const entry = [...this.views.values()].find(view => view.request.ownerId === ownerId && view.bounds);
        if (entry && this.process.running) {
            await this.process.request('focus-host', { viewId: entry.nativeId });
        }
    }

    private viewFailure(entry: NativeEntry, error: unknown): void {
        if (this.views.get(entry.nativeId) !== entry) { return; }
        entry.state = { ...entry.state, loading: false, errorCode: 'runtime-crashed', error: error instanceof Error ? error.message : String(error) };
        this.clearCdp(entry);
        if (entry.root) { this.remove(entry.nativeId, entry); }
        else {
            this.removePopups(entry);
            entry.sink.state(entry.state);
        }
    }

    private event(message: Record<string, unknown>): void {
        if (typeof message.viewId !== 'string') { return; }
        if (message.event === 'popup-opened') {
            const root = typeof message.rootId === 'string' ? this.views.get(message.rootId) : undefined;
            if (!root || root.root || root.state.errorCode === 'runtime-crashed' || root.window.isDestroyed() || this.views.has(message.viewId)
                || !message.viewId.startsWith(`${root.nativeId}:popup:`)
                || !/^[1-9]\d*$/.test(message.viewId.slice(root.nativeId.length + 7))
                || typeof message.url !== 'string' || (message.url !== 'about:blank' && !validateBrowserUrl(message.url).ok)) { return; }
            const viewId = `browser-popout-${randomUUID()}`;
            const popup: NativeEntry = {
                ...root, root, nativeId: message.viewId,
                request: { ...root.request, viewId, url: message.url },
                state: { ...root.state, viewId, url: message.url, title: '', loading: true, canGoBack: false, canGoForward: false, error: undefined, errorCode: undefined },
                bounds: null, fullscreen: false,
                cdpListeners: new Set(), cdpSessions: new Map(), cdpReady: Promise.resolve(), cdpGeneration: 0, cdpError: undefined,
            };
            this.views.set(message.viewId, popup);
            root.sink.controlPopoutOpened?.(viewId, this.hosted(popup));
            return;
        }
        const entry = this.views.get(message.viewId);
        if (!entry) { return; }
        if (message.event === 'cdp-error') {
            if (!entry.cdpListeners.size) { return; }
            entry.cdpError = new BrowserHostError(message.reason === 'native-unavailable' ? 'native-unavailable' : 'invalid',
                typeof message.message === 'string' ? message.message.slice(0, 1024) : 'WebView2 CDP event stream failed.');
            entry.cdpSessions.clear();
            this.process.rejectView(entry.nativeId, entry.cdpError);
            for (const listener of [...entry.cdpListeners]) { listener('Inspector.detached', { reason: entry.cdpError.message }); }
            return;
        }
        if (message.event === 'cdp-event') {
            if (!entry.cdpListeners.size || entry.cdpError || typeof message.method !== 'string'
                || !(BROWSER_FRAME_CDP_EVENTS as readonly string[]).includes(message.method)) { return; }
            const params = browserMessage(message.params);
            const sessionId = message.sessionId;
            if (sessionId !== undefined && (!validBrowserCdpSession(sessionId) || !entry.cdpSessions.has(sessionId))) { return; }
            if (!params || Buffer.byteLength(JSON.stringify(params), 'utf8') > 900_000) {
                this.event({ event: 'cdp-error', viewId: entry.nativeId, message: 'WebView2 CDP event exceeds the transport limit or is invalid.' });
                return;
            }
            if (message.method === 'Target.attachedToTarget') {
                if (!validBrowserCdpSession(params.sessionId) || browserMessage(params.targetInfo)?.type !== 'iframe') { return; }
                if (params.sessionId === sessionId || entry.cdpSessions.has(params.sessionId)) { return; }
                if (entry.cdpSessions.size >= 256 && !entry.cdpSessions.has(params.sessionId)) {
                    this.event({ event: 'cdp-error', viewId: entry.nativeId, message: 'WebView2 CDP session limit exceeded.' });
                    return;
                }
                entry.cdpSessions.set(params.sessionId, sessionId as string | undefined);
            } else if (message.method === 'Target.detachedFromTarget' && typeof params.sessionId === 'string') {
                const removed = new Set([params.sessionId]);
                for (const [id, parent] of entry.cdpSessions) { if (parent && removed.has(parent)) { removed.add(id); } }
                for (const id of removed) {
                    entry.cdpSessions.delete(id);
                    this.process.rejectSession(entry.nativeId, id);
                }
            }
            for (const listener of [...entry.cdpListeners]) { listener(message.method, params, sessionId as string | undefined); }
            return;
        }
        if (message.event === 'popup-closed') {
            if (entry.root) { this.remove(message.viewId, entry); }
            return;
        }
        if (message.event === 'control-focused') {
            entry.sink.controlFocused?.();
            return;
        }
        if (message.event === 'control-stop' && entry.root && typeof message.turnId === 'string') {
            entry.root.sink.controlStopRequested?.(entry.request.viewId, message.turnId);
            return;
        }
        if (message.event === 'state') {
            const state = browserMessage(message.state);
            if (!state || typeof state.url !== 'string' || typeof state.title !== 'string'
                || typeof state.canGoBack !== 'boolean' || typeof state.canGoForward !== 'boolean' || typeof state.loading !== 'boolean') {
                this.viewFailure(entry, new Error('WebView2 returned invalid navigation state.'));
                return;
            }
            if (!entry.root && state.loading && !entry.state.loading) entry.sink.navigationStarted?.();
            entry.state = {
                viewId: entry.request.viewId, engine: 'webview2',
                url: state.url, title: state.title, canGoBack: state.canGoBack, canGoForward: state.canGoForward, loading: state.loading,
                ...(typeof state.error === 'string' ? { error: state.error } : {}),
                ...(state.errorCode === 'runtime-crashed' || state.errorCode === 'navigation-failed' || state.errorCode === 'startup-failed' ? { errorCode: state.errorCode } : {}),
            };
            if (entry.state.errorCode === 'runtime-crashed') { this.clearCdp(entry); }
            if (!entry.state.error && validateBrowserUrl(entry.state.url).ok) { entry.request.url = entry.state.url; }
            if (entry.root) {
                if (entry.state.errorCode === 'runtime-crashed') { this.remove(entry.nativeId, entry); }
            } else {
                if (entry.state.errorCode === 'runtime-crashed') { this.removePopups(entry); }
                entry.sink.state(entry.state);
            }
        } else if (message.event === 'visited' || message.event === 'title-updated') {
            if (typeof message.url !== 'string' || typeof message.title !== 'string' || !validateBrowserUrl(message.url).ok) { return; }
            if (!entry.root && message.sourceViewId === entry.nativeId) {
                if (message.event === 'visited') entry.sink.documentCommitted?.(message.url, message.title);
                else entry.sink.documentTitleUpdated?.(message.url, message.title);
            }
            if (message.event === 'visited') { entry.sink.visited?.(message.url, message.title); }
            else { entry.sink.titleUpdated?.(message.url, message.title); }
        } else if (message.event === 'new-tab' && typeof message.url === 'string') {
            entry.sink.newTab(message.url);
        } else if (message.event === 'download' && typeof message.url === 'string') {
            const url = message.url;
            const report = (ok: boolean, error?: string) => {
                if (this.views.get(message.viewId as string) === entry) { entry.sink.download({ viewId: entry.request.viewId, url, ok, ...(error ? { error } : {}) }); }
            };
            if (!validateBrowserUrl(url).ok) { report(false, 'Only HTTP(S) downloads are supported.'); }
            else { void shell.openExternal(url).then(() => report(true), error => report(false, error instanceof Error ? error.message : String(error))); }
        } else if ((message.event === 'open-menu-requested' || message.event === 'focus-address-requested' || message.event === 'reopen-closed-requested') && entry.bounds && !entry.window.isDestroyed()) {
            entry.window.webContents.focus();
            void this.focusOwner(entry.request.ownerId).then(() => {
                if (this.views.get(message.viewId as string) === entry && entry.bounds) {
                    if (message.event === 'focus-address-requested') { entry.sink.focusAddressRequested?.(); }
                    else if (message.event === 'reopen-closed-requested') { entry.sink.reopenClosedRequested?.(); }
                    else { entry.sink.openMenuRequested(); }
                }
            }).catch(error => this.viewFailure(entry, error));
        } else if (message.event === 'close-requested' && entry.bounds) {
            entry.sink.closeRequested();
        } else if (message.event === 'focus-host' && !entry.window.isDestroyed()) {
            entry.window.webContents.focus();
            void this.focusOwner(entry.request.ownerId).catch(error => this.viewFailure(entry, error));
        }
        else if (message.event === 'fullscreen' && typeof message.fullscreen === 'boolean' && !entry.window.isDestroyed()) {
            if (message.fullscreen && !entry.fullscreen) { entry.wasFullscreen = entry.window.isFullScreen(); }
            entry.fullscreen = message.fullscreen;
            entry.window.setFullScreen(message.fullscreen || entry.wasFullscreen);
            entry.reposition();
        }
    }

    async importCookies(cookies: BrowserImportCookie[]): Promise<void> {
        await this.process.request('import-profile-cookies', { cookies });
    }

    async clearData(): Promise<void> {
        if (process.platform !== 'win32' || process.arch !== 'x64') { throw new BrowserHostError('unsupported-platform', 'WebView2 requires Windows x64.'); }
        await this.process.request('clear');
    }

    async dispose(): Promise<void> {
        try { await this.process.dispose(); }
        finally {
            for (const entry of [...this.views.values()]) { this.remove(entry.nativeId, entry); }
        }
    }
}
