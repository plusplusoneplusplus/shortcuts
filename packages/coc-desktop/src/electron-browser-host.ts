/**
 * CoC Desktop — browser tab host (main-process side).
 *
 * The SPA's right panel can show general web pages in browser tabs. Each tab
 * is a renderer-owned `webview`. Main authorizes and adopts its WebContents,
 * retains navigation policy and pushes state; the SPA owns DOM placement.
 *
 * Pages have no preload, run sandboxed with normal TLS, and share one persistent
 * installation-wide profile, isolated from the SPA and local HTML previews.
 * Ownership, engine selection and teardown orchestration belong to the manager.
 *
 * Mocked Electron event tests cover recording and keyboard forwarding; the live
 * harness (test/e2e/browser-view.e2e.test.ts) verifies browser event ordering,
 * guest isolation and restart persistence against local HTTP fixtures.
 */

import type { BrowserImportCookie } from './browser-cookie-import';
import { BrowserWindow, WebContents, session, shell, webContents } from 'electron';
import * as fs from 'node:fs';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { lockElectronProfile } from './browser-profile-lock';
import { BrowserHostError, type BrowserEngineHost, type BrowserEventSink, type BrowserHostedView, type BrowserSiteFacts, type BrowserViewRequest } from './browser-host-contract';
import {
    BROWSER_VIEW_DOWNLOAD_CHANNEL,
    BROWSER_VIEW_NEW_TAB_CHANNEL,
    BROWSER_VIEW_STATE_CHANNEL,
    BrowserDownloadEvent,
    BrowserSiteCertificate,
    BrowserViewState,
    browserUserAgent,
    classifyBrowserNavigation,
    classifyBrowserWindowOpen,
    isBrowserPermissionAllowed,
    hardenedBrowserPreferences,
    validateBrowserUrl,
} from './browser-view-policy';
import type { HtmlPageBounds } from './html-page-policy';
import { authorizeBrowserWebview, isBrowserEmbedder } from './browser-webview-guard';
import { ElectronBrowserCdp } from './electron-browser-cdp';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { browserPopupChrome } from './browser-popup-chrome';
import { translateBackgroundInput } from './electron-background-input';
import { isClickOnceRequest, validActivationUrl, type BrowserApplicationRequest } from './browser-clickonce';

interface BrowserEntry {
    win: BrowserWindow;
    /** SPA webContents id, kept because `win.webContents` is unreadable once the window is destroyed. */
    ownerId: number;
    contents?: WebContents;
    cdp?: ElectronBrowserCdp;
    shown: boolean;
    /** A background browser-control turn drives this guest; input must not go through the embedder. */
    background?: boolean;
    pageZoom: number;
    authorization?: ReturnType<typeof authorizeBrowserWebview>;
    viewId: string;
    /** Last URL we were asked to load; reload after a failed load retries it. */
    requestedUrl: string;
    error?: string;
    errorCode?: BrowserViewState['errorCode'];
    /** Chromium net error of the current main-frame failure. */
    netError?: number;
    popups: Set<BrowserWindow>;
    sink: BrowserEventSink;
    closed: boolean;
    clickOnceEnabled: boolean;
    applicationSources: Map<number, { generation: number; navigationUrl?: string; crashed: boolean }>;
}

const entries = new Set<BrowserEntry>();
/** Any webContents (tab view or pop-up) id → the tab entry it belongs to. */
const entryByContents = new Map<number, BrowserEntry>();
/** Control popout view ids by popup `webContents` id, so a held navigation names its popout. */
const popoutByContents = new Map<number, string>();
let profileSession: Electron.Session | undefined;
let profileLock: NativeDatabase | undefined;
/** Certificates Chromium verified this process lifetime, by hostname; bounded, newest last. */
const verifiedCertificates = new Map<string, BrowserSiteCertificate>();
const MAX_VERIFIED_CERTIFICATES = 256;

/** net::ERR_CERT_* codes occupy -200 to -299. */
function isCertificateNetError(code: number | undefined): boolean {
    return code !== undefined && code <= -200 && code > -300;
}

