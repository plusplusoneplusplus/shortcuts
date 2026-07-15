/**
 * Teams connector — Microsoft Teams via Graph API (primary) or MCP server (fallback).
 */

export { TeamsBot, createTransport } from './bot';
export { McpClient } from './mcp-client';
export { GraphClient } from './graph-client';
export { GraphTransport } from './transport-graph';
export { McpTransport } from './transport-mcp';
export { extractTenantId, acquireTokenViaAzCli, acquireMcpOAuthToken, acquireTokenWithDeviceCode, acquireTokenViaBrowser, getOAuthConfig, exchangeCodeForToken } from './auth';
export type { InboundTeamsMessage, TeamsBotOptions, BotStatus, TeamsChannel, McpToolResult, McpToolsListResult, TeamsAuthConfig, TeamsTransportMode, DeviceCodeInfo, TeamsTransport, TransportSendOptions } from './types';
