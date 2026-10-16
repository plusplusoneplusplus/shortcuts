/** Stable read-only selector, never a connection alias or a chat dispatch target. */
export interface DashboardWorkspaceTarget {
  serverIdentity: string;
  workspaceId: string;
}

export interface DashboardDiscoveryRuntime {
  listWorkspaces(workspaceId: string, signal?: AbortSignal): Promise<DashboardVisibleWorkspace[]>;
  searchChats(workspaceId: string, query: DashboardChatQuery, signal?: AbortSignal): Promise<DashboardChatSearchResult>;
}

export interface DashboardChatQuery {
  target: DashboardWorkspaceTarget;
  /** Literal, case-insensitive displayed-title substring; never a transcript query. */
  title: string;
  limit: number;
  offset: number;
}

export interface DashboardChatSearchResult {
  target: DashboardWorkspaceTarget;
  serverLabel: string;
  workspaceLabel: string;
  serverKind: DashboardVisibleWorkspace['serverKind'];
  verification: 'verified' | 'unverified';
  /** Count before pagination, used to detect ambiguity beyond the current page. */
  total: number;
  conversations: { processId: string; title: string }[];
}

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

export interface DashboardChatRequest extends DashboardWorkspaceRequest {
  query: DashboardChatQuery;
}

export type DashboardChatReply =
  | { id: string; ok: true; result: DashboardChatSearchResult }
  | { id: string; ok: false };

export type DashboardDiscoveryServerEvent =
  | { type: 'dashboard-workspaces-request'; request: DashboardWorkspaceRequest }
  | { type: 'dashboard-chats-request'; request: DashboardChatRequest }
  | { type: 'dashboard-discovery-cancel'; id: string };

export type DashboardDiscoveryClientEvent =
  | { type: 'dashboard-discovery-capability'; workspaceId: string; revision: string; focused: boolean }
  | { type: 'dashboard-discovery-clear' }
  | { type: 'dashboard-workspaces-result'; reply: DashboardWorkspaceReply }
  | { type: 'dashboard-chats-result'; reply: DashboardChatReply };