function recordCertificate(request: Electron.Request): void {
    verifiedCertificates.delete(request.hostname);
    if (request.errorCode !== 0) return;
    const certificate = request.validatedCertificate ?? request.certificate;
    verifiedCertificates.set(request.hostname, {
        subject: certificate.subjectName, issuer: certificate.issuerName,
        validStart: certificate.validStart, validExpiry: certificate.validExpiry,
    });
    if (verifiedCertificates.size > MAX_VERIFIED_CERTIFICATES) verifiedCertificates.delete(verifiedCertificates.keys().next().value!);
}

function send(entry: BrowserEntry, channel: string, payload: unknown): void {
    if (entry.closed) { return; }
    if (channel === BROWSER_VIEW_STATE_CHANNEL) { entry.sink.state(payload as BrowserViewState); }
    else if (channel === BROWSER_VIEW_NEW_TAB_CHANNEL) { entry.sink.newTab((payload as { url: string }).url); }
    else if (channel === BROWSER_VIEW_DOWNLOAD_CHANNEL) { entry.sink.download(payload as BrowserDownloadEvent); }
}

function snapshot(entry: BrowserEntry): BrowserViewState {
    const wc = entry.contents;
    if (!wc || wc.isDestroyed()) {
        return { viewId: entry.viewId, engine: 'electron', url: entry.requestedUrl, title: '', canGoBack: false, canGoForward: false, loading: false };
    }
    return {
        viewId: entry.viewId,
        engine: 'electron',
        url: entry.error ? entry.requestedUrl : wc.getURL() || entry.requestedUrl,
        title: entry.error ? '' : wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        loading: wc.isLoading(),
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    };
}

function pushState(entry: BrowserEntry): void {
    send(entry, BROWSER_VIEW_STATE_CHANNEL, snapshot(entry));
}

function destroyEntry(entry: BrowserEntry): void {
    if (entry.closed) { return; }
    entry.closed = true;
    entry.cdp?.dispose();
    entries.delete(entry);
    for (const popup of [...entry.popups]) {
        if (!popup.isDestroyed()) {
            popup.destroy();
        }
    }
    entry.popups.clear();
    entry.authorization?.dispose();
    if (entry.contents && !entry.contents.isDestroyed()) {
        entryByContents.delete(entry.contents.id);
        entry.contents.close();
    }
}

