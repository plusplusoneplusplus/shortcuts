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

export const DEFAULT_ACTIVE_WORKSPACE_TTL_MS = 10 * 60 * 1000;

export class ActiveWorkspaceTracker {
    private readonly clients = new Map<string, ActiveWorkspaceClientState>();

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

        if (input.workspaceId === null) {
            this.clients.delete(clientId);
            return this.getSnapshot(timestamp);
        }

        this.clients.set(clientId, {
            clientId,
            workspaceId: input.workspaceId,
            lastSeenAt: timestamp,
        });

        return this.getSnapshot(timestamp);
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
        this.clients.clear();
    }

    private prune(now: number): void {
        for (const [clientId, client] of this.clients) {
            if (now - client.lastSeenAt > this.ttlMs) {
                this.clients.delete(clientId);
            }
        }
    }
}

