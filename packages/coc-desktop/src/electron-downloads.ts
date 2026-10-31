import type { DownloadItem } from 'electron';
import * as path from 'node:path';
import { BrowserDownloadStore, downloadFilename, type DownloadProgress } from './browser-downloads';

/** Main-only native dialog handoff. Never accept a destination from renderer IPC. */
export interface ElectronDownloadApproval {
    readonly signal: AbortSignal;
    /** Must show native Save As, with overwrite confirmation, on the captured owner. */
    chooseDestination(defaultPath: string): string | undefined;
    approve(): boolean;
    cancel(): void;
    /** Payload-free failure notice for the captured source owner. Cancellation stays quiet. */
    onFailure?(): void;
}

/** Keep Chromium's original request and native Save dialog. Never fetch/replay the URL. */
export function manageElectronDownload(store: BrowserDownloadStore, item: DownloadItem, downloadsDirectory: string, approval?: ElectronDownloadApproval): boolean {
    let retired = false;
    let approved = !approval;
    let failureReported = false;
    const reportFailure = () => {
        if (failureReported) return;
        failureReported = true;
        try { approval?.onFailure?.(); } catch { /* feedback must not affect the native transfer */ }
    };
    const dispose = () => {
        retired = true;
        item.removeListener('updated', updated);
        item.removeListener('done', done);
        approval?.signal.removeEventListener('abort', revoked);
        approval?.cancel();
    };
    const sample = (state: string, final: boolean): DownloadProgress => ({
        state: state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : state === 'interrupted' ? 'interrupted'
            : state === 'progressing' ? item.isPaused() ? 'paused' : 'downloading' : 'failed',
        received: item.getReceivedBytes(), total: item.getTotalBytes(),
        canPause: approved && !final && state === 'progressing' && !item.isPaused(),
        // Resume only a live, explicitly paused transfer; never retry an interrupted request.
        canResume: approved && !final && state === 'progressing' && item.isPaused() && item.canResume(),
    });
    const publish = (state: string, final = false) => {
        if (retired) { return; }
        try {
            const progress = sample(state, final);
            // Terminal store updates synchronously dispose the lease, so notify first.
            if (progress.state === 'failed' || progress.state === 'interrupted') reportFailure();
            admitted!.update(progress, final, final && state === 'completed' ? item.getSavePath() : undefined);
        }
        catch {
            reportFailure();
            admitted!.update({ state: 'failed', received: 0, total: 0, canPause: false, canResume: false }, true);
            try { item.cancel(); } catch { /* native handle may already be destroyed */ }
        }
    };
    const updated = (_event: unknown, state: string) => publish(state);
    const done = (_event: unknown, state: string) => publish(!approved && state === 'completed' ? 'failed' : state, true);
    const revoked = () => {
        if (retired || approved) return;
        admitted!.update({ state: 'cancelled', received: 0, total: 0, canPause: false, canResume: false }, true);
        try { item.cancel(); } catch { /* native handle may already be destroyed */ }
    };
    const admitted = store.start(item.getFilename(), item.getURL(), {
        cancel: () => item.cancel(),
        pause: () => { if (!approved) throw new Error('Pause unavailable.'); item.pause(); publish(item.getState()); },
        resume: () => { if (!approved || !item.isPaused() || !item.canResume()) { throw new Error('Resume unavailable.'); } item.resume(); publish(item.getState()); },
        dispose,
    });
    if (!admitted) { approval?.cancel(); return false; }
    try {
        item.on('updated', updated);
        item.once('done', done);
        const defaultPath = path.join(downloadsDirectory, downloadFilename(item.getFilename()));
        if (approval) {
            approval.signal.addEventListener('abort', revoked, { once: true });
            if (approval.signal.aborted) { revoked(); return true; }
            // setSavePath is only valid inside will-download: the native chooser
            // must return synchronously. Never defer this or replay the request.
            const destination = approval.chooseDestination(defaultPath);
            if (retired) return true;
            if (!destination || approval.signal.aborted) { revoked(); return true; }
            if (!path.isAbsolute(destination) || destination.includes('\0')) throw new Error('Invalid native destination.');
            if (!approval.approve()) { revoked(); return true; }
            approved = true;
            approval.signal.removeEventListener('abort', revoked);
            item.setSavePath(destination);
        } else {
            // No renderer paths. Native dialog owns selection and overwrite confirmation.
            item.setSaveDialogOptions({ defaultPath });
        }
        publish(item.getState());
    } catch {
        reportFailure();
        admitted.update({ state: 'failed', received: 0, total: 0, canPause: false, canResume: false }, true);
        try { item.cancel(); } catch { /* no replay after an unknown outcome */ }
    }
    return true;
}
