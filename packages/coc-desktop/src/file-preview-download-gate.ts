/** Main-process identity, captured from the attached guest, never supplied by its page. */
export interface FilePreviewDownloadScope {
    readonly ownerId: number;
    /** Concrete workspace/server routing identity, not the shared preview partition. */
    readonly sessionKey: string;
    readonly viewId: string;
    readonly guestId: number;
    /** Unique main-owned token for this live document, including reloads of the same URL. */
    readonly document: object;
}

export interface PendingFilePreviewDownload {
    /** Cancels only a request awaiting approval; approved transfers outlive their preview. */
    readonly signal: AbortSignal;
    approve(scope: FilePreviewDownloadScope): boolean;
    cancel(): void;
}

const USER_INTENT_MS = 5_000;
const SAVE_APPROVAL_MS = 60_000;

/**
 * One gate per attached preview. Only trusted desktop input may call recordUserAction.
 * This gate grants no filesystem access: approval must still come from native Save As.
 */
export class FilePreviewDownloadGate {
    private readonly scope: FilePreviewDownloadScope;
    private visible = false;
    private closed = false;
    private intentUntil = 0;
    private pending?: PendingFilePreviewDownload;

    constructor(scope: FilePreviewDownloadScope) {
        this.scope = { ...scope };
    }

    private matches(scope: FilePreviewDownloadScope): boolean {
        const own = this.scope;
        return !this.closed && this.visible && own.ownerId === scope.ownerId && own.sessionKey === scope.sessionKey
            && own.viewId === scope.viewId && own.guestId === scope.guestId && own.document === scope.document;
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        if (!visible) this.revoke();
    }

    /** Call before replacing a document, detaching its guest, or destroying its owner. */
    close(): void {
        this.closed = true;
        this.revoke();
    }

    private revoke(): void {
        this.intentUntil = 0;
        this.pending?.cancel();
    }

    recordUserAction(scope: FilePreviewDownloadScope): boolean {
        if (!this.matches(scope) || this.pending) return false;
        this.intentUntil = performance.now() + USER_INTENT_MS;
        return true;
    }

    /** Admission consumes one action; rejects other schemes without enabling navigation. */
    request(scope: FilePreviewDownloadScope, url: string): PendingFilePreviewDownload | undefined {
        if (!this.matches(scope) || this.pending || this.intentUntil <= performance.now()) return undefined;
        // Inspect only the scheme: data URLs can contain arbitrarily large native payloads.
        if (!/^(?:blob|data):/i.test(url)) return undefined;
        this.intentUntil = 0;
        const abort = new AbortController();
        const deadline = performance.now() + SAVE_APPROVAL_MS;
        const retire = () => {
            clearTimeout(timer);
            if (this.pending === pending) this.pending = undefined;
        };
        const pending: PendingFilePreviewDownload = {
            signal: abort.signal,
            approve: current => {
                if (this.pending !== pending || !this.matches(current)) return false;
                if (performance.now() >= deadline) {
                    pending.cancel();
                    return false;
                }
                retire();
                return true;
            },
            cancel: () => {
                if (this.pending !== pending) return;
                retire();
                abort.abort(new Error('Preview download approval cancelled.'));
            },
        };
        const timer = setTimeout(() => pending.cancel(), SAVE_APPROVAL_MS);
        timer.unref();
        this.pending = pending;
        return pending;
    }
}
