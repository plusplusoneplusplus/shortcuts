/**
 * CoC Desktop — local HTML preview host (main-process side).
 *
 * The SPA's right panel can show a local `.html`/`.htm` file as a real
 * rendered page. `browser-host-manager.ts` owns these views next to browser
 * tabs (bounds, focus, history, teardown); this host only creates them. Each
 * preview is one renderer-owned `webview`, loaded over
 * `file://` so relative CSS/JS/images work.
 *
 * SECURITY — previews are always Electron, whatever the browser-engine
 * preference. A view gets NO preload, runs with `contextIsolation` + `sandbox`,
 * and lives in its own in-memory partition: it never shares storage with the
 * SPA or the `browser/electron` / `browser/webview2` profiles, and browser-data
 * cleanup never touches it. Only paths that pass `validateHtmlPagePath` reach
 * this host, and navigation / `window.open` go through the pure policy in
 * `html-page-policy.ts`.
 *
 * Host lifecycle and admission have unit tests; the live Electron harness
 * (test/e2e/html-page.e2e.test.ts) covers native guest behavior.
 */

import { app, BrowserWindow, dialog, type WebContents, session, shell, webContents } from 'electron';
import { manageElectronDownload } from './electron-downloads';
import { type BrowserDownloadStore } from './browser-downloads';
import { BrowserHostError, type BrowserEventSink, type BrowserHostedView, type FilePreviewHost, type FileViewRequest } from './browser-host-contract';
import type { BrowserViewState } from './browser-view-policy';
import { classifyHtmlPageNavigation, classifyHtmlPageWindowOpen, htmlPageFileUrl, type HtmlPageBounds } from './html-page-policy';
import { authorizeBrowserWebview, isBrowserEmbedder } from './browser-webview-guard';
import { FilePreviewDownloadGate, type FilePreviewDownloadScope } from './file-preview-download-gate';

/** In-memory partition (no `persist:` prefix) shared by previews only. */
export const HTML_PAGE_PARTITION = 'coc-html-page';

interface FileEntry {
    contents?: WebContents;
    owner: WebContents;
    sessionKey: string;
    downloads?: { gate: FilePreviewDownloadGate; scope: FilePreviewDownloadScope };
    disposeOwnerListeners?: () => void;
    resetInput?: () => void;
    shown: boolean;
    authorization?: ReturnType<typeof authorizeBrowserWebview>;
    viewId: string;
    /** The file the preview was opened with; the navigation policy is rooted at its folder. */
    filePath: string;
    error?: string;
    errorCode?: BrowserViewState['errorCode'];
    sink: BrowserEventSink;
    closed: boolean;
}

function snapshot(entry: FileEntry): BrowserViewState {
    const wc = entry.contents;
    const fileUrl = htmlPageFileUrl(entry.filePath);
    if (!wc || wc.isDestroyed()) {
        return { viewId: entry.viewId, engine: 'electron', sourceKind: 'file', url: fileUrl, title: '', canGoBack: false, canGoForward: false, loading: false };
    }
    return {
        viewId: entry.viewId,
        engine: 'electron',
        sourceKind: 'file',
        url: wc.getURL() || fileUrl,
        title: entry.error ? '' : wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        loading: wc.isLoading(),
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    };
}

function revokeDownloads(entry: FileEntry): void {
    entry.resetInput?.();
    entry.downloads?.gate.close();
    entry.downloads = undefined;
}

