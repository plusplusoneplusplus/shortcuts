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

export interface UpdateStartOptions {
    /**
     * Auto update: no progress, dialogs or owned-server warning. Failures go
     * to stderr and verified bytes stay retained when the app is busy.
     */
    silent?: boolean;
    /** Checked right before install on the silent path; false defers install. */
    isIdle?(): Promise<boolean>;
}

/** One coordinator per desktop process, shared by every window and menu. */
export class UpdateCoordinator {
    private ready?: { release: ReleaseInfo; download: DownloadedUpdate };
    private active?: Promise<void>;
    private activeSilent = false;
    private handedOff = false;
    private installing = false;
    private disposed = false;
    private readonly abort = new AbortController();

    constructor(private readonly options: UpdateCoordinatorOptions) {}

    /** A verified download that can be offered again without a release check. */
    get readyRelease(): ReleaseInfo | undefined { return this.ready?.release; }

    /** Called only after Update, or to offer a retained download again. */
    start(release: ReleaseInfo, startOptions: UpdateStartOptions = {}): Promise<void> {
        if (this.handedOff || this.disposed) return Promise.resolve();
        const silent = startOptions.silent === true;
        if (this.active) {
            // A user request during a background run still gets its dialogs.
            if (this.activeSilent && !silent) {
                return this.active.then(() => this.start(release, startOptions));
            }
            return this.active;
        }
        this.activeSilent = silent;
        this.active = this.run(release, silent, startOptions.isIdle)
            .finally(() => { this.active = undefined; this.activeSilent = false; });
        return this.active;
    }

    private async run(
        release: ReleaseInfo, silent: boolean, isIdle?: () => Promise<boolean>,
    ): Promise<void> {
        const opts = this.options;
        const setProgress = silent ? () => {} : opts.setProgress;
        try {
            if (this.ready && this.ready.release.tag !== release.tag) {
                await this.ready.download.cleanup();
                this.ready = undefined;
            }
            if (!this.ready) {
                setProgress(undefined);
                try {
                    const { signal } = opts.downloadOptions;
                    const download = await (opts.download ?? downloadUpdate)({
                        ...opts.downloadOptions,
                        signal: signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal,
                        release,
                        onProgress: ({ downloadedBytes, totalBytes }) => {
                            setProgress(totalBytes
                                ? Math.min(1, Math.max(0, downloadedBytes / totalBytes))
                                : undefined);
                        },
                    });
                    this.ready = { release, download };
                    // A download that finished as the app quit has no other owner.
                    if (this.disposed) {
                        await this.discardReady();
                        return;
                    }
                } finally {
                    setProgress(null);
                }
            }
            // Keep the original release paired with the bytes already verified.
            const ready = this.ready;
            if (silent) {
                // Activity that started during the download defers to a later poll.
                if ((isIdle && !await isIdle()) || this.disposed) return;
            } else {
                if (!await opts.promptRestart(ready.release) || this.disposed) return;
                if (!await opts.confirmRestart() || this.disposed) return;
            }
            this.installing = true;
            try {
                await opts.install(ready.download, ready.release);
            } finally {
                this.installing = false;
            }
            // Ownership passes to the helper before the normal quit drain starts.
            this.handedOff = true;
            this.ready = undefined;
            // A quit that began during helper launch is already draining.
            if (!this.disposed) opts.quit();
        } catch (error) {
            let reason = error instanceof Error ? error.message : String(error);
            try {
                await this.discardReady();
            } catch (cleanupError) {
                reason += `\nCould not remove update files: ${String(cleanupError)}`;
            }
            if (this.disposed) {
                console.error(`[coc-desktop] Update stopped during quit: ${reason}`);
                return;
            }
            if (silent) {
                console.error(`[coc-desktop] Automatic update failed: ${reason}`);
                return;
            }
            if (await opts.promptError(reason)) {
                await opts.openBrowser(pickDownloadUrl(
                    release, opts.downloadOptions.platform ?? process.platform, opts.downloadOptions.arch,
                ));
            }
        }
    }

    /**
     * Ordinary quit: abort a download and remove verified bytes the user
     * deferred. Bytes already handed to (or being handed to) a helper stay.
     */
    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.abort.abort(new Error('The app is quitting.'));
        if (!this.installing) await this.discardReady();
    }

    private async discardReady(): Promise<void> {
        const ready = this.ready;
        if (!ready || this.handedOff) return;
        this.ready = undefined;
        await ready.download.cleanup();
    }
}
