export type RemoteServerKind = 'url' | 'devtunnel' | 'ssh';
export type RemoteServerRuntimeStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'failed';

export interface BaseRemoteServer {
  id: string;
  label: string;
  kind: RemoteServerKind;
  addedAt: number;
  updatedAt: number;
  effectiveUrl?: string;
  status?: RemoteServerRuntimeStatus;
  localPort?: number;
  publicUrl?: string;
  lastChecked?: number;
  lastError?: string;
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
  host: string;       // SSH config alias, e.g. "ubuntu-arm"
  localPort: number;  // forwarded local port, e.g. 4000
}

export type RemoteServer = UrlRemoteServer | DevTunnelRemoteServer | SshRemoteServer;

export type RemoteServerInput =
  | { kind: 'url'; label: string; url: string }
  | { kind: 'devtunnel'; label: string; tunnelId: string }
  | { kind: 'ssh'; label: string; host: string; localPort: number };

export type RemoteServerPatch =
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