function wireView(entry: FileEntry): void {
    const wc = entry.contents!;
    const update = () => { if (!entry.closed) { entry.sink.state(snapshot(entry)); } };
    wc.setWindowOpenHandler(({ url }) => {
        if (classifyHtmlPageWindowOpen(url) === 'external') {
            void shell.openExternal(url);
        }
        return { action: 'deny' };
    });
    const guard = (event: Electron.Event, url: string) => {
        const decision = classifyHtmlPageNavigation(url, wc.getURL(), entry.filePath);
        if (decision === 'allow') {
            return;
        }
        event.preventDefault();
        if (decision === 'external') {
            void shell.openExternal(url);
        }
    };
    // These hooks run in main, before Chromium delivers input to page scripts.
    // DOM dispatchEvent/click cannot mint intent. File views expose no agent CDP/control path.
    const recordAction = () => {
        const ownerWindow = BrowserWindow.fromWebContents(entry.owner);
        if (!entry.closed && entry.shown && !wc.isDestroyed() && wc.isFocused()
            && !entry.owner.isDestroyed() && isBrowserEmbedder(entry.owner) && ownerWindow?.isFocused()) {
            const download = entry.downloads;
            download?.gate.recordUserAction(download.scope);
        }
    };
    let primaryDown = false;
    entry.resetInput = () => { primaryDown = false; };
    wc.on('before-mouse-event', (event, mouse) => {
        if (mouse.type === 'mouseDown') primaryDown = mouse.button === 'left' && !event.defaultPrevented && entry.shown;
        if (mouse.type === 'mouseUp') {
            const clicked = primaryDown && mouse.button === 'left';
            primaryDown = false;
            if (clicked && !event.defaultPrevented) recordAction();
        }
    });
    wc.on('blur', () => { primaryDown = false; });
    wc.on('did-start-navigation', details => {
        // File navigation replaces the document. Blob/data download attempts must
        // retain their gesture until will-download, without allowing navigation.
        if (details.isMainFrame && !details.isSameDocument
            && classifyHtmlPageNavigation(details.url, wc.getURL(), entry.filePath) === 'allow') {
            primaryDown = false;
            revokeDownloads(entry);
        }
    });
    const commitDownloadDocument = (url: string) => {
        primaryDown = false;
        revokeDownloads(entry);
        if (entry.closed || !url.startsWith('file:') || classifyHtmlPageNavigation(url, htmlPageFileUrl(entry.filePath), entry.filePath) !== 'allow') return;
        const scope: FilePreviewDownloadScope = {
            ownerId: entry.owner.id, sessionKey: entry.sessionKey, viewId: entry.viewId, guestId: wc.id, document: {},
        };
        const gate = new FilePreviewDownloadGate(scope);
        gate.setVisible(entry.shown);
        entry.downloads = { gate, scope };
    };
    wc.on('did-navigate', (_event, url) => commitDownloadDocument(url));
    // A guest's native input never reaches the SPA's document key listener.
    wc.on('before-input-event', (event, input) => {
        const modifier = process.platform === 'darwin' ? input.meta : input.control;
        // The app menu binds no reload key, so only a focused preview reloads.
        if (modifier && !input.alt && input.key.toLowerCase() === 'r') {
            event.preventDefault();
            if (!entry.closed && entry.shown && input.type === 'keyDown' && !input.isAutoRepeat) { runNav(entry, 'reload'); }
            return;
        }
        if (!modifier || input.alt || input.key.toLowerCase() !== 'w') {
            if (!event.defaultPrevented && !input.control && !input.meta && !input.alt && !input.isAutoRepeat
                && ((input.key === 'Enter' && input.type === 'keyDown') || (input.key === ' ' && input.type === 'keyUp'))) recordAction();
            return;
        }
        event.preventDefault();
        if (!entry.closed && entry.shown && input.type === 'keyDown' && !input.isAutoRepeat) {
            entry.sink.closeRequested();
        }
    });
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    // Chromium follows a failed load with its own error page load, so a
    // failure stays sticky until the user starts the next load.
    let failed = false;
    wc.on('did-start-loading', () => {
        if (!failed) {
            entry.error = undefined;
            entry.errorCode = undefined;
        }
        failed = false;
        update();
    });
    wc.on('did-stop-loading', () => {
        // A cancelled file navigation can leave the original document alive.
        // Restore admission with fresh intent, never the cancelled lease.
        if (!entry.downloads && !entry.error) commitDownloadDocument(wc.getURL());
        update();
    });
    wc.on('did-navigate', update);
    wc.on('did-navigate-in-page', update);
    wc.on('page-title-updated', update);
    wc.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
        // -3 is ERR_ABORTED: a navigation we cancelled ourselves in the guard.
        if (isMainFrame && errorCode !== -3) {
            revokeDownloads(entry);
            failed = true;
            entry.error = errorDescription || `Load failed (${errorCode})`;
            entry.errorCode = 'navigation-failed';
            update();
        }
    });
    wc.on('render-process-gone', (_event, details) => {
        revokeDownloads(entry);
        entry.error = `Page crashed (${details.reason})`;
        entry.errorCode = 'runtime-crashed';
        update();
    });
}