/** Session-wide hooks: Chrome-like UA, deny-by-default permissions, download handoff. */
function configureProfile(): void {
    const ses = profileSession!;
    ses.setUserAgent(browserUserAgent(ses.getUserAgent()));
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(isBrowserPermissionAllowed(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => isBrowserPermissionAllowed(permission));
    // Observe only: -3 keeps Chromium's own verification result, so invalid certificates still fail.
    ses.setCertificateVerifyProc((request, callback) => {
        recordCertificate(request);
        callback(-3);
    });
    ses.webRequest.onBeforeRequest((details, callback) => {
        const id = details.webContentsId;
        const entry = id === undefined ? undefined : entryByContents.get(id);
        const wc = id === undefined ? undefined : entry?.contents && entry.contents.id === id ? entry.contents : webContents.fromId(id);
        if (!entry || !wc || details.resourceType !== 'mainFrame') { callback({ cancel: false }); return; }
        if (interceptApplication(entry, wc, { kind: 'navigation', url: details.url })) { callback({ cancel: true }); return; }
        // Every main-frame request, including each redirect hop, is held here before it is sent.
        const gate = entry.sink.navigationGate?.(details.url, popoutByContents.get(wc.id)) ?? true;
        if (gate === true || gate === false) { callback({ cancel: !gate }); return; }
        gate.then(allow => callback({ cancel: !allow }), () => callback({ cancel: true }));
    });
    ses.on('will-download', (event, item, wc) => {
        event.preventDefault();
        const url = item.getURL();
        const entry = wc ? entryByContents.get(wc.id) : undefined;
        const original = item.getURLChain()[0];
        if (entry && wc && interceptApplication(entry, wc, {
            kind: 'download', url: validActivationUrl(original) ? original : url, deploymentUrl: url, mimeType: item.getMimeType(),
        })) return;
        const report = (ok: boolean, error?: string) => {
            if (entry) {
                const payload: BrowserDownloadEvent = { viewId: entry.viewId, url, ok, ...(error ? { error } : {}) };
                send(entry, BROWSER_VIEW_DOWNLOAD_CHANNEL, payload);
            }
        };
        if (!validateBrowserUrl(url).ok) {
            report(false, 'Only http(s) downloads can be opened in the system browser.');
            return;
        }
        shell.openExternal(url).then(
            () => report(true),
            (err: unknown) => report(false, err instanceof Error ? err.message : String(err)),
        );
    });
}

function webPreferences(): Electron.WebPreferences {
    return hardenedBrowserPreferences(profileSession!);
}

/** Navigation + `window.open` routing shared by the tab view and its pop-ups. */
function wireNavigation(entry: BrowserEntry, wc: WebContents): void {
    const source: { generation: number; navigationUrl?: string; crashed: boolean } = { generation: 0, crashed: false };
    entry.applicationSources.set(wc.id, source);
    wc.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) { source.generation++; source.navigationUrl = url; source.crashed = false; }
    });
    wc.on('render-process-gone', () => { source.generation++; source.crashed = true; });
    wireHistory(entry, wc);
    entryByContents.set(wc.id, entry);
    wc.once('destroyed', () => {
        if (entryByContents.get(wc.id) === entry) {
            entryByContents.delete(wc.id);
        }
        entry.applicationSources.delete(wc.id);
    });
    wc.setWindowOpenHandler(({ url, disposition }) => {
        if (interceptApplication(entry, wc, { kind: 'new-window', url })) return { action: 'deny' };
        const decision = classifyBrowserWindowOpen(url, disposition);
        if (decision === 'popup' && !entry.win.isDestroyed()) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    parent: entry.win,
                    autoHideMenuBar: true,
                    webPreferences: webPreferences(),
                },
            };
        }
        if (decision === 'tab') {
            send(entry, BROWSER_VIEW_NEW_TAB_CHANNEL, { openerViewId: entry.viewId, url });
        }
        return { action: 'deny' };
    });
    wc.on('did-create-window', (popup) => {
        entry.popups.add(popup);
        const viewId = `browser-popout-${randomUUID()}`;
        const contents = popup.webContents;
        const contentsId = contents.id;
        popoutByContents.set(contentsId, viewId);
        const cdp = entry.sink.controlPopoutOpened ? new ElectronBrowserCdp(contents) : undefined;
        const setControlActivity = browserPopupChrome(popup, turnId => entry.sink.controlStopRequested?.(viewId, turnId));
        contents.setZoomFactor(entry.pageZoom / 100);
        popup.on('focus', () => entry.sink.controlFocused?.());
        entry.sink.controlPopoutOpened?.(viewId, {
            snapshot: () => ({
                viewId, engine: 'electron', url: contents.isDestroyed() ? '' : contents.getURL(),
                title: contents.isDestroyed() ? '' : contents.getTitle(),
                canGoBack: !contents.isDestroyed() && contents.navigationHistory.canGoBack(),
                canGoForward: !contents.isDestroyed() && contents.navigationHistory.canGoForward(),
                loading: !contents.isDestroyed() && contents.isLoading(),
            }),
            cdp: (method, params, sessionId) => cdp!.send(method, params, sessionId),
            onCdpEvent: listener => cdp!.onEvent(listener),
            waitForCdpEvents: async () => {},
            setControlActivity,
            waitForControlReady: signal => waitForControlContents(() => contents, () => popup.isDestroyed(), signal),
            navigate: async url => { await contents.loadURL(url); },
            nav: action => {
                if (action === 'reload') contents.reload();
                if (action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
                if (action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
                if (action === 'stop') contents.stop();
            },
            focus: () => { if (!popup.isDestroyed()) { popup.show(); popup.focus(); } },
            setPageZoom: percent => contents.setZoomFactor(percent / 100),
            setBounds: () => {},
            close: () => { if (!popup.isDestroyed()) popup.close(); },
        });
        popup.once('closed', () => {
            popoutByContents.delete(contentsId);
            cdp?.dispose();
            entry.popups.delete(popup);
            entry.sink.controlPopoutClosed?.(viewId);
        });
        wireNavigation(entry, popup.webContents);
    });
    const guard = (event: Electron.Event, url: string, _inPlace?: boolean, isMainFrame = true) => {
        if ((isMainFrame && interceptApplication(entry, wc, { kind: 'navigation', url }))
            || classifyBrowserNavigation(url) === 'deny') {
            event.preventDefault();
        }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', (event, url, inPlace, isMainFrame) => {
        if (isMainFrame && validActivationUrl(source.navigationUrl)
            && interceptApplication(entry, wc, { kind: 'navigation', url: source.navigationUrl, deploymentUrl: url })) {
            event.preventDefault();
        } else guard(event, url, inPlace, isMainFrame);
    });
}

