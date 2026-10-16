import type {
    NativeWatchServiceLike, WatchBatch, WatchSubscriptionOptions,
} from '../../src/server/shared/native-watch-service';

export class FakeNativeWatchService implements NativeWatchServiceLike {
    readonly subscriptions = new Map<number, {
        options: WatchSubscriptionOptions;
        onBatch: (batch: WatchBatch) => void;
    }>();
    private nextId = 1;
    private disposed = false;

    subscribe(options: WatchSubscriptionOptions, onBatch: (batch: WatchBatch) => void): number {
        if (this.disposed) throw new Error('Native watch service is disposed');
        const id = this.nextId++;
        this.subscriptions.set(id, { options, onBatch });
        return id;
    }

    emit(subscriptionId: number, paths: string[] = [], rescan = false): void {
        this.subscriptions.get(subscriptionId)?.onBatch({ subscriptionId, paths, rescan });
    }

    unsubscribe(subscriptionId: number): void {
        this.subscriptions.delete(subscriptionId);
    }

    unwatchWorkspace(workspaceId: string): void {
        for (const [id, subscription] of this.subscriptions) {
            if (subscription.options.workspaceId === workspaceId) this.subscriptions.delete(id);
        }
    }

    dispose(): void {
        this.disposed = true;
        this.subscriptions.clear();
    }
}
