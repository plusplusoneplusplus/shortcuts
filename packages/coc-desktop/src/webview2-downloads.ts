import * as path from 'node:path';
import { BrowserDownloadStore, downloadFilename, MAX_DOWNLOAD_RECORDS, type DownloadProgress } from './browser-downloads';

export const MAX_PENDING_WEBVIEW2_DOWNLOADS = 8;
const APPROVAL_TIMEOUT_MS = 60_000;
export function validWebView2DownloadId(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}
export function supportedWebView2Download(url: string): boolean {
    if (Buffer.byteLength(url, 'utf8') > 16384 || /[\x00-\x1f\x7f-\x9f]/.test(url)) return false;
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname
            || parsed.protocol === 'blob:' && !!parsed.pathname;
    }
    catch { return false; }
}

/** Captured in main, never minted by the page or renderer's URL/origin. */
export interface WebView2DownloadApproval {
    ownerId: number;
    current(): boolean;
    chooseDestination(filename: string): Promise<string | undefined>;
    dispose(): void;
    failure(): void;
}
interface Transfer {
    viewId: string;
    id: string;
    approval: WebView2DownloadApproval;
    lease: NonNullable<ReturnType<BrowserDownloadStore['start']>>;
    phase: 'pending' | 'approving' | 'active';
    progress: DownloadProgress;
    destination?: string;
    staged?: { progress: DownloadProgress; final: boolean };
    timer: ReturnType<typeof setTimeout>;
    watch: ReturnType<typeof setInterval>;
}
type NativeRequest = (op: string, payload: Record<string, unknown>) => Promise<void>;
const terminal = (state: DownloadProgress['state']): DownloadProgress =>
    ({ state, received: 0, total: 0, canPause: false, canResume: false });

/** Retains operation IDs, not URLs or bytes; all destinations come from a main-owned native dialog. */
export class WebView2Downloads {
    private transfers = new Map<string, Transfer>();
    private seen = new Set<string>();
    private choosers = new Set<number>();
    private closed = false;

    constructor(private readonly store: BrowserDownloadStore, private readonly request: NativeRequest) {}

    start(viewId: string, id: string, url: string, filename: string, approval: WebView2DownloadApproval): void {
        if (this.transfers.has(id) || this.seen.has(id)) { approval.dispose(); return; }
        const reject = () => {
            approval.dispose();
            void this.request('download-decide', { viewId, downloadId: id, action: 'cancel' })
                .catch(() => console.error('[coc-desktop] Download rejection failed.'));
        };
        const pending = [...this.transfers.values()].filter(item => item.phase !== 'active').length;
        if (this.closed || !validWebView2DownloadId(id) || !supportedWebView2Download(url)
            || !approval.current() || pending >= MAX_PENDING_WEBVIEW2_DOWNLOADS || this.choosers.has(approval.ownerId)) {
            approval.failure(); reject(); return;
        }
        this.seen.add(id);
        if (this.seen.size > MAX_DOWNLOAD_RECORDS) this.seen.delete(this.seen.values().next().value!);
        const lease = this.store.start(filename, url, {
            pause: () => this.action(id, 'pause'),
            resume: () => this.action(id, 'resume'),
            cancel: () => this.action(id, 'cancel'),
            dispose: () => this.retire(id),
        }, 'webview2');
        if (!lease) { approval.failure(); reject(); return; }
        const item: Transfer = {
            viewId, id, approval, lease, phase: 'pending',
            progress: terminal('downloading'),
            timer: setTimeout(() => { void this.cancelPending(item).catch(() => {}); }, APPROVAL_TIMEOUT_MS),
            watch: setInterval(() => { if (item.phase === 'pending' && !approval.current()) void this.cancelPending(item).catch(() => {}); }, 100),
        };
        item.timer.unref(); item.watch.unref();
        this.transfers.set(id, item);
        this.choosers.add(approval.ownerId);
        void this.choose(item, downloadFilename(filename));
    }

    private async choose(item: Transfer, filename: string): Promise<void> {
        try {
            const destination = await item.approval.chooseDestination(filename);
            if (this.transfers.get(item.id) !== item) return;
            if (!destination || !item.approval.current()) { await this.cancelPending(item); return; }
            if (!path.isAbsolute(destination) || destination.length > 32768 || /[\x00-\x1f]/.test(destination)
                || /^[\\/]{2}[?.][\\/]/.test(destination)) throw new Error('Invalid native destination.');
            item.destination = destination;
            item.phase = 'approving';
            clearInterval(item.watch);
            await this.request('download-decide', { viewId: item.viewId, downloadId: item.id, action: 'approve', destination });
            if (this.transfers.get(item.id) !== item) return;
            item.phase = 'active';
            clearTimeout(item.timer);
            item.approval.dispose();
            if (item.staged) this.publish(item, item.staged.progress, item.staged.final);
        } catch {
            if (this.transfers.get(item.id) === item) {
                item.approval.failure();
                this.fail(item);
                void this.request(item.phase === 'pending' ? 'download-decide' : 'download-action',
                    { viewId: item.viewId, downloadId: item.id, action: 'cancel' })
                    .catch(() => console.error('[coc-desktop] Download failure cancellation failed.'));
            }
        } finally { this.choosers.delete(item.approval.ownerId); }
    }

