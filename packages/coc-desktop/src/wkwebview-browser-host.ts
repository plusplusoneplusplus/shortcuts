import { BrowserWindow, session, webContents } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { BrowserHostError, type BrowserEngineHost, type BrowserEventSink, type BrowserHostedView, type BrowserSiteFacts, type BrowserViewRequest } from './browser-host-contract';
import type { BrowserImportCookie } from './browser-cookie-import';
import { downloadSource, type BrowserDownloadStore } from './browser-downloads';
import { loadBrowserFavicon } from './browser-favicon';
import { validateBrowserUrl, type BrowserAvailability, type BrowserSiteCertificate, type BrowserViewState } from './browser-view-policy';
import type { HtmlPageBounds } from './html-page-policy';
import { captureWebView2Annotation } from './webview2-annotation-capture';
import { WebView2Downloads, supportedWebView2Download, validWebView2DownloadId } from './webview2-downloads';
import { browserMessage } from './webview2-process';
import { WkWebViewBrowserControl } from './wkwebview-browser-control';
import { WkWebViewProcess } from './wkwebview-process';

const execFileAsync = promisify(execFile);

/** Page-declared icons plus the site's default `/favicon.ico`, read in the control world after a load finishes. */
export const WKWEBVIEW_FAVICON_LINKS = `(() => {
    const links = [...document.querySelectorAll('link[rel~="icon" i][href]')].map(link => link.href);
    return /^https?:$/.test(location.protocol) ? [...links, new URL('/favicon.ico', location.href).href] : links;
})()`;
/** In-memory Electron session for icon fetches: no page cookies, but the system proxy like other app traffic. */
const WKWEBVIEW_FAVICON_PARTITION = 'coc-wkwebview-favicons';

/** The helper's server-certificate summary (display names, Unix-second validity), or undefined if malformed. */
export function wkWebViewCertificate(value: unknown): BrowserSiteCertificate | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const { subject, issuer, validStart, validExpiry } = value as Record<string, unknown>;
    if (typeof subject !== 'string' || typeof issuer !== 'string') return undefined;
    if (!Number.isFinite(validStart) || !Number.isFinite(validExpiry)) return undefined;
    return { subject, issuer, validStart: validStart as number, validExpiry: validExpiry as number };
}

interface NativeEntry {
    /** Set on page-opened popup windows; they follow their root's lifetime. */
    root?: NativeEntry;
    nativeId: string;
    request: BrowserViewRequest;
    sink: BrowserEventSink;
    state: BrowserViewState;
    bounds: HtmlPageBounds | null;
    background: boolean;
    parentWindow: number;
    window: BrowserWindow;
    pageZoom: number;
    tabShortcuts?: boolean;
    /** This view's own control turn gate; a popup is also gated while its root is. */
    navigationGate: boolean;
    /** Loads the helper holds until main answers `navigation-decision`. */
    pendingGates: Set<number>;
    navigationError?: Error;
    /** Replaced when a crashed view is reopened; the old one stays failed. */
    control: WkWebViewBrowserControl;
    /** Bumped on every navigation main or the page starts and every committed document. */
    documentGeneration: number;
    favicon?: string;
    faviconRequest?: AbortController;
    /** When the last load stopped (performance.now()). */
    loadStoppedAt?: number;
    /** Pushes placement and parent visibility after window move/resize/minimize/hide/fullscreen. */
    reposition(): void;
    parentChanged(): void;
}

/**
 * WebKit runs navigations a page schedules while loading (an inline `form.submit()`,
 * `location` assignments) only after it reports the load finished, so control readiness
 * waits this long after a load stops before treating the page as settled.
 */
export const WKWEBVIEW_LOAD_SETTLE_MS = 150;

const WINDOW_PLACEMENT_EVENTS = ['move', 'resize', 'enter-full-screen', 'leave-full-screen'] as const;
const WINDOW_VISIBILITY_EVENTS = ['minimize', 'restore', 'hide', 'show'] as const;

