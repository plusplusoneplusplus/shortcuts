import type { DownloadItem } from 'electron';
import * as path from 'node:path';
import { BrowserDownloadStore, downloadFilename, type DownloadProgress } from './browser-downloads';

/** Keep Chromium's original request and native Save dialog. Never fetch/replay the URL. */
export function manageElectronDownload(store: BrowserDownloadStore, item: DownloadItem, downloadsDirectory: string): boolean {
    let retired = false;
    const dispose = () => {
        retired = true;
        item.removeListener('updated', updated);
        item.removeListener('done', done);
    };
    const sample = (state: string, final: boolean): DownloadProgress => ({
        state: state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : state === 'interrupted' ? 'interrupted'
            : state === 'progressing' ? item.isPaused() ? 'paused' : 'downloading' : 'failed',
        received: item.getReceivedBytes(), total: item.getTotalBytes(),
        canPause: !final && state === 'progressing' && !item.isPaused(),
        // Resume only a live, explicitly paused transfer; never retry an interrupted request.
        canResume: !final && state === 'progressing' && item.isPaused() && item.canResume(),
    });
    const publish = (state: string, final = false) => {
        if (retired) { return; }
        try { admitted!.update(sample(state, final), final, final && state === 'completed' ? item.getSavePath() : undefined); }
        catch {
            admitted!.update({ state: 'failed', received: 0, total: 0, canPause: false, canResume: false }, true);
            try { item.cancel(); } catch { /* native handle may already be destroyed */ }
        }
    };
    const updated = (_event: unknown, state: string) => publish(state);
    const done = (_event: unknown, state: string) => publish(state, true);
    const admitted = store.start(item.getFilename(), item.getURL(), {
        cancel: () => item.cancel(),
        pause: () => { item.pause(); publish(item.getState()); },
        resume: () => { if (!item.isPaused() || !item.canResume()) { throw new Error('Resume unavailable.'); } item.resume(); publish(item.getState()); },
        dispose,
    });
    if (!admitted) { return false; }
    try {
        item.on('updated', updated);
        item.once('done', done);
        // No renderer paths. Native dialog owns selection and overwrite confirmation.
        item.setSaveDialogOptions({ defaultPath: path.join(downloadsDirectory, downloadFilename(item.getFilename())) });
        publish(item.getState());
    } catch {
        admitted.update({ state: 'failed', received: 0, total: 0, canPause: false, canResume: false }, true);
        try { item.cancel(); } catch { /* no replay after an unknown outcome */ }
    }
    return true;
}
