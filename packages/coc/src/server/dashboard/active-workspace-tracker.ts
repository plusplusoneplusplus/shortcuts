export interface ActiveWorkspaceClientState {
    clientId: string;
    workspaceId: string;
    lastSeenAt: number;
}

export interface ActiveWorkspaceSnapshot {
    activeWorkspaceIds: string[];
    clients: ActiveWorkspaceClientState[];
}

export interface ReportActiveWorkspaceInput {
    clientId: string;
    workspaceId: string | null;
    now?: number;
}

export type ActiveWorkspaceChangeListener = (
    snapshot: ActiveWorkspaceSnapshot,
    previousSnapshot: ActiveWorkspaceSnapshot,
) => void;

export const DEFAULT_ACTIVE_WORKSPACE_TTL_MS = 10 * 60 * 1000;

export class ActiveWorkspaceTracker {
    private readonly clients = new Map<string, ActiveWorkspaceClientState>();
    private readonly listeners = new Set<ActiveWorkspaceChangeListener>();

    constructor(
        private readonly ttlMs = DEFAULT_ACTIVE_WORKSPACE_TTL_MS,
        private readonly now: () => number = () => Date.now(),
    ) {}

    reportActiveWorkspace(input: ReportActiveWorkspaceInput): ActiveWorkspaceSnapshot {
        const clientId = input.clientId.trim();
        const timestamp = input.now ?? this.now();

        if (!clientId) {
            return this.getSnapshot(timestamp);
        }

        const previousSnapshot = this.getSnapshot(timestamp);

        if (input.workspaceId === null) {
            this.clients.delete(clientId);
            const snapshot = this.getSnapshot(timestamp);
            this.emitIfActiveWorkspacesChanged(snapshot, previousSnapshot);
            return snapshot;
        }

        this.clients.set(clientId, {
            clientId,
            workspaceId: input.workspaceId,
            lastSeenAt: timestamp,
        });

        const snapshot = this.getSnapshot(timestamp);
        this.emitIfActiveWorkspacesChanged(snapshot, previousSnapshot);
        return snapshot;
    }

    getSnapshot(now = this.now()): ActiveWorkspaceSnapshot {
        this.prune(now);
        const clients = Array.from(this.clients.values())
            .sort((a, b) => a.clientId.localeCompare(b.clientId));
        const activeWorkspaceIds = Array.from(new Set(clients.map(client => client.workspaceId)))
            .sort((a, b) => a.localeCompare(b));

        return { activeWorkspaceIds, clients };
    }

    clear(): void {
        const previousSnapshot = this.getSnapshot();
        this.clients.clear();
        this.emitIfActiveWorkspacesChanged({ activeWorkspaceIds: [], clients: [] }, previousSnapshot);
    }

    onChange(listener: ActiveWorkspaceChangeListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private prune(now: number): void {
        for (const [clientId, client] of this.clients) {
            if (now - client.lastSeenAt > this.ttlMs) {
                this.clients.delete(clientId);
            }
        }
    }

    private emitIfActiveWorkspacesChanged(
        snapshot: ActiveWorkspaceSnapshot,
        previousSnapshot: ActiveWorkspaceSnapshot,
    ): void {
        if (arraysEqual(snapshot.activeWorkspaceIds, previousSnapshot.activeWorkspaceIds)) {
            return;
        }
        for (const listener of this.listeners) {
            listener(snapshot, previousSnapshot);
        }
    }
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
}