function load(entry: FileEntry): void {
    if (!entry.contents) { return; }
    entry.error = undefined;
    entry.errorCode = undefined;
    void entry.contents.loadURL(htmlPageFileUrl(entry.filePath)).catch(() => {
        /* surfaced by did-fail-load */
    });
}

function runNav(entry: FileEntry, action: string): void {
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
            entry.sink.state(snapshot(entry));
            break;
        case 'reload':
            revokeDownloads(entry);
            // After a failed first load getURL() can be empty; load the original file then.
            if (wc.getURL()) {
                wc.reload();
            } else {
                load(entry);
            }
            break;
    }
}

function setBounds(entry: FileEntry, bounds: HtmlPageBounds | null): void {
    entry.shown = bounds !== null;
    if (!entry.shown) entry.resetInput?.();
    entry.downloads?.gate.setVisible(entry.shown);
}

export class ElectronFilePreviewHost implements FilePreviewHost {
    private readonly entries = new Set<FileEntry>();
    private downloadSession?: Electron.Session;

    constructor(private readonly downloads?: BrowserDownloadStore) {}

    private readonly willDownload = (event: Electron.Event, item: Electron.DownloadItem, guest?: WebContents) => {
        const entry = [...this.entries].find(value => value.contents === guest);
        const approval = guest && this.requestDownload(guest, item.getURL());
        // Reject before Chromium can show its default dialog or choose a path.
        if (!entry || !approval) { event.preventDefault(); return; }
        const document = entry.downloads;
        const fail = (error: string) => {
            if (!entry.closed && entry.downloads === document && !approval.signal.aborted && entry.shown
                && guest && !guest.isDestroyed() && guest.hostWebContents === entry.owner && !entry.owner.isDestroyed()
                && isBrowserEmbedder(entry.owner)) {
                entry.sink.download({ viewId: entry.viewId, url: 'Local or private source', ok: false, error });
            }
        };
        const owner = BrowserWindow.fromWebContents(entry.owner);
        if (!this.downloads || !owner || owner.isDestroyed()) {
            event.preventDefault();
            fail('Download management is unavailable.');
            approval.cancel();
            return;
        }
        try {
            if (manageElectronDownload(this.downloads, item, app.getPath('downloads'), {
                ...approval,
                onFailure: () => fail('Unable to save the download. Try Download again.'),
                chooseDestination: defaultPath => dialog.showSaveDialogSync(owner, {
                    title: 'Save As', defaultPath,
                    // Native overwrite confirmation; Linux portals need the explicit hint.
                    properties: ['showOverwriteConfirmation', 'createDirectory'],
                }),
            })) return;
            event.preventDefault();
            // Adapter retires the lease on rejected admission; this notice has no private result.
            if (!entry.closed && entry.shown && !entry.owner.isDestroyed() && isBrowserEmbedder(entry.owner)) {
                entry.sink.download({ viewId: entry.viewId, url: 'Local or private source', ok: false,
                    error: 'Too many active downloads or desktop is shutting down.' });
            }
        } catch {
            event.preventDefault();
            fail('Unable to start the download. Try Download again.');
            approval.cancel();
        }
    };

