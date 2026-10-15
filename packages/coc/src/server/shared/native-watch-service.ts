import {
    loadNativeWatch,
    type NativeWatchBatch,
    type NativeWatchHandle,
    type NativeWatchSubscriptionOptions,
} from '@plusplusoneplusplus/coc-native';
import { getServerLogger } from '../logging/server-logger';

export type WatchBatch = NativeWatchBatch;
export type WatchSubscriptionOptions = NativeWatchSubscriptionOptions;

export interface NativeWatchServiceLike {
    subscribe(options: WatchSubscriptionOptions, onBatch: (batch: WatchBatch) => void): number;
    unsubscribe(subscriptionId: number): void;
    unwatchWorkspace(workspaceId: string): void;
    dispose(): void;
}

interface Subscription {
    workspaceId: string;
    onBatch: (batch: WatchBatch) => void;
}

/** One native owner shared by every server consumer, independent of workspace. */
export class NativeWatchService implements NativeWatchServiceLike {
    private handle?: NativeWatchHandle;
    private subscriptions = new Map<number, Subscription>();
    private disposed = false;
    private generation = 0;

    constructor(private readonly createHandle = (onBatch: (batch: WatchBatch) => void): NativeWatchHandle =>
        new (loadNativeWatch().NativeWatchService)(onBatch)) {}

    subscribe(options: WatchSubscriptionOptions, onBatch: (batch: WatchBatch) => void): number {
        if (this.disposed) throw new Error('Native watch service is disposed');
        if (!this.handle) {
            const generation = this.generation;
            this.handle = this.createHandle(batch => {
                if (generation === this.generation) this.deliver(batch);
            });
        }
        const id = this.handle.subscribe(options);
        this.subscriptions.set(id, { workspaceId: options.workspaceId, onBatch });
        return id;
    }

    unsubscribe(subscriptionId: number): void {
        this.subscriptions.delete(subscriptionId);
        this.handle?.unsubscribe(subscriptionId);
    }

    unwatchWorkspace(workspaceId: string): void {
        for (const [id, subscription] of this.subscriptions) {
            if (subscription.workspaceId === workspaceId) this.subscriptions.delete(id);
        }
        this.handle?.unwatchWorkspace(workspaceId);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.subscriptions.clear();
        this.closeHandle();
    }

    releaseIfIdle(): void {
        if (this.subscriptions.size === 0) this.closeHandle();
    }

    private closeHandle(): void {
        const handle = this.handle;
        this.handle = undefined;
        this.generation++;
        handle?.dispose();
    }

    private deliver(batch: WatchBatch): void {
        if (this.disposed) return;
        const subscription = this.subscriptions.get(batch.subscriptionId);
        if (!subscription) return;
        try {
            subscription.onBatch(batch);
        } catch (err) {
            getServerLogger().error({
                err, workspaceId: subscription.workspaceId, subscriptionId: batch.subscriptionId,
            }, 'Native watch consumer failed');
        }
    }
}

let sharedService: NativeWatchService | undefined;
const scopes = new WeakMap<NativeWatchService, number>();

/** Isolates server lifetimes while preserving one process-wide native owner. */
class NativeWatchScope implements NativeWatchServiceLike {
    private subscriptions = new Map<number, string>();
    private disposed = false;

    constructor(private shared: NativeWatchService, private release: () => void) {}

    subscribe(options: WatchSubscriptionOptions, onBatch: (batch: WatchBatch) => void): number {
        if (this.disposed) throw new Error('Native watch scope is disposed');
        const id = this.shared.subscribe(options, batch => {
            if (!this.disposed && this.subscriptions.has(batch.subscriptionId)) onBatch(batch);
        });
        this.subscriptions.set(id, options.workspaceId);
        return id;
    }

    unsubscribe(id: number): void {
        if (!this.subscriptions.delete(id)) return;
        this.shared.unsubscribe(id);
    }

    unwatchWorkspace(workspaceId: string): void {
        for (const [id, workspace] of this.subscriptions) {
            if (workspace === workspaceId) this.unsubscribe(id);
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const id of this.subscriptions.keys()) this.unsubscribe(id);
        this.release();
    }
}

export function getNativeWatchService(): NativeWatchService {
    return sharedService ??= new NativeWatchService();
}

export function acquireNativeWatchService(shared = getNativeWatchService()): NativeWatchServiceLike {
    scopes.set(shared, (scopes.get(shared) ?? 0) + 1);
    return new NativeWatchScope(shared, () => {
        const remaining = (scopes.get(shared) ?? 1) - 1;
        if (remaining > 0) {
            scopes.set(shared, remaining);
        } else {
            scopes.delete(shared);
            shared.releaseIfIdle();
        }
    });
}

export function disposeNativeWatchService(): void {
    sharedService?.dispose();
    sharedService = undefined;
}
