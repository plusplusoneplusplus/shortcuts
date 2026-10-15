/** Read-only dashboard topology; connection aliases and endpoint URLs stay in the dashboard. */
export interface DashboardVisibleWorkspace {
  serverIdentity?: string;
  serverLabel: string;
  serverKind: 'local' | 'url' | 'ssh' | 'devtunnel';
  workspaceId: string;
  workspaceLabel: string;
  type: 'repo' | 'group';
  online: boolean;
}

export interface DashboardWorkspaceRequest {
  id: string;
  /** Raw workspace on the socket's owning server, never a dashboard clone key. */
  workspaceId: string;
  /** Changes whenever the dashboard's owner or visible topology changes. */
  revision: string;
}

export type DashboardWorkspaceReply =
  | { id: string; ok: true; workspaces: DashboardVisibleWorkspace[] }
  | { id: string; ok: false };

export type DashboardDiscoveryServerEvent =
  | { type: 'dashboard-workspaces-request'; request: DashboardWorkspaceRequest }
  | { type: 'dashboard-discovery-cancel'; id: string };

export type DashboardDiscoveryClientEvent =
  | { type: 'dashboard-discovery-capability'; workspaceId: string; revision: string; focused: boolean }
  | { type: 'dashboard-discovery-clear' }
  | { type: 'dashboard-workspaces-result'; reply: DashboardWorkspaceReply };
