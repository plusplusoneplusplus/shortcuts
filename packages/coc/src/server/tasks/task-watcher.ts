import { getNativeWatchService, type NativeWatchServiceLike } from '../shared/native-watch-service';

export type TasksChangedCallback = (workspaceId: string) => void;

export class TaskWatcher {
    private subscriptions = new Map<string, number>();

    constructor(
        private onTasksChanged: TasksChangedCallback,
        private watchService: NativeWatchServiceLike = getNativeWatchService(),
    ) {}

    watchWorkspace(workspaceId: string, tasksDir: string): void {
        if (this.subscriptions.has(workspaceId)) return;
        const id = this.watchService.subscribe({
            workspaceId, root: tasksDir, recursive: true, debounceMs: 300,
            ignoreDirs: [], extensions: [], respectGitignore: false,
        }, batch => {
            if (this.subscriptions.get(workspaceId) !== batch.subscriptionId) return;
            if (batch.rescan || batch.paths.length > 0) this.onTasksChanged(workspaceId);
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