/**
 * AppKit window number of an Electron window: macOS media source ids are `window:<CGWindowID>:0`,
 * and a CGWindowID is the NSWindow's windowNumber.
 */
export function wkWebViewParentWindow(window: Pick<BrowserWindow, 'getMediaSourceId'>): number {
    const number = Number(/^window:(\d+):/.exec(window.getMediaSourceId())?.[1]);
    if (!Number.isSafeInteger(number) || number <= 0) throw new BrowserHostError('no-window', 'Browser window has no native window.');
    return number;
}

/**
 * macOS WKWebView engine. Each tab is a borderless panel owned by the `coc-wkwebview` helper,
 * placed over the owner window at screen coordinates main pushes.
 */
export class WkWebViewBrowserHost implements BrowserEngineHost {
    readonly engine = 'wkwebview' as const;
    private readonly views = new Map<string, NativeEntry>();
    private sequence = 0;
    private readonly process: WkWebViewProcess;
    /** WKDownload transfers share WebView2's main-owned approval and progress rules. */
    private readonly downloads?: WebView2Downloads;

    constructor(profilePath: string, store?: BrowserDownloadStore,
        private readonly chooseDownload?: (ownerId: number, filename: string) => Promise<string | undefined>,
        private readonly downloadOwnerCurrent: (ownerId: number) => boolean = () => false) {
        this.process = new WkWebViewProcess(() => this.binary(), profilePath, message => this.event(message), error => {
            this.downloads?.failed();
            for (const entry of [...this.views.values()]) {
                if (entry.root) { this.remove(entry.nativeId, entry); continue; }
                entry.state = { ...entry.state, loading: false, errorCode: error.reason, error: error.message };
                entry.control.stateChanged(entry.state);
                entry.sink.state(entry.state);
            }
        });
        if (store && chooseDownload) this.downloads = new WebView2Downloads(store, (op, payload) => this.process.request(op, payload), 'wkwebview');
    }

    private binary(): string {
        // Only macOS desktop hosts load the helper.
        return (require('@plusplusoneplusplus/coc-native') as typeof import('@plusplusoneplusplus/coc-native')).loadWkWebViewBinary();
    }

    private checked?: Promise<BrowserAvailability>;

    /** The OS version and the shipped helper don't change while CoC runs, so the check runs once. */
    availability(): Promise<BrowserAvailability> {
        this.checked ??= this.check();
        return this.checked;
    }

    private async check(): Promise<BrowserAvailability> {
        if (process.platform !== 'darwin') {
            return { engine: this.engine, available: false, reason: 'unsupported-platform', message: 'WebKit (WKWebView) is available only on macOS. Use Electron on this platform.' };
        }
        try {
            const { stdout } = await execFileAsync(this.binary(), ['--check'], { timeout: 10_000 });
            const result = browserMessage(JSON.parse(stdout));
            if (result?.available === true) { return { engine: this.engine, available: true }; }
            if (result?.reason === 'unsupported-platform') {
                return { engine: this.engine, available: false, reason: 'unsupported-platform', message: 'WebKit (WKWebView) requires macOS 14 or later. Use Electron.' };
            }
            return { engine: this.engine, available: false, reason: 'native-unavailable', message: 'WebKit (WKWebView) capability check failed. Reinstall CoC.' };
        } catch (error) {
            return { engine: this.engine, available: false, reason: 'native-unavailable', message: error instanceof Error ? error.message : String(error) };
        }
    }

    /** Screen rectangle in Electron DIPs (top-left origin); undefined leaves the panel unplaced. */
    private bounds(entry: NativeEntry): HtmlPageBounds | undefined {
        if (!entry.bounds || entry.window.isDestroyed()) { return undefined; }
        const content = entry.window.getContentBounds();
        if (entry.window.isFullScreen()) return content;
        return { x: content.x + entry.bounds.x, y: content.y + entry.bounds.y, width: entry.bounds.width, height: entry.bounds.height };
    }

