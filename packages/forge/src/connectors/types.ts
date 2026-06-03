export type RemoteServerKind = 'url' | 'devtunnel' | 'ssh';

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

export interface SshRemoteServer extends BaseRemoteServer {
    kind: 'ssh';
    host: string;
    localPort: number;
}

export type RemoteServer = UrlRemoteServer | DevTunnelRemoteServer | SshRemoteServer;

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
    | { kind: 'devtunnel'; label: string; tunnelId: string }
    | { kind: 'ssh'; label: string; host: string; localPort: number };

export type RemoteServerUpdateInput =
    | { label?: string; kind?: 'url'; url?: string }
    | { label?: string; kind?: 'devtunnel'; tunnelId?: string }
    | { label?: string; kind?: 'ssh'; host?: string; localPort?: number };

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

export interface SshConnectionState {
    serverId: string;
    host: string;
    localPort: number;
    effectiveUrl?: string;
    status: RemoteServerRuntimeStatus;
    lastError?: string;
    startedAt?: number;
    lastChecked?: number;
}

export interface ConnectorReadable {
    on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
}

export interface ManagedChildProcess {
    pid?: number;
    stdout?: ConnectorReadable | null;
    stderr?: ConnectorReadable | null;
    kill(signal?: NodeJS.Signals | number): boolean;
    once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    once(event: 'error', listener: (error: Error) => void): this;
}

export type ProcessStarter = (command: string, args: string[]) => ManagedChildProcess;
export type HealthChecker = (url: string, signal?: AbortSignal) => Promise<boolean>;
