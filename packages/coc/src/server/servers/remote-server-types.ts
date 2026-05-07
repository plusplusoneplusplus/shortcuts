export type RemoteServerKind = 'url' | 'devtunnel';

export type RemoteServerRuntimeStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'failed';

export interface BaseRemoteServer {
    id: string;
    label: string;
    kind: RemoteServerKind;
    addedAt: number;
    updatedAt: number;
}

export interface UrlRemoteServer extends BaseRemoteServer {
    kind: 'url';
    url: string;
}

export interface DevTunnelRemoteServer extends BaseRemoteServer {
    kind: 'devtunnel';
    tunnelId: string;
}

export type RemoteServer = UrlRemoteServer | DevTunnelRemoteServer;

export interface RemoteServerRuntime {
    serverId: string;
    kind: RemoteServerKind;
    effectiveUrl?: string;
    status: RemoteServerRuntimeStatus;
    tunnelId?: string;
    localPort?: number;
    publicUrl?: string;
    lastChecked?: number;
    lastError?: string;
}

export type RemoteServerWithRuntime = RemoteServer & Partial<Omit<RemoteServerRuntime, 'serverId' | 'kind'>>;

export type RemoteServerCreateInput =
    | { kind: 'url'; label: string; url: string }
    | { kind: 'devtunnel'; label: string; tunnelId: string };

export type RemoteServerUpdateInput =
    | { label?: string; kind?: 'url'; url?: string }
    | { label?: string; kind?: 'devtunnel'; tunnelId?: string };

export interface RemoteServerHealth {
    serverId: string;
    status: 'checking' | 'online' | 'offline';
    kind: RemoteServerKind;
    effectiveUrl?: string;
    version?: string;
    commit?: string;
    serverName?: string;
    uptime?: number;
    processCount?: number;
    tunnelId?: string;
    localPort?: number;
    publicUrl?: string;
    lastChecked: number;
    error?: string;
}

export interface DevTunnelConnectionState {
    tunnelId: string;
    port?: number;
    effectiveUrl?: string;
    publicUrl?: string;
    status: RemoteServerRuntimeStatus;
    lastError?: string;
    startedAt?: number;
    lastChecked?: number;
}
