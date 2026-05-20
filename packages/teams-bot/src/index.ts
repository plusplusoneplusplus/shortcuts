/**
 * @plusplusoneplusplus/teams-bot
 *
 * Standalone MS Teams bot package — supports Graph API (primary) and MCP server (fallback).
 */

export { TeamsBot } from './bot';
export { McpClient } from './mcp-client';
export { GraphClient } from './graph-client';
export { acquireTokenWithDeviceCode, extractTenantId, acquireTokenViaAzCli } from './auth';
export type { InboundTeamsMessage, TeamsBotOptions, BotStatus, TeamsChannel, McpToolResult, McpToolsListResult, TeamsAuthConfig, DeviceCodeInfo, TeamsTransportMode } from './types';