    private parentVisible(entry: NativeEntry): boolean {
        return !entry.window.isDestroyed() && entry.window.isVisible() && !entry.window.isMinimized();
    }

    private openPayload(entry: NativeEntry): Record<string, unknown> {
        const bounds = this.bounds(entry);
        return {
            viewId: entry.nativeId, url: entry.request.url, parentWindow: entry.parentWindow, visible: this.parentVisible(entry),
            pageZoomPercent: entry.pageZoom, ...(bounds ? { bounds } : {}), ...(entry.tabShortcuts ? { tabShortcuts: true } : {}),
            ...(this.gated(entry) ? { navigationGate: true } : {}),
        };
    }

    async create(request: BrowserViewRequest, sink: BrowserEventSink): Promise<BrowserHostedView> {
        const owner = webContents.fromId(request.ownerId);
        const window = owner ? BrowserWindow.fromWebContents(owner) : null;
        if (!window || window.isDestroyed() || window.webContents !== owner) { throw new BrowserHostError('no-window', 'Browser window is closed.'); }
        const parentWindow = wkWebViewParentWindow(window);
        const id = `${request.ownerId}:${request.viewId}:${++this.sequence}`;
        const failed = (error: unknown) => this.viewFailure(entry, error);
        const entry: NativeEntry = {
            nativeId: id, request, sink, window, parentWindow, bounds: null, background: false, pageZoom: request.pageZoomPercent ?? 100,
            navigationGate: request.navigationGate === true, pendingGates: new Set(),
            state: { viewId: request.viewId, engine: 'wkwebview', url: request.url, title: '', canGoBack: false, canGoForward: false, loading: true },
            control: this.control(id), documentGeneration: 0,
            reposition: () => {
                if (entry.bounds && this.views.get(id) === entry) { void this.process.request('bounds', { viewId: id, bounds: this.bounds(entry) }).catch(failed); }
            },
            parentChanged: () => {
                if (this.views.get(id) === entry) { void this.process.request('parent', { viewId: id, visible: this.parentVisible(entry) }).catch(failed); }
            },
        };
        this.views.set(id, entry);
        for (const event of WINDOW_PLACEMENT_EVENTS) window.on(event as 'move', entry.reposition);
        for (const event of WINDOW_VISIBILITY_EVENTS) window.on(event as 'show', entry.parentChanged);
        try { await this.process.request('open', this.openPayload(entry)); }
        catch (error) {
            this.remove(id, entry);
            throw error;
        }
        return this.hosted(entry);
    }

    private control(nativeId: string): WkWebViewBrowserControl {
        return new WkWebViewBrowserControl((op, payload) => this.process.request(op as 'evaluate', { ...payload, viewId: nativeId }));
    }

