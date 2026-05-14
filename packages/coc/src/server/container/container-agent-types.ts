/**
 * Container Agent types — shared by store, routes, and proxy.
 */

export interface ContainerAgent {
    id: string;
    name: string;
    address: string;
    /** DevTunnel ID for token-based auth. Present when address is a devtunnel URL. */
    tunnelId?: string;
    addedAt: number;
    updatedAt: number;
}

export interface ContainerAgentCreateInput {
    address: string;
    name?: string;
    tunnelId?: string;
}

export interface ContainerAgentUpdateInput {
    name?: string;
    address?: string;
    tunnelId?: string | null;
}

export type ContainerAgentStatus = 'online' | 'offline' | 'unknown';

export interface ContainerAgentWithStatus extends ContainerAgent {
    status: ContainerAgentStatus;
    lastHealthCheck?: number;
}

/** Returns true if the given URL looks like a devtunnel public URL. */
export function isDevTunnelUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.hostname.endsWith('.devtunnels.ms');
    } catch {
        return false;
    }
}
