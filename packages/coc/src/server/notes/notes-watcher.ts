import { getNativeWatchService, type NativeWatchServiceLike } from '../shared/native-watch-service';

/** Empty paths mean the entire workspace notes tree requires reloading. */
export type NotesChangedCallback = (workspaceId: string, changedPaths: string[]) => void;

export class NotesWatcher {
    private subscriptions = new Map<string, number>();

    constructor(
        private onNotesChanged: NotesChangedCallback,
        private watchService: NativeWatchServiceLike = getNativeWatchService(),
    ) {}

    watchWorkspace(workspaceId: string, notesDir: string): void {
        if (this.subscriptions.has(workspaceId)) return;
        const id = this.watchService.subscribe({
            workspaceId, root: notesDir, recursive: true, debounceMs: 300,
            ignoreDirs: [], extensions: ['md'], respectGitignore: false,
        }, batch => {
            if (this.subscriptions.get(workspaceId) !== batch.subscriptionId) return;
            if (batch.rescan || batch.paths.length > 0) {
                this.onNotesChanged(workspaceId, batch.rescan ? [] : batch.paths);
            }
        });
        this.subscriptions.set(workspaceId, id);
    }

    unwatchWorkspace(workspaceId: string): void {
        const id = this.subscriptions.get(workspaceId);
        this.subscriptions.delete(workspaceId);
        if (id !== undefined) this.watchService.unsubscribe(id);
    }

    closeAll(): void {
        for (const workspaceId of this.subscriptions.keys()) this.unwatchWorkspace(workspaceId);
    }

    isWatching(workspaceId: string): boolean {
        return this.subscriptions.has(workspaceId);
    }
}