function interceptApplication(entry: BrowserEntry, wc: WebContents, request: BrowserApplicationRequest): boolean {
    if (!entry.clickOnceEnabled || !entry.sink.application || !isClickOnceRequest(request)) return false;
    const source = entry.applicationSources.get(wc.id);
    const generation = source?.generation;
    entry.sink.application(request, () => !entry.closed && !entry.win.isDestroyed() && !wc.isDestroyed()
        && entryByContents.get(wc.id) === entry && entry.applicationSources.get(wc.id) === source
        && source !== undefined && !source.crashed && source.generation === generation);
    return true;
}

/** Main and popup documents record independently; loading/state notifications never record. */
function wireHistory(entry: BrowserEntry, wc: WebContents): void {
    let pendingUrl: string | undefined;
    let successfulUrl: string | undefined;
    const live = () => !entry.closed && !wc.isDestroyed();
    wc.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
            pendingUrl = undefined;
            successfulUrl = undefined;
            if (wc === entry.contents) entry.sink.navigationStarted?.();
        }
    });
    wc.on('did-navigate', (_event, url, responseCode) => {
        // Error documents and non-HTTP navigations cannot arm a successful visit.
        pendingUrl = responseCode >= 0 && validateBrowserUrl(url).ok ? url : undefined;
    });
    const failed = (_event: Electron.Event, _code: number, _description: string, url: string, isMainFrame: boolean) => {
        if (isMainFrame && (!pendingUrl || !url || pendingUrl === url)) {
            pendingUrl = undefined;
            successfulUrl = undefined;
        }
    };
    wc.on('did-fail-load', failed);
    wc.on('did-fail-provisional-load', failed);
    wc.on('render-process-gone', () => { pendingUrl = undefined; successfulUrl = undefined; });
    wc.on('did-frame-finish-load', (_event, isMainFrame) => {
        if (!live() || !isMainFrame || !pendingUrl) { return; }
        successfulUrl = pendingUrl;
        pendingUrl = undefined;
        if (wc === entry.contents) entry.sink.documentCommitted?.(successfulUrl, wc.getTitle());
        entry.sink.visited?.(successfulUrl, wc.getTitle());
    });
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (!live() || !isMainFrame || !validateBrowserUrl(url).ok) { return; }
        // An initial document may change its URL before onload; record its final URL once.
        if (pendingUrl) { pendingUrl = url; return; }
        if (!successfulUrl) { return; }
        successfulUrl = url;
        if (wc === entry.contents) entry.sink.documentCommitted?.(url, wc.getTitle());
        entry.sink.visited?.(url, wc.getTitle());
    });
    wc.on('page-title-updated', (_event, title) => {
        if (live() && successfulUrl) {
            if (wc === entry.contents) entry.sink.documentTitleUpdated?.(successfulUrl, title);
            entry.sink.titleUpdated?.(successfulUrl, title);
        }
    });
}

