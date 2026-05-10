/**
 * RepoScheduleWatcher
 *
 * Owns the per-repo `fs.FSWatcher` instances and the debounce timers
 * coalescing rapid file events into a single reload callback.
 *
 * The watcher itself does not load schedules; the supplied `onChange`
 * callback is invoked after the debounce window elapses.
 */

import * as fs from 'fs';
import { getServerLogger } from '../logging/server-logger';

const DEBOUNCE_MS = 300;

export class RepoScheduleWatcher {
    private readonly watchers = new Map<string, fs.FSWatcher>();
    private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private disposed = false;

    /**
     * Begin watching `scheduleDir` for changes.  The directory must exist;
     * non-existent or unreadable directories are a no-op.  Re-registering
     * an existing repoId closes the previous watcher first.
     */
    async watch(repoId: string, scheduleDir: string, onChange: () => void | Promise<void>): Promise<void> {
        if (this.disposed) return;

        try {
            await fs.promises.access(scheduleDir);
        } catch {
            return;
        }

        this.unwatch(repoId);

        try {
            const watcher = fs.watch(scheduleDir, () => this.scheduleReload(repoId, onChange));
            this.watchers.set(repoId, watcher);
        } catch (err) {
            getServerLogger().debug({ err, repoId, scheduleDir }, 'RepoScheduleWatcher: fs.watch unsupported');
        }
    }

    /** Stop watching `repoId` and clear any pending debounce. */
    unwatch(repoId: string): void {
        const existing = this.watchers.get(repoId);
        if (existing) {
            try { existing.close(); } catch { /* non-fatal */ }
            this.watchers.delete(repoId);
        }
        const timer = this.debounceTimers.get(repoId);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(repoId);
        }
    }

    /** Close all watchers and pending debounce timers. */
    dispose(): void {
        this.disposed = true;
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        for (const watcher of this.watchers.values()) {
            try { watcher.close(); } catch { /* non-fatal */ }
        }
        this.watchers.clear();
    }

    private scheduleReload(repoId: string, onChange: () => void | Promise<void>): void {
        const prev = this.debounceTimers.get(repoId);
        if (prev) clearTimeout(prev);
        const timer = setTimeout(() => {
            this.debounceTimers.delete(repoId);
            try {
                const result = onChange();
                if (result && typeof (result as Promise<void>).catch === 'function') {
                    (result as Promise<void>).catch(err => {
                        getServerLogger().warn({ err, repoId }, 'RepoScheduleWatcher: onChange callback rejected');
                    });
                }
            } catch (err) {
                getServerLogger().warn({ err, repoId }, 'RepoScheduleWatcher: onChange callback threw');
            }
        }, DEBOUNCE_MS);
        this.debounceTimers.set(repoId, timer);
    }
}
