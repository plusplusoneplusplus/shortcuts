/**
 * Shared types for the CoCContainer SPA client.
 */

export interface Agent {
    id: string;
    name: string;
    address: string;
    status: 'online' | 'offline' | 'unknown';
    lastSeenAt: string | null;
    createdAt: string;
}

export interface RemoteWorkspace {
    id: string;
    rootPath: string;
    name?: string;
    agentId?: string;
    agentName?: string;
    agentAddress?: string;
    color?: string;
    gitInfo?: {
        branch?: string;
    };
}

export interface RemoteProcess {
    id: string;
    title?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
}

export interface SSEEnvelope {
    agentId: string;
    agentName: string;
    payload: string;
}
