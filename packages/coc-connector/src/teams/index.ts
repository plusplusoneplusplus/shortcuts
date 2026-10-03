/**
 * Teams connector — explicitly routed Graph, MCP and IC3 operations; writes never fail over.
 */

export { TeamsBot, createTransport } from './bot';
export { TrouterClient, trouterAccount } from './trouter';
export type { TeamsTrouterOptions, TrouterWake, TrouterStatus, TrouterNotificationError, TrouterFailure } from './trouter';
export { McpClient } from './mcp/mcp-client';
export { GraphClient } from './graph/graph-client';
export { GraphTransport } from './graph/transport-graph';
export { McpTransport, TeamsMcpSendRejectedError } from './mcp/transport-mcp';
export { Ic3DirectMessageClient, TeamsIc3SendError } from './ic3/ic3-direct-message';
export * from './operations';
export { McpOperations } from './mcp/operations-mcp';
export type { McpOperationsOptions } from './mcp/operations-mcp';
export { Ic3Operations } from './ic3/operations-ic3';
export { isIc3DirectMessageRegion } from './ic3/ic3-direct-message-config';
export type { Ic3OperationsOptions } from './ic3/operations-ic3';
export { GraphOperations } from './graph/operations-graph';
export type { GraphOperationsOptions } from './graph/operations-graph';
export type {
    Ic3DirectMessageOptions,
    Ic3DirectMessageRegion,
    Ic3TokenProvider,
    Ic3ChatVerifier,
} from './ic3/ic3-direct-message-config';
export type { McpChannelRootPage } from './mcp/transport-mcp';
export { extractTenantId, acquireTokenViaAzCli, acquireMcpOAuthToken, acquireTokenWithDeviceCode, acquireTokenViaBrowser, getOAuthConfig, exchangeCodeForToken, saveMcpOAuthTokens } from './auth';
export type { InboundTeamsMessage, TeamsBotOptions, BotStatus, TeamsChannel, McpToolResult, McpToolsListResult, TeamsAuthConfig, TeamsTransportMode, DeviceCodeInfo, TeamsTransport, TransportSendOptions } from './types';
export type { GraphOutboundOptions } from './graph/graph-credential';