    private installDownloads(profile: Electron.Session): void {
        if (this.downloadSession) return;
        this.downloadSession = profile;
        profile.on('will-download', this.willDownload);
    }

    async create(request: FileViewRequest, sink: BrowserEventSink): Promise<BrowserHostedView> {
        const sender = webContents.fromId(request.ownerId);
        const win = sender ? BrowserWindow.fromWebContents(sender) : null;
        // Only a window's own SPA document may host previews — never a child view.
        if (!sender || !win || win.isDestroyed() || win.webContents !== sender || !isBrowserEmbedder(sender)) {
            throw new BrowserHostError('no-window', 'Preview window is closed.');
        }
        const entry: FileEntry = { owner: sender, sessionKey: request.sessionKey, shown: false, viewId: request.viewId, filePath: request.path, sink, closed: false };
        const profile = session.fromPartition(HTML_PAGE_PARTITION);
        this.installDownloads(profile);
        entry.authorization = authorizeBrowserWebview(
            sender.id, htmlPageFileUrl(request.path), profile,
            guest => {
                entry.contents = guest;
                wireView(entry);
                guest.once('destroyed', () => {
                    if (!entry.closed) { this.destroy(entry); sink.closed?.(); }
                });
            },
            () => { this.destroy(entry); sink.closed?.(); },
            request.path,
        );
        const ownerClosed = () => { this.destroy(entry); sink.closed?.(); };
        const ownerNavigating = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
            if (details.isMainFrame && !details.isSameDocument) ownerClosed();
        };
        sender.once('destroyed', ownerClosed);
        sender.on('did-start-navigation', ownerNavigating);
        entry.disposeOwnerListeners = () => {
            sender.removeListener('destroyed', ownerClosed);
            sender.removeListener('did-start-navigation', ownerNavigating);
        };
        this.entries.add(entry);
        return {
            embed: 'webview',
            src: entry.authorization.src,
            partition: entry.authorization.partition,
            adopt: guestId => {
                entry.authorization!.adopt(guestId);
                sink.state(snapshot(entry));
            },
            snapshot: () => snapshot(entry),
            navigate: () => { /* the manager never navigates previews */ },
            nav: action => runNav(entry, action),
            setBounds: bounds => setBounds(entry, bounds),
            focus: () => { if (entry.shown) { entry.contents?.focus(); } },
            close: () => this.destroy(entry),
        };
    }

    /** Main-only admission for the original guest DownloadItem; never exposed over IPC. */
    requestDownload(guest: WebContents, url: string): { signal: AbortSignal; approve(): boolean; cancel(): void } | undefined {
        const entry = [...this.entries].find(value => value.contents === guest);
        if (!entry || guest.isDestroyed() || guest.hostWebContents !== entry.owner
            || entry.owner.isDestroyed() || !isBrowserEmbedder(entry.owner)) return undefined;
        const download = entry.downloads;
        if (!download) return undefined;
        const pending = download.gate.request(download.scope, url);
        if (!pending) return undefined;
        return {
            signal: pending.signal,
            approve: () => {
                if (entry.downloads !== download || entry.closed || guest.isDestroyed() || guest.hostWebContents !== entry.owner
                    || entry.owner.isDestroyed() || !isBrowserEmbedder(entry.owner)) {
                    pending.cancel();
                    return false;
                }
                return pending.approve(download.scope);
            },
            cancel: () => pending.cancel(),
        };
    }

    private destroy(entry: FileEntry): void {
        if (entry.closed) { return; }
        entry.closed = true;
        revokeDownloads(entry);
        entry.disposeOwnerListeners?.();
        this.entries.delete(entry);
        entry.authorization?.dispose();
        if (entry.contents && !entry.contents.isDestroyed()) {
            entry.contents.close();
        }
    }

    async dispose(): Promise<void> {
        for (const entry of [...this.entries]) { this.destroy(entry); }
        this.downloadSession?.removeListener('will-download', this.willDownload);
        this.downloadSession = undefined;
    }
}