function wireView(entry: BrowserEntry): void {
    const wc = entry.contents!;
    entry.cdp = new ElectronBrowserCdp(wc);
    // Hidden web tabs must still process shared zoom and layout changes.
    wc.setBackgroundThrottling(false);
    const applyZoom = () => {
        if (!entry.closed && !wc.isDestroyed()) { wc.setZoomFactor(entry.pageZoom / 100); }
    };
    applyZoom();
    // Chromium's origin-scoped zoom can change on cross-origin navigation.
    wc.on('dom-ready', applyZoom);
    wc.on('did-navigate', applyZoom);
    wc.on('zoom-changed', applyZoom);
    wireNavigation(entry, wc);
    wc.on('before-input-event', (event, input) => {
        // Only the embedded view, never authentication popups, owns this shortcut.
        const key = input.key.toLowerCase();
        const modifier = process.platform === 'darwin' ? input.meta : input.control;
        if (modifier && !input.alt && ['+', '=', '-', '_', '0'].includes(key)) {
            event.preventDefault();
            return;
        }
        if (entry.closed || !entry.shown || input.type !== 'keyDown'
            || !['w', 't', 'l'].includes(key) || !modifier || input.alt
            || (key === 'l' && (input.shift || !entry.sink.focusAddressRequested))
            || (key === 't' && input.shift && !entry.sink.reopenClosedRequested)) { return; }
        event.preventDefault();
        if (!input.isAutoRepeat) {
            if (key === 't' || key === 'l') {
                entry.win.webContents.focus();
                if (key === 'l') { entry.sink.focusAddressRequested!(); }
                else if (input.shift) { entry.sink.reopenClosedRequested!(); }
                else { entry.sink.openMenuRequested(); }
            } else { entry.sink.closeRequested(); }
        }
    });
    const update = () => pushState(entry);
    wc.on('did-start-loading', () => {
        entry.error = undefined;
        entry.errorCode = undefined;
        entry.netError = undefined;
        update();
    });
    wc.on('did-stop-loading', update);
    wc.on('did-navigate', update);
    wc.on('did-navigate-in-page', update);
    wc.on('page-title-updated', update);
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // -3 is ERR_ABORTED: a navigation we (or the user, via Stop) cancelled.
        if (isMainFrame && errorCode !== -3) {
            entry.error = errorDescription || `Load failed (${errorCode})`;
            entry.errorCode = 'navigation-failed';
            entry.netError = errorCode;
            if (validatedURL) {
                entry.requestedUrl = validatedURL;
            }
            update();
        }
    });
    wc.on('render-process-gone', (_event, details) => {
        entry.error = `Page crashed (${details.reason})`;
        entry.errorCode = 'runtime-crashed';
        update();
    });
    wc.once('destroyed', () => {
        if (!entry.closed) { destroyEntry(entry); entry.sink.closed?.(); }
    });
}

function load(entry: BrowserEntry, url: string): void {
    if (!entry.contents) { throw new BrowserHostError('busy', 'Browser guest is not attached yet.'); }
    if (interceptApplication(entry, entry.contents, { kind: 'navigation', url })) return;
    const source = entry.applicationSources.get(entry.contents.id);
    if (source) source.generation++;
    entry.requestedUrl = url;
    entry.error = undefined;
    entry.errorCode = undefined;
    entry.netError = undefined;
    void entry.contents.loadURL(url).catch(() => {
        /* surfaced by did-fail-load */
    });
}

function ownWindow(sender: WebContents): BrowserWindow | null {
    const win = BrowserWindow.fromWebContents(sender);
    // Only a window's own SPA document may drive browser views — never a child view.
    return win && !win.isDestroyed() && win.webContents === sender && isBrowserEmbedder(sender) ? win : null;
}

