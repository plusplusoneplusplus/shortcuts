/**
 * Close handling for raw PDF windows created by the CoC SPA.
 *
 * Chromium's PDF viewer installs a beforeunload guard while annotations have
 * not been saved. Electron otherwise leaves a BrowserWindow open without any
 * explanation when that guard vetoes a close. This module wires only known,
 * same-origin PDF children and asks the host to confirm before overriding the
 * guard.
 *
 * The interfaces are deliberately structural so the policy stays testable in
 * plain Node without loading the Electron runtime.
 */

export interface PreventUnloadEvent {
    preventDefault(): void;
}

type PreventUnloadListener = (event: PreventUnloadEvent) => void;

export interface PdfChildWindow {
    webContents: {
        on(event: 'will-prevent-unload', listener: PreventUnloadListener): unknown;
        removeListener(event: 'will-prevent-unload', listener: PreventUnloadListener): unknown;
    };
    on(event: 'close', listener: () => void): unknown;
    removeListener(event: 'close', listener: () => void): unknown;
    once(event: 'closed', listener: () => void): unknown;
    removeListener(event: 'closed', listener: () => void): unknown;
}

export interface PdfChildWindowParent {
    on(
        event: 'did-create-window',
        listener: (window: PdfChildWindow, details: { url: string }) => void,
    ): unknown;
    once(event: 'destroyed', listener: () => void): unknown;
    removeListener(
        event: 'did-create-window',
        listener: (window: PdfChildWindow, details: { url: string }) => void,
    ): unknown;
    removeListener(event: 'destroyed', listener: () => void): unknown;
}

export interface PdfChildWindowCloseDeps {
    /**
     * Return true only when the user explicitly chose to discard the unsaved
     * annotations and continue the pending close.
     */
    confirmDiscard: (window: PdfChildWindow) => boolean;
}

function hasPdfExtension(value: string): boolean {
    return /\.pdf$/i.test(value);
}

/**
 * Identify raw PDF URLs that Electron is allowed to open as child windows.
 *
 * Notes serves PDFs through same-origin `notes/image` and `notes/local-image`
 * endpoints whose `path` query identifies the file. Direct same-origin `.pdf`
 * URLs are included as well. Other query values ending in `.pdf` are
 * intentionally ignored so unrelated popups are not opted into this policy.
 */
export function isSameOriginPdfChildUrl(targetUrl: string, appUrl: string): boolean {
    let target: URL;
    let app: URL;
    try {
        target = new URL(targetUrl);
        app = new URL(appUrl);
    } catch {
        return false;
    }

    if (
        (target.protocol !== 'http:' && target.protocol !== 'https:') ||
        target.origin !== app.origin
    ) {
        return false;
    }

    if (hasPdfExtension(target.pathname)) {
        return true;
    }

    const isNotesFileEndpoint =
        /\/api\/workspaces\/[^/]+\/notes\/(?:image|local-image)\/?$/i.test(target.pathname);
    const notesPaths = target.searchParams.getAll('path');
    return isNotesFileEndpoint && notesPaths.length === 1 && hasPdfExtension(notesPaths[0]);
}

/**
 * Attach the beforeunload override to one PDF child and remove it on close.
 */
export function wirePdfChildWindowClose(
    window: PdfChildWindow,
    deps: PdfChildWindowCloseDeps,
): () => void {
    let closeRequested = false;
    const onClose = () => {
        closeRequested = true;
    };
    const onWillPreventUnload: PreventUnloadListener = (event) => {
        if (!closeRequested) {
            return;
        }
        closeRequested = false;
        if (deps.confirmDiscard(window)) {
            // Electron defines this inverse-looking call as "ignore the
            // beforeunload veto and continue the pending unload/close".
            event.preventDefault();
        }
    };

    let cleanedUp = false;
    const cleanup = () => {
        if (cleanedUp) {
            return;
        }
        cleanedUp = true;
        window.removeListener('close', onClose);
        window.webContents.removeListener('will-prevent-unload', onWillPreventUnload);
        window.removeListener('closed', cleanup);
    };

    window.on('close', onClose);
    window.webContents.on('will-prevent-unload', onWillPreventUnload);
    window.once('closed', cleanup);
    return cleanup;
}

/**
 * Watch one SPA parent for allowed PDF children. Unrelated children are left
 * untouched, and the parent listener is removed when its WebContents dies.
 */
export function wirePdfChildWindows(
    parent: PdfChildWindowParent,
    appUrl: string,
    deps: PdfChildWindowCloseDeps,
): () => void {
    const onDidCreateWindow = (
        window: PdfChildWindow,
        details: { url: string },
    ) => {
        if (isSameOriginPdfChildUrl(details.url, appUrl)) {
            wirePdfChildWindowClose(window, deps);
        }
    };

    let cleanedUp = false;
    const cleanup = () => {
        if (cleanedUp) {
            return;
        }
        cleanedUp = true;
        parent.removeListener('did-create-window', onDidCreateWindow);
        parent.removeListener('destroyed', cleanup);
    };

    parent.on('did-create-window', onDidCreateWindow);
    parent.once('destroyed', cleanup);
    return cleanup;
}