    private retire(id: string): void {
        const item = this.transfers.get(id);
        if (!item) return;
        this.transfers.delete(id);
        clearTimeout(item.timer); clearInterval(item.watch);
        item.approval.dispose();
    }

    private fail(item: Transfer): void {
        item.lease.update({ ...item.progress, state: 'failed', canPause: false, canResume: false }, true);
    }

    private async cancelPending(item: Transfer): Promise<void> {
        if (this.transfers.get(item.id) !== item || item.phase === 'active') return;
        const op = item.phase === 'pending' ? 'download-decide' : 'download-action';
        item.lease.update(terminal('cancelled'), true);
        try { await this.request(op, { viewId: item.viewId, downloadId: item.id, action: 'cancel' }); }
        catch {
            console.error('[coc-desktop] Download cancellation failed.');
            throw new Error('Native download cancellation failed.');
        }
    }

    private async action(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<void> {
        const item = this.transfers.get(id);
        if (!item) throw new Error('Download no longer exists.');
        if (item.phase !== 'active') {
            if (action !== 'cancel') throw new Error('Download approval is pending.');
            await this.cancelPending(item);
            return;
        }
        try { await this.request('download-action', { viewId: item.viewId, downloadId: id, action }); }
        catch {
            if (this.transfers.get(id) === item) {
                item.approval.failure(); this.fail(item);
                void this.request('download-action', { viewId: item.viewId, downloadId: id, action: 'cancel' })
                    .catch(() => console.error('[coc-desktop] Download action failure cancellation failed.'));
            }
            throw new Error('Native download action failed.');
        }
    }

    progress(message: Record<string, unknown>): void {
        const item = typeof message.downloadId === 'string' ? this.transfers.get(message.downloadId) : undefined;
        if (!item || message.viewId !== item.viewId) return;
        const state = message.state;
        const final = message.final;
        if (typeof state !== 'string' || !['downloading', 'paused', 'completed', 'cancelled', 'interrupted', 'failed'].includes(state)
            || typeof final !== 'boolean' || final === (state === 'downloading' || state === 'paused')
            || !Number.isSafeInteger(message.received) || (message.received as number) < 0
            || !Number.isSafeInteger(message.total) || (message.total as number) < 0
            || typeof message.canPause !== 'boolean' || typeof message.canResume !== 'boolean') {
            item.approval.failure(); this.fail(item);
            void this.request('download-action', { viewId: item.viewId, downloadId: item.id, action: 'cancel' })
                .catch(() => console.error('[coc-desktop] Invalid download cancellation failed.'));
            return;
        }
        const progress: DownloadProgress = {
            state: state as DownloadProgress['state'], received: message.received as number, total: message.total as number,
            canPause: message.canPause, canResume: message.canResume,
        };
        if (item.phase === 'pending') {
            if (final) {
                if (state === 'completed') { item.approval.failure(); this.fail(item); }
                else this.publish(item, progress, true);
            }
            return;
        }
        if (item.phase === 'approving') {
            if (!item.staged?.final) item.staged = { progress, final };
            return;
        }
        this.publish(item, progress, final);
    }

    private publish(item: Transfer, progress: DownloadProgress, final: boolean): void {
        item.progress = progress;
        if (progress.state === 'failed' || progress.state === 'interrupted') item.approval.failure();
        item.lease.update(progress, final, final && progress.state === 'completed' ? item.destination : undefined);
    }

    revokeView(viewId: string): void {
        for (const item of [...this.transfers.values()]) {
            if (item.viewId === viewId && item.phase === 'pending') void this.cancelPending(item).catch(() => {});
        }
    }

    failed(): void {
        for (const item of [...this.transfers.values()]) {
            item.approval.failure();
            item.lease.update({ ...item.progress, state: 'interrupted', canPause: false, canResume: false }, true);
        }
    }

    async cancelAll(): Promise<void> {
        const items = [...this.transfers.values()];
        for (const item of items) item.lease.update({ ...item.progress, state: 'interrupted', canPause: false, canResume: false }, true);
        const results = await Promise.allSettled(items.map(item => this.request(item.phase === 'pending' ? 'download-decide' : 'download-action',
            { viewId: item.viewId, downloadId: item.id, action: 'cancel' })));
        if (results.some(result => result.status === 'rejected')) throw new Error('Native downloads could not be cancelled.');
    }

    async dispose(): Promise<void> {
        this.closed = true;
        await this.cancelAll();
    }
}