function openView(sender: WebContents, request: BrowserViewRequest, sink: BrowserEventSink): BrowserEntry {
    const { viewId, url } = request;
    const win = ownWindow(sender);
    if (!win) {
        throw new BrowserHostError('no-window', 'Browser window is closed.');
    }
    const entry: BrowserEntry = { win, ownerId: sender.id, shown: false, pageZoom: request.pageZoomPercent ?? 100, viewId, requestedUrl: url, popups: new Set(), sink, closed: false,
        clickOnceEnabled: request.clickOnceEnabled === true, applicationSources: new Map() };
    entries.add(entry);
    entry.authorization = authorizeBrowserWebview(sender.id, url, profileSession!, guest => {
        entry.contents = guest;
        wireView(entry);
    }, () => {
        destroyEntry(entry);
        sink.closed?.();
    });
    return entry;
}

function runNav(entry: BrowserEntry, action: string): void {
    const wc = entry.contents;
    if (!wc || wc.isDestroyed()) {
        return;
    }
    switch (action) {
        case 'back':
            if (wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); }
            break;
        case 'forward':
            if (wc.navigationHistory.canGoForward()) { wc.navigationHistory.goForward(); }
            break;
        case 'stop':
            wc.stop();
            pushState(entry);
            break;
        case 'reload':
            // After a failed load the error page is not a real history entry; retry the URL.
            if (entry.error || !wc.getURL()) {
                load(entry, entry.requestedUrl);
            } else {
                wc.reload();
            }
            break;
    }
}

function setBounds(entry: BrowserEntry, bounds: HtmlPageBounds | null): void {
    entry.shown = bounds !== null;
}

/** Deliver background input to the guest itself; CDP keyboard input would reach the embedder's focused element. */
async function sendBackgroundInput(entry: BrowserEntry, method: string, params: Record<string, unknown> | undefined, sessionId: string | undefined): Promise<unknown> {
    const steps = translateBackgroundInput(method, params, sessionId);
    const contents = entry.contents;
    if (entry.closed || !contents || contents.isDestroyed()) { throw new BrowserHostError('not-found', 'Browser tab is closed.'); }
    for (const step of steps) {
        if (step.kind === 'insertText') { await contents.insertText(step.text); }
        else if (step.kind === 'selectAll') { contents.selectAll(); }
        else { contents.sendInputEvent(step.event); }
    }
    // sendInputEvent only queues; let the page handle it before the next control step reads page state.
    await Promise.race([
        entry.cdp!.send('Runtime.evaluate', { expression: 'new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)))', awaitPromise: true }),
        delay(1_000),
    ]);
    return {};
}

async function waitForControlContents(getContents: () => WebContents | undefined, closed: () => boolean, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (true) {
        signal.throwIfAborted();
        const contents = getContents();
        if (closed() || contents?.isDestroyed()) throw new Error('Browser tab closed');
        if (contents && !contents.isLoading() && contents.getURL()) return;
        if (Date.now() >= deadline) throw new Error('Browser page did not become ready after 60s');
        await delay(20, undefined, { signal });
    }
}

export class ElectronBrowserHost implements BrowserEngineHost {
    readonly engine = 'electron' as const;

    constructor(private readonly profilePath: string) {}

    async availability() { return { engine: this.engine, available: true }; }

    private profile(): Electron.Session {
        if (!profileLock) { profileLock = lockElectronProfile(this.profilePath); }
        if (!profileSession) {
            try {
                fs.mkdirSync(this.profilePath, { recursive: true });
                profileSession = session.fromPath(this.profilePath);
                configureProfile();
            } catch (error) {
                profileLock.close();
                profileLock = undefined;
                profileSession = undefined;
                throw error;
            }
        }
        return profileSession;
    }

