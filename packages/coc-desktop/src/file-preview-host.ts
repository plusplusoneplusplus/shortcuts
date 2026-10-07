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
 * This module imports from `electron`, so it is exercised by the live Electron
 * harness (test/e2e/html-page.e2e.test.ts) rather than unit tests; keep the
 * logic here thin and push everything testable into `html-page-policy.ts`.
 */

import { BrowserWindow, type WebContents, session, shell, webContents } from 'electron';
import { BrowserHostError, type BrowserEventSink, type BrowserHostedView, type FilePreviewHost, type FileViewRequest } from './browser-host-contract';
import type { BrowserViewState } from './browser-view-policy';
import { classifyHtmlPageNavigation, classifyHtmlPageWindowOpen, htmlPageFileUrl, type HtmlPageBounds } from './html-page-policy';
import { authorizeBrowserWebview, isBrowserEmbedder } from './browser-webview-guard';

/** In-memory partition (no `persist:` prefix) shared by previews only. */
export const HTML_PAGE_PARTITION = 'coc-html-page';

interface FileEntry {
    contents?: WebContents;
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
    wc.on('did-stop-loading', update);
    wc.on('did-navigate', update);
    wc.on('did-navigate-in-page', update);
    wc.on('page-title-updated', update);
    wc.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
        // -3 is ERR_ABORTED: a navigation we cancelled ourselves in the guard.
        if (isMainFrame && errorCode !== -3) {
            failed = true;
            entry.error = errorDescription || `Load failed (${errorCode})`;
            entry.errorCode = 'navigation-failed';
            update();
        }
    });
    wc.on('render-process-gone', (_event, details) => {
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
}

export class ElectronFilePreviewHost implements FilePreviewHost {
    private readonly entries = new Set<FileEntry>();

    async create(request: FileViewRequest, sink: BrowserEventSink): Promise<BrowserHostedView> {
        const sender = webContents.fromId(request.ownerId);
        const win = sender ? BrowserWindow.fromWebContents(sender) : null;
        // Only a window's own SPA document may host previews — never a child view.
        if (!sender || !win || win.isDestroyed() || win.webContents !== sender || !isBrowserEmbedder(sender)) {
            throw new BrowserHostError('no-window', 'Preview window is closed.');
        }
        const entry: FileEntry = { shown: false, viewId: request.viewId, filePath: request.path, sink, closed: false };
        entry.authorization = authorizeBrowserWebview(
            sender.id, htmlPageFileUrl(request.path), session.fromPartition(HTML_PAGE_PARTITION),
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

    private destroy(entry: FileEntry): void {
        if (entry.closed) { return; }
        entry.closed = true;
        this.entries.delete(entry);
        entry.authorization?.dispose();
        if (entry.contents && !entry.contents.isDestroyed()) {
            entry.contents.close();
        }
    }

    async dispose(): Promise<void> {
        for (const entry of [...this.entries]) { this.destroy(entry); }
    }
}
