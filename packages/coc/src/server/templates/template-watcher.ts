import * as path from 'path';
import { getNativeWatchService, type NativeWatchServiceLike } from '../shared/native-watch-service';
import { affectsWatchedDirectory } from '../shared/watch-paths';

export type TemplatesChangedCallback = (workspaceId: string) => void;

export class TemplateWatcher {
    private subscriptions = new Map<string, number>();

    constructor(
        private onTemplatesChanged: TemplatesChangedCallback,
        private watchService: NativeWatchServiceLike = getNativeWatchService(),
    ) {}

    watchWorkspace(workspaceId: string, rootPath: string): void {
        if (this.subscriptions.has(workspaceId)) return;
        const id = this.watchService.subscribe({
            workspaceId, root: path.join(rootPath, '.vscode'), recursive: true, debounceMs: 300,
            ignoreDirs: [], extensions: [], respectGitignore: false,
        }, batch => {
            if (this.subscriptions.get(workspaceId) !== batch.subscriptionId) return;
            if (batch.rescan || batch.paths.some(file => affectsWatchedDirectory(file, 'templates'))) {
                this.onTemplatesChanged(workspaceId);
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