    async create(request: BrowserViewRequest, sink: BrowserEventSink): Promise<BrowserHostedView> {
        this.profile();
        const sender = webContents.fromId(request.ownerId);
        if (!sender) { throw new BrowserHostError('no-window', 'Browser window is closed.'); }
        const entry = openView(sender, request, sink);
        return {
            embed: 'webview',
            src: entry.authorization!.src,
            partition: entry.authorization!.partition,
            adopt: guestId => {
                entry.authorization!.adopt(guestId);
                pushState(entry);
            },
            importCookies: cookies => this.importCookies(cookies),
            siteFacts: url => this.siteFacts(entry, url),
            snapshot: () => snapshot(entry),
            navigate: url => load(entry, url),
            nav: action => runNav(entry, action),
            cdp: (method, params, sessionId) => {
                if (entry.closed) { return Promise.reject(new BrowserHostError('not-found', 'Browser tab is closed.')); }
                if (!entry.cdp) { return Promise.reject(new BrowserHostError('busy', 'Browser guest is not attached yet.')); }
                if (entry.background && method.startsWith('Input.')) { return sendBackgroundInput(entry, method, params, sessionId); }
                return entry.cdp.send(method, params, sessionId);
            },
            onCdpEvent: listener => {
                if (entry.closed) { throw new BrowserHostError('not-found', 'Browser tab is closed.'); }
                if (!entry.cdp) { throw new BrowserHostError('busy', 'Browser guest is not attached yet.'); }
                return entry.cdp.onEvent(listener);
            },
            waitForCdpEvents: async () => {},
            waitForControlReady: async signal => {
                await waitForControlContents(() => entry.contents, () => entry.closed, signal);
                if (entry.error) throw new Error(entry.error);
            },
            setPageZoom: percent => {
                entry.pageZoom = percent;
                if (entry.contents && !entry.contents.isDestroyed()) { entry.contents.setZoomFactor(percent / 100); }
            },
            setBounds: bounds => setBounds(entry, bounds),
            setBackgroundControl: enabled => { entry.background = enabled; },
            focus: async () => {
                if (entry.closed || entry.win.isDestroyed() || !entry.contents || entry.contents.isDestroyed()) {
                    throw new BrowserHostError('not-found', 'Browser tab is closed.');
                }
                entry.win.show();
                entry.win.focus();
                entry.win.webContents.focus();
                if (!isBrowserEmbedder(entry.win.webContents)) throw new BrowserHostError('invalid', 'Browser embedder is unavailable.');
                const focused = await entry.win.webContents.executeJavaScript(`(() => {
                    for (const guest of document.querySelectorAll('webview')) {
                        if (guest.getWebContentsId() === ${entry.contents.id}) {
                            guest.focus();
                            return document.activeElement === guest;
                        }
                    }
                    return false;
                })()`);
                if (entry.closed || !isBrowserEmbedder(entry.win.webContents) || !focused) throw new BrowserHostError('invalid', 'Browser guest focus unavailable.');
                entry.contents.focus();
            },
            close: () => destroyEntry(entry),
        };
    }

    async importCookies(cookies: BrowserImportCookie[]): Promise<void> {
        for (const cookie of cookies) { await this.profile().cookies.set(cookie); }
        await this.profile().cookies.flushStore();
    }

    /** Electron has no certificate-error bypass, so a loaded HTTPS page passed Chromium's verification. */
    private async siteFacts(entry: BrowserEntry, url: string | undefined): Promise<BrowserSiteFacts> {
        const facts: BrowserSiteFacts = { rejectsInvalidCertificates: true, certificateError: isCertificateNetError(entry.netError) };
        if (!url) return facts;
        const hostname = new URL(url).hostname;
        const certificate = url.startsWith('https:') ? verifiedCertificates.get(hostname) : undefined;
        if (certificate) facts.certificate = certificate;
        try { facts.cookieCount = (await this.profile().cookies.get({ url })).length; }
        catch { /* reported as unavailable; cookie errors are never surfaced */ }
        return facts;
    }

    async clearData(): Promise<void> {
        verifiedCertificates.clear();
        const profile = this.profile();
        // Clear the complete browsing-data set, including the network cookie store.
        await profile.clearData();
        await profile.clearAuthCache();
        await profile.clearCodeCaches({});
        await profile.cookies.flushStore();
        profile.flushStorageData();
    }

    async dispose(): Promise<void> {
        for (const entry of [...entries]) { destroyEntry(entry); }
        if (profileSession) {
            await profileSession.cookies.flushStore();
            profileSession.flushStorageData();
        }
        // Electron sessions (including background workers) live until process exit.
        // Keep the OS-backed lease for that same lifetime, including server drain.
    }
}
