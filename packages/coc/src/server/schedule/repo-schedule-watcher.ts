import { getServerLogger } from '../logging/server-logger';
import { getNativeWatchService, type NativeWatchServiceLike } from '../shared/native-watch-service';

export class RepoScheduleWatcher {
    private subscriptions = new Map<string, number>();
    private disposed = false;

    constructor(private watchService: NativeWatchServiceLike = getNativeWatchService()) {}

    async watch(repoId: string, scheduleDir: string, onChange: () => void | Promise<void>): Promise<void> {
        if (this.disposed) throw new Error('Repo schedule watcher is disposed');
        this.unwatch(repoId);
        const id = this.watchService.subscribe({
            workspaceId: repoId, root: scheduleDir, recursive: false, debounceMs: 300,
            ignoreDirs: [], extensions: [], respectGitignore: false,
        }, batch => {
            if (this.subscriptions.get(repoId) !== batch.subscriptionId) return;
            if (!batch.rescan && batch.paths.length === 0) return;
            try {
                Promise.resolve(onChange()).catch(err => {
                    getServerLogger().warn({ err, repoId }, 'RepoScheduleWatcher: onChange callback rejected');
                });
            } catch (err) {
                getServerLogger().warn({ err, repoId }, 'RepoScheduleWatcher: onChange callback threw');
            }
        });
        this.subscriptions.set(repoId, id);
    }

    unwatch(repoId: string): void {
        const id = this.subscriptions.get(repoId);
        this.subscriptions.delete(repoId);
        if (id !== undefined) this.watchService.unsubscribe(id);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const repoId of this.subscriptions.keys()) this.unwatch(repoId);
    }
}
