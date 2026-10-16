/** Electron-free lifecycle for a user-requested download and restart. */
import { pickDownloadUrl, type ReleaseInfo } from './update-check';
import {
    downloadUpdate, type DownloadedUpdate, type DownloadUpdateOptions,
} from './update-install';

export interface UpdateCoordinatorOptions {
    downloadOptions: Omit<DownloadUpdateOptions, 'release' | 'onProgress'>;
    download?: typeof downloadUpdate;
    /** null clears progress; undefined shows an indeterminate download. */
    setProgress(fraction: number | null | undefined): void;
    promptRestart(release: ReleaseInfo): Promise<boolean>;
    /** Check owned-server work before preparing or launching an installer. */
    confirmRestart(): Promise<boolean>;
    /** Resolves only after the detached helper starts; rejects after staging cleanup. */
    install(download: DownloadedUpdate, release: ReleaseInfo): Promise<void>;
    quit(): void;
    /** Returns true for Download in browser, false for Later. */
    promptError(reason: string): Promise<boolean>;
    openBrowser(url: string): Promise<void>;
}

/** One coordinator per desktop process, shared by every window and menu. */
export class UpdateCoordinator {
    private ready?: { release: ReleaseInfo; download: DownloadedUpdate };
    private active?: Promise<void>;
    private handedOff = false;

    constructor(private readonly options: UpdateCoordinatorOptions) {}

    /** Called only after Update, or to offer a retained download again. */
    start(release: ReleaseInfo): Promise<void> {
        if (this.handedOff) return Promise.resolve();
        if (this.active) return this.active;
        this.active = this.run(release).finally(() => { this.active = undefined; });
        return this.active;
    }

    private async run(release: ReleaseInfo): Promise<void> {
        const opts = this.options;
        try {
            if (this.ready && this.ready.release.tag !== release.tag) {
                await this.ready.download.cleanup();
                this.ready = undefined;
            }
            if (!this.ready) {
                opts.setProgress(undefined);
                try {
                    const download = await (opts.download ?? downloadUpdate)({
                        ...opts.downloadOptions,
                        release,
                        onProgress: ({ downloadedBytes, totalBytes }) => {
                            opts.setProgress(totalBytes
                                ? Math.min(1, Math.max(0, downloadedBytes / totalBytes))
                                : undefined);
                        },
                    });
                    this.ready = { release, download };
                } finally {
                    opts.setProgress(null);
                }
            }
            // Keep the original release paired with the bytes already verified.
            const ready = this.ready;
            if (!await opts.promptRestart(ready.release)) return;
            if (!await opts.confirmRestart()) return;
            await opts.install(ready.download, ready.release);
            // Ownership passes to the helper before the normal quit drain starts.
            this.handedOff = true;
            this.ready = undefined;
            opts.quit();
        } catch (error) {
            let reason = error instanceof Error ? error.message : String(error);
            if (this.ready && !this.handedOff) {
                try {
                    await this.ready.download.cleanup();
                    this.ready = undefined;
                } catch (cleanupError) {
                    reason += `\nCould not remove update files: ${String(cleanupError)}`;
                }
            }
            if (await opts.promptError(reason)) {
                await opts.openBrowser(pickDownloadUrl(release, opts.downloadOptions.platform ?? process.platform));
            }
        }
    }
}
