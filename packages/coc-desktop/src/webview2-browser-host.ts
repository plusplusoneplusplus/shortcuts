import { BrowserWindow, shell, webContents } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BrowserHostError, type BrowserEngineHost, type BrowserEventSink, type BrowserHostedView, type BrowserViewRequest } from './browser-host-contract';
import { validateBrowserUrl, type BrowserAvailability, type BrowserViewState } from './browser-view-policy';
import { browserMessage, WebView2Process } from './webview2-process';
import type { HtmlPageBounds } from './html-page-policy';

const execFileAsync = promisify(execFile);

interface NativeEntry {
    nativeId: string;
    request: BrowserViewRequest;
    sink: BrowserEventSink;
    state: BrowserViewState;
    bounds: HtmlPageBounds | null;
    parent: string;
    window: BrowserWindow;
    fullscreen: boolean;
    wasFullscreen: boolean;
    reposition(): void;
}

export class WebView2BrowserHost implements BrowserEngineHost {
    readonly engine = 'webview2' as const;
    private readonly views = new Map<string, NativeEntry>();
    private sequence = 0;
    private readonly process: WebView2Process;

    constructor(profilePath: string) {
        this.process = new WebView2Process(() => this.binary(), profilePath, message => this.event(message), error => {
            for (const entry of this.views.values()) {
                entry.state = { ...entry.state, loading: false, errorCode: error.reason, error: error.message };
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

    private bounds(entry: NativeEntry): HtmlPageBounds | null {
        if (!entry.bounds || !entry.fullscreen || entry.window.isDestroyed()) { return entry.bounds; }
        const { width, height } = entry.window.getContentBounds();
        return { x: 0, y: 0, width, height };
    }

    async create(request: BrowserViewRequest, sink: BrowserEventSink): Promise<BrowserHostedView> {
        const owner = webContents.fromId(request.ownerId);
        const window = owner ? BrowserWindow.fromWebContents(owner) : null;
        if (!window || window.isDestroyed() || window.webContents !== owner) { throw new BrowserHostError('no-window', 'Browser window is closed.'); }
        const handle = window.getNativeWindowHandle();
        const parent = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
        const id = `${request.ownerId}:${request.viewId}:${++this.sequence}`;
        const entry: NativeEntry = {
            nativeId: id, request, sink, parent, window, bounds: null, fullscreen: false, wasFullscreen: window.isFullScreen(),
            state: { viewId: request.viewId, engine: 'webview2', url: request.url, title: '', canGoBack: false, canGoForward: false, loading: true },
            reposition: () => {
                if (entry.bounds && !window.isDestroyed()) { void this.process.request('bounds', { viewId: id, bounds: this.bounds(entry) }).catch(error => this.viewFailure(entry, error)); }
            },
        };
        this.views.set(id, entry);
        window.on('move', entry.reposition);
        window.on('resize', entry.reposition);
        try { await this.process.request('open', { viewId: id, url: request.url, parent }); }
        catch (error) {
            this.remove(id, entry);
            throw error;
        }
        return {
            snapshot: () => ({ ...entry.state }),
            navigate: async url => {
                entry.request.url = url;
                await this.process.request('navigate', { viewId: id, url });
            },
            nav: async action => {
                if (action === 'reload' && entry.state.errorCode === 'runtime-crashed') {
                    if (this.process.running) { await this.process.request('close', { viewId: id }); }
                    entry.state = { ...entry.state, error: undefined, errorCode: undefined, loading: true };
                    await this.process.request('open', { viewId: id, url: entry.request.url, parent });
                    await this.process.request('bounds', { viewId: id, bounds: this.bounds(entry) });
                } else { await this.process.request('nav', { viewId: id, action }); }
            },
            setBounds: async bounds => {
                entry.bounds = bounds;
                await this.process.request('bounds', { viewId: id, bounds: this.bounds(entry) });
            },
            focus: () => this.process.request('focus', { viewId: id }),
            close: async () => {
                this.remove(id, entry);
                if (this.process.running) { await this.process.request('close', { viewId: id }); }
            },
        };
    }

    private remove(id: string, entry: NativeEntry): void {
        if (this.views.get(id) !== entry) { return; }
        this.views.delete(id);
        entry.window.removeListener('move', entry.reposition);
        entry.window.removeListener('resize', entry.reposition);
        if (entry.fullscreen && !entry.wasFullscreen && !entry.window.isDestroyed()) { entry.window.setFullScreen(false); }
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
        entry.sink.state(entry.state);
    }

    private event(message: Record<string, unknown>): void {
        if (typeof message.viewId !== 'string') { return; }
        const entry = this.views.get(message.viewId);
        if (!entry) { return; }
        if (message.event === 'state') {
            const state = browserMessage(message.state);
            if (!state || typeof state.url !== 'string' || typeof state.title !== 'string'
                || typeof state.canGoBack !== 'boolean' || typeof state.canGoForward !== 'boolean' || typeof state.loading !== 'boolean') {
                this.viewFailure(entry, new Error('WebView2 returned invalid navigation state.'));
                return;
            }
            entry.state = {
                viewId: entry.request.viewId, engine: 'webview2',
                url: state.url, title: state.title, canGoBack: state.canGoBack, canGoForward: state.canGoForward, loading: state.loading,
                ...(typeof state.error === 'string' ? { error: state.error } : {}),
                ...(state.errorCode === 'runtime-crashed' || state.errorCode === 'navigation-failed' || state.errorCode === 'startup-failed' ? { errorCode: state.errorCode } : {}),
            };
            if (!entry.state.error && validateBrowserUrl(entry.state.url).ok) { entry.request.url = entry.state.url; }
            entry.sink.state(entry.state);
        } else if (message.event === 'new-tab' && typeof message.url === 'string') {
            entry.sink.newTab(message.url);
        } else if (message.event === 'download' && typeof message.url === 'string') {
            const url = message.url;
            const report = (ok: boolean, error?: string) => {
                if (this.views.get(message.viewId as string) === entry) { entry.sink.download({ viewId: entry.request.viewId, url, ok, ...(error ? { error } : {}) }); }
            };
            if (!validateBrowserUrl(url).ok) { report(false, 'Only HTTP(S) downloads are supported.'); }
            else { void shell.openExternal(url).then(() => report(true), error => report(false, error instanceof Error ? error.message : String(error))); }
        } else if (message.event === 'open-menu-requested' && entry.bounds && !entry.window.isDestroyed()) {
            entry.window.webContents.focus();
            void this.focusOwner(entry.request.ownerId).then(() => {
                if (this.views.get(message.viewId as string) === entry && entry.bounds) { entry.sink.openMenuRequested(); }
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

    async clearData(): Promise<void> {
        if (process.platform !== 'win32' || process.arch !== 'x64') { throw new BrowserHostError('unsupported-platform', 'WebView2 requires Windows x64.'); }
        await this.process.request('clear');
    }

    async dispose(): Promise<void> {
        await this.process.dispose();
    }
}