    private hosted(entry: NativeEntry): BrowserHostedView {
        const id = entry.nativeId;
        const live = () => {
            if (this.views.get(id) !== entry || entry.window.isDestroyed()) throw new BrowserHostError('not-found', 'Browser tab is closed.');
        };
        /** Main's own navigation replaces loads the helper still holds; it cancels them natively. */
        const retireGates = () => {
            entry.pendingGates.clear();
            entry.navigationError = undefined;
        };
        return {
            get control() { return entry.control; },
            waitForControlReady: async signal => {
                for (;;) {
                    signal.throwIfAborted();
                    live();
                    if (entry.navigationError) throw entry.navigationError;
                    if (entry.state.error) throw new BrowserHostError(entry.state.errorCode ?? 'navigation-failed', entry.state.error);
                    if (!entry.pendingGates.size && !entry.state.loading
                        && performance.now() - (entry.loadStoppedAt ?? -Infinity) >= WKWEBVIEW_LOAD_SETTLE_MS) return;
                    await delay(25, undefined, { signal });
                }
            },
            // Popups show a native "AI controlling" bar with Stop; tabs use main's own chrome.
            setControlActivity: turnId => entry.root && this.views.get(id) === entry
                ? this.process.request('control-activity', { viewId: entry.nativeId, turnId })
                : undefined,
            setNavigationGate: async enabled => {
                if (this.views.get(id) !== entry || entry.navigationGate === enabled) { return; }
                entry.navigationGate = enabled;
                const views = entry.root ? [entry] : [entry, ...[...this.views.values()].filter(view => view.root === entry)];
                await Promise.all(views.map(view => this.process.request('navigation-gate', { viewId: view.nativeId, navigationGate: this.gated(view) })));
            },
            // Every view shares the profile's data store, so a tab import is a profile import.
            importCookies: cookies => this.importCookies(cookies),
            // WebKit fails invalid certificates without offering to proceed (no challenge handler).
            siteFacts: async url => {
                const facts: BrowserSiteFacts = { rejectsInvalidCertificates: true, certificateError: false };
                const [site, cookies] = await Promise.allSettled([
                    this.process.request('site-info', url ? { viewId: id, url } : { viewId: id }),
                    // The helper replies with a count only; names and values stay in WebKit.
                    url ? this.process.request('cookie-count', { url }) : undefined,
                ]);
                // Failures are reported as unavailable facts; helper errors are never surfaced.
                if (site.status === 'fulfilled') {
                    const info = site.value as { certificateError?: unknown; certificate?: unknown } | undefined;
                    facts.certificateError = info?.certificateError === true;
                    const certificate = wkWebViewCertificate(info?.certificate);
                    if (url && certificate) facts.certificate = certificate;
                }
                if (cookies.status === 'fulfilled') {
                    const count = (cookies.value as { count?: unknown } | undefined)?.count;
                    if (typeof count === 'number') facts.cookieCount = count;
                }
                return facts;
            },
            ...(!entry.root ? { captureAnnotation: async (rect, viewport) => {
                const { documentGeneration, pageZoom, control } = entry;
                const url = entry.state.url;
                // A capture finishing after close, crash, navigation, hide or a zoom change is rejected.
                const check = () => {
                    live();
                    if (entry.state.loading || entry.state.errorCode || entry.state.error || !entry.bounds || !this.parentVisible(entry)
                        || entry.documentGeneration !== documentGeneration || entry.pageZoom !== pageZoom || entry.control !== control
                        || entry.state.url !== url) throw new BrowserHostError('invalid', 'Annotation document became unavailable.');
                };
                check();
                // The preview is in device pixels; before macOS 26 the page's devicePixelRatio leaves page zoom out.
                const ratio = await this.process.request('pixel-ratio', { viewId: id }) as { value?: unknown } | undefined;
                check();
                if (typeof ratio?.value !== 'number') throw new BrowserHostError('invalid', 'Annotation document became unavailable.');
                const image = await captureWebView2Annotation(async () => {
                    const preview = await this.process.request('capture-annotation', { viewId: id });
                    check();
                    return preview;
                }, rect, { ...viewport, devicePixelRatio: ratio.value });
                check();
                return image;
            } } satisfies Pick<BrowserHostedView, 'captureAnnotation'> : {}),
            snapshot: () => ({ ...entry.state }),
            navigate: async url => {
                live();
                retireGates();
                entry.documentGeneration++;
                this.downloads?.revokeView(id);
                entry.request.url = url;
                await this.process.request('navigate', { viewId: id, url });
            },
            nav: async action => {
                live();
                retireGates();
                if (action !== 'stop') { this.downloads?.revokeView(id); entry.documentGeneration++; }
                if (action === 'reload' && entry.state.errorCode === 'runtime-crashed' && !entry.root) {
                    // A crashed or lost helper view is reopened in place with its last placement.
                    if (this.process.running) { await this.process.request('close', { viewId: id }); }
                    entry.state = { ...entry.state, error: undefined, errorCode: undefined, loading: true };
                    entry.control.close('detached');
                    entry.control = this.control(id);
                    await this.process.request('open', this.openPayload(entry));
                    if (entry.background) await this.process.request('background', { viewId: id, enabled: true });
                } else { await this.process.request('nav', { viewId: id, action }); }
            },
            setPageZoom: async percent => {
                entry.documentGeneration++;
                await this.process.request('page-zoom', { viewId: id, pageZoomPercent: percent });
                entry.pageZoom = percent;
            },
            setTabShortcuts: async enabled => {
                if (entry.root || this.views.get(id) !== entry || !!entry.tabShortcuts === enabled) { return; }
                entry.tabShortcuts = enabled;
                await this.process.request('tab-shortcuts', { viewId: id, tabShortcuts: enabled });
            },
            setBounds: async bounds => {
                if (entry.root) { return; }
                entry.bounds = bounds;
                const placed = this.bounds(entry);
                await this.process.request('bounds', { viewId: id, ...(placed ? { bounds: placed } : {}) });
            },
            setBackgroundControl: async enabled => {
                if (entry.root || entry.background === enabled || this.views.get(id) !== entry) { return; }
                entry.background = enabled;
                await this.process.request('background', { viewId: id, enabled });
            },
            focus: async () => {
                live();
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

    private gated(entry: NativeEntry): boolean {
        return entry.navigationGate || !!entry.root?.navigationGate;
    }

    /**
     * The helper holds the load in WebKit's policy check; the sink decides (an agent turn waits
     * for the user) and main releases or cancels it. Closing the view cancels it natively.
     */
    private navigationGate(entry: NativeEntry, url: string, gateId: number): void {
        entry.pendingGates.add(gateId);
        entry.navigationError = undefined;
        const decision = entry.root
            ? entry.root.sink.navigationGate?.(url, entry.request.viewId)
            : entry.sink.navigationGate?.(url);
        void Promise.resolve(decision ?? true).then(allow => {
            if (this.views.get(entry.nativeId) !== entry || !entry.pendingGates.has(gateId) || !this.process.running) { return; }
            if (!allow) entry.navigationError = new BrowserHostError('navigation-failed', 'Browser navigation was denied.');
            return this.process.request('navigation-decision', { viewId: entry.nativeId, gateId, allow });
        }).catch(error => {
            if (entry.pendingGates.has(gateId)) entry.navigationError = error instanceof Error ? error : new Error(String(error));
            console.error('[coc-desktop] WKWebView navigation decision failed:', error);
        }).finally(() => entry.pendingGates.delete(gateId));
    }

    private remove(id: string, entry: NativeEntry): void {
        if (this.views.get(id) !== entry) { return; }
        this.views.delete(id);
        this.process.rejectView(id);
        this.downloads?.revokeView(id);
        entry.faviconRequest?.abort();
        entry.control.close('detached');
        if (entry.root) {
            entry.root.sink.controlPopoutClosed?.(entry.request.viewId);
            return;
        }
        this.removePopups(entry);
        for (const event of WINDOW_PLACEMENT_EVENTS) entry.window.removeListener(event as 'move', entry.reposition);
        for (const event of WINDOW_VISIBILITY_EVENTS) entry.window.removeListener(event as 'show', entry.parentChanged);
    }

    private removePopups(root: NativeEntry): void {
        for (const popup of [...this.views.values()]) {
            if (popup.root === root) { this.remove(popup.nativeId, popup); }
        }
    }

    /** Keyboard returns to the owner window; the helper panel resigns key when another window becomes key. */
    async focusOwner(ownerId: number): Promise<void> {
        const entry = [...this.views.values()].find(view => !view.root && view.request.ownerId === ownerId && view.bounds);
        if (entry && !entry.window.isDestroyed()) {
            entry.window.focus();
            entry.window.webContents.focus();
        }
    }

    private clearFavicon(entry: NativeEntry): void {
        entry.faviconRequest?.abort();
        entry.faviconRequest = undefined;
        entry.favicon = undefined;
        if (entry.state.favicon) {
            entry.state = { ...entry.state, favicon: undefined };
            if (!entry.root) entry.sink.state(entry.state);
        }
    }

    /** Tabs only (popups have no tab header). A later load, document or close drops the result. */
    private loadFavicon(entry: NativeEntry): void {
        entry.faviconRequest?.abort();
        const request = entry.faviconRequest = new AbortController();
        const { documentGeneration } = entry;
        const current = () => this.views.get(entry.nativeId) === entry && entry.faviconRequest === request
            && !request.signal.aborted && entry.documentGeneration === documentGeneration;
        void (async () => {
            const result = await this.process.request('evaluate', { viewId: entry.nativeId, expression: WKWEBVIEW_FAVICON_LINKS, world: 'coc-control' }) as { value?: unknown } | undefined;
            const urls = Array.isArray(result?.value) ? result.value : [];
            if (!current()) return;
            const favicons = session.fromPartition(WKWEBVIEW_FAVICON_PARTITION);
            const favicon = await loadBrowserFavicon((url, init) => favicons.fetch(url, init), urls, request.signal);
            if (!current()) return;
            entry.faviconRequest = undefined;
            if (favicon === entry.favicon) return;
            entry.favicon = favicon;
            entry.state = { ...entry.state, favicon };
            entry.sink.state(entry.state);
        })().catch(() => {
            // Missing icons keep the tab's globe; evaluation failures are not view failures.
            if (entry.faviconRequest === request) entry.faviconRequest = undefined;
        });
    }

    private viewFailure(entry: NativeEntry, error: unknown): void {
        if (this.views.get(entry.nativeId) !== entry) { return; }
        entry.state = { ...entry.state, loading: false, errorCode: 'runtime-crashed', error: error instanceof Error ? error.message : String(error) };
        entry.control.close('crashed');
        if (entry.root) { this.remove(entry.nativeId, entry); }
        else {
            this.removePopups(entry);
            entry.sink.state(entry.state);
        }
    }

    private event(message: Record<string, unknown>): void {
        if (typeof message.viewId !== 'string') { return; }
        // Approved transfers outlive their tab; progress is routed by the helper's download id.
        if (message.event === 'download-progress') { this.downloads?.progress(message); return; }
        if (message.event === 'popup-opened') {
            const root = typeof message.rootId === 'string' ? this.views.get(message.rootId) : undefined;
            if (!root || root.root || root.state.errorCode === 'runtime-crashed' || root.window.isDestroyed() || this.views.has(message.viewId)
                || !message.viewId.startsWith(`${root.nativeId}:popup:`)
                || !/^[1-9]\d*$/.test(message.viewId.slice(root.nativeId.length + 7))
                || typeof message.url !== 'string' || (message.url !== 'about:blank' && !validateBrowserUrl(message.url).ok)) { return; }
            const viewId = `browser-popout-${randomUUID()}`;
            const popup: NativeEntry = {
                ...root, root, nativeId: message.viewId, tabShortcuts: false,
                request: { ...root.request, viewId, url: message.url },
                state: { ...root.state, viewId, url: message.url, title: '', loading: true, canGoBack: false, canGoForward: false, error: undefined, errorCode: undefined, favicon: undefined },
                bounds: null, background: false, control: this.control(message.viewId), favicon: undefined, faviconRequest: undefined,
                navigationGate: false, pendingGates: new Set(), navigationError: undefined,
            };
            this.views.set(message.viewId, popup);
            root.sink.controlPopoutOpened?.(viewId, this.hosted(popup));
            return;
        }
        const entry = this.views.get(message.viewId);
        if (!entry) {
            if (message.event === 'download' && validWebView2DownloadId(message.downloadId)) {
                void this.process.request('download-decide', { viewId: message.viewId, downloadId: message.downloadId, action: 'cancel' })
                    .catch(() => console.error('[coc-desktop] Unowned download cancellation failed.'));
            }
            return;
        }
        if (message.event === 'download' && typeof message.url === 'string') {
            this.download(entry, message.url, message);
            return;
        }
        if (message.event === 'navigation-gate') {
            const gateId = message.gateId;
            if (typeof gateId !== 'number' || !Number.isSafeInteger(gateId) || gateId <= 0) { return; }
            if (typeof message.url === 'string' && validateBrowserUrl(message.url).ok) { this.navigationGate(entry, message.url, gateId); }
            else {
                void this.process.request('navigation-decision', { viewId: entry.nativeId, gateId, allow: false })
                    .catch(error => console.error('[coc-desktop] WKWebView navigation decision failed:', error));
            }
            return;
        }
        if (message.event === 'popup-closed') {
            if (entry.root) { this.remove(message.viewId, entry); }
        } else if (message.event === 'control-stop') {
            if (entry.root && typeof message.turnId === 'string') { entry.root.sink.controlStopRequested?.(entry.request.viewId, message.turnId); }
        } else if (message.event === 'control-focused') {
            entry.sink.controlFocused?.();
        } else if (message.event === 'frame-navigated' || message.event === 'frame-detached') {
            // A new document never inherits the previous site's icon.
            if (message.event === 'frame-navigated' && message.frameId === 'main') this.clearFavicon(entry);
            entry.control.frameEvent(message.event, message);
        } else if (message.event === 'state') {
            const state = browserMessage(message.state);
            if (!state || typeof state.url !== 'string' || typeof state.title !== 'string'
                || typeof state.canGoBack !== 'boolean' || typeof state.canGoForward !== 'boolean' || typeof state.loading !== 'boolean') {
                this.viewFailure(entry, new Error('WKWebView returned invalid navigation state.'));
                return;
            }
            const finished = entry.state.loading && !state.loading;
            if (finished) entry.loadStoppedAt = performance.now();
            if (!entry.root && state.loading && !entry.state.loading) entry.sink.navigationStarted?.();
            if (state.loading || state.url !== entry.state.url) entry.documentGeneration++;
            entry.state = {
                viewId: entry.request.viewId, engine: 'wkwebview',
                url: state.url, title: state.title, canGoBack: state.canGoBack, canGoForward: state.canGoForward, loading: state.loading,
                ...(typeof state.error === 'string' ? { error: state.error } : {}),
                ...(state.errorCode === 'runtime-crashed' || state.errorCode === 'navigation-failed' ? { errorCode: state.errorCode } : {}),
                ...(entry.favicon && typeof state.error !== 'string' ? { favicon: entry.favicon } : {}),
            };
            if (!entry.root && finished && !entry.state.error) this.loadFavicon(entry);
            if (!entry.state.error && validateBrowserUrl(entry.state.url).ok) { entry.request.url = entry.state.url; }
            entry.control.stateChanged(entry.state);
            if (entry.root) {
                if (entry.state.errorCode === 'runtime-crashed') { this.remove(entry.nativeId, entry); }
            } else {
                if (entry.state.errorCode === 'runtime-crashed') { this.removePopups(entry); }
                entry.sink.state(entry.state);
            }
        } else if (message.event === 'visited' || message.event === 'title-updated') {
            // History is recorded by main only, from the helper's committed-navigation events.
            if (typeof message.url !== 'string' || typeof message.title !== 'string' || !validateBrowserUrl(message.url).ok) { return; }
            if (!entry.root && message.sourceViewId === entry.nativeId) {
                if (message.event === 'visited') entry.sink.documentCommitted?.(message.url, message.title);
                else entry.sink.documentTitleUpdated?.(message.url, message.title);
            }
            if (message.event === 'visited') { entry.documentGeneration++; entry.sink.visited?.(message.url, message.title); }
            else { entry.sink.titleUpdated?.(message.url, message.title); }
        } else if (message.event === 'new-tab' && typeof message.url === 'string') {
            (entry.root ?? entry).sink.newTab(message.url);
        } else if ((message.event === 'open-menu-requested' || message.event === 'focus-address-requested' || message.event === 'reopen-closed-requested')
            && !entry.root && entry.bounds && !entry.window.isDestroyed()) {
            void this.focusOwner(entry.request.ownerId).then(() => {
                if (this.views.get(entry.nativeId) !== entry || !entry.bounds) return;
                if (message.event === 'focus-address-requested') { entry.sink.focusAddressRequested?.(); }
                else if (message.event === 'reopen-closed-requested') { entry.sink.reopenClosedRequested?.(); }
                else { entry.sink.openMenuRequested(); }
            }).catch(error => this.viewFailure(entry, error));
        } else if (message.event === 'tab-shortcut-requested' && !entry.root && entry.tabShortcuts && entry.bounds && !entry.window.isDestroyed()
            && Number.isInteger(message.digit) && (message.digit as number) >= 1 && (message.digit as number) <= 9) {
            // Keyboard returns to the SPA first: the switch hides this view, and key-up must reach the document.
            const digit = message.digit as number;
            void this.focusOwner(entry.request.ownerId).then(() => {
                if (this.views.get(entry.nativeId) === entry && entry.bounds) { entry.sink.tabShortcut?.({ digit }); }
            }).catch(error => this.viewFailure(entry, error));
        } else if (message.event === 'tab-modifier' && !entry.root && entry.tabShortcuts && typeof message.held === 'boolean') {
            entry.sink.tabShortcut?.({ held: message.held });
        } else if (message.event === 'close-requested' && !entry.root && entry.bounds) {
            entry.sink.closeRequested();
        }
    }

    /** The helper holds WebKit's destination callback until main's Save dialog answers. */
    private download(entry: NativeEntry, url: string, message: Record<string, unknown>): void {
        const report = (ok: boolean, error?: string) => {
            if (this.views.get(entry.nativeId) === entry) { entry.sink.download({ viewId: entry.request.viewId, url: downloadSource(url), ok, ...(error ? { error } : {}) }); }
        };
        const id = message.downloadId;
        if (!validWebView2DownloadId(id)) {
            report(false, message.reason === 'limit' ? 'Too many active downloads or pending approvals.'
                : message.reason === 'unsupported' ? 'This download URL is unsupported or exceeds the native limit.'
                : supportedWebView2Download(url) ? 'Native download management is unavailable. Rebuild or update the desktop app.'
                : 'Only HTTP(S) and browser-native blob downloads are supported.');
            return;
        }
        // The helper revokes an unanswered approval when its view starts a new document.
        const lease = entry.sink.downloadApproval?.(entry.root ? entry.request.viewId : undefined);
        const current = () => !!lease?.current() && this.views.get(entry.nativeId) === entry
            && entry.state.errorCode !== 'runtime-crashed' && !entry.window.isDestroyed() && this.downloadOwnerCurrent(entry.request.ownerId);
        if (!this.downloads || !lease || !current() || typeof message.filename !== 'string') {
            lease?.dispose();
            report(false, 'Download approval is unavailable for this source.');
            void this.process.request('download-decide', { viewId: entry.nativeId, downloadId: id, action: 'cancel' })
                .catch(() => console.error('[coc-desktop] Download approval rejection failed.'));
            return;
        }
        let failureReported = false;
        this.downloads.start(entry.nativeId, id, url, message.filename, {
            ownerId: entry.request.ownerId, current, dispose: () => lease.dispose(),
            chooseDestination: filename => this.chooseDownload!(entry.request.ownerId, filename),
            failure: () => {
                if (failureReported) return;
                failureReported = true;
                report(false, 'Download failed or is unavailable. Check Downloads before trying again.');
            },
        });
    }

    async importCookies(cookies: BrowserImportCookie[]): Promise<void> {
        await this.process.request('import-profile-cookies', { cookies });
    }

    async clearData(): Promise<void> {
        if (process.platform !== 'darwin') { throw new BrowserHostError('unsupported-platform', 'WKWebView requires macOS.'); }
        await this.downloads?.cancelAll();
        await this.process.request('clear');
    }

    async dispose(): Promise<void> {
        try {
            try { await this.downloads?.dispose(); }
            finally { await this.process.dispose(); }
        }
        finally {
            for (const entry of [...this.views.values()]) { this.remove(entry.nativeId, entry); }
        }
    }
}
