/**
 * CoCContainer Configuration
 *
 * Resolves configuration from ~/.coccontainer/config.yaml with CLI overrides.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';

export interface WhatsAppConfig {
    /** Enable WhatsApp bridge (default: false) */
    enabled?: boolean;
    /** Directory for Baileys auth state (default: ~/.coccontainer/whatsapp-session) */
    sessionDir?: string;
    /** WA group JID for broadcast (optional) */
    groupJid?: string;
    /** Display name for container in WA messages (default: "CoC") */
    userName?: string;
    /** Agent ID to host global sessions (falls back to first online agent) */
    defaultAgentId?: string;
}

export interface TeamsConfig {
    /** Enable Teams bridge (default: false) */
    enabled?: boolean;
    /** Transport mode: 'graph' (default, uses Graph API with az tokens) or 'mcp' (Teams MCP server). */
    mode?: 'graph' | 'mcp';
    /** Message target: 'chat' sends DM to self, 'channel' posts to configured channel. Default: 'chat'. */
    target?: 'channel' | 'chat';
    /** Team display name — resolved to ID on startup, created if missing. */
    teamName?: string;
    /** Channel display name — resolved to ID on startup, created if missing. */
    channelName?: string;
    /** Team ID (GUID) — auto-resolved from teamName if not set. */
    teamId?: string;
    /** MCP server URL for the Teams server — required for mcp mode. */
    mcpServerUrl?: string;
    /** Teams channel ID for broadcast — auto-resolved from channelName if not set. */
    channelId?: string;
    /** Display name for bot in Teams messages (default: "CoC") */
    botName?: string;
    /** Polling interval in ms for checking new messages (default: 3000) */
    pollIntervalMs?: number;
    /** Agent ID to host global sessions (falls back to first online agent) */
    defaultAgentId?: string;
    /** Azure AD client ID for device code flow (optional, uses Azure CLI public client by default) */
    clientId?: string;
    /** OAuth2 scope for the Teams MCP resource (optional) */
    scope?: string;
}

export interface ContainerConfig {
    serve?: {
        port?: number;
        host?: string;
        dataDir?: string;
    };
    /** Health check interval in milliseconds */
    healthCheckIntervalMs?: number;
    /** Base port for local tunnel bridge proxies (default: 10400) */
    tunnelBridgeBasePort?: number;
    /** Messaging integrations */
    messaging?: {
        whatsapp?: WhatsAppConfig;
        teams?: TeamsConfig;
    };
}

export interface ResolvedWhatsAppConfig {
    enabled: boolean;
    sessionDir: string;
    groupJid?: string;
    userName: string;
    defaultAgentId?: string;
}

export interface ResolvedTeamsConfig {
    enabled: boolean;
    mode: 'graph' | 'mcp';
    /** Message target: 'chat' sends DM to self, 'channel' posts to configured channel. */
    target: 'channel' | 'chat';
    teamName?: string;
    channelName?: string;
    teamId?: string;
    mcpServerUrl: string;
    channelId?: string;
    botName: string;
    pollIntervalMs: number;
    defaultAgentId?: string;
    clientId?: string;
    scope?: string;
}

export interface ResolvedContainerConfig {
    serve: {
        port: number;
        host: string;
        dataDir: string;
    };
    healthCheckIntervalMs: number;
    tunnelBridgeBasePort: number;
    messaging: {
        whatsapp: ResolvedWhatsAppConfig;
        teams: ResolvedTeamsConfig;
    };
}

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.coccontainer');

const DEFAULTS: ResolvedContainerConfig = {
    serve: {
        port: 5000,
        host: 'localhost',
        dataDir: DEFAULT_DATA_DIR,
    },
    healthCheckIntervalMs: 30_000,
    tunnelBridgeBasePort: 10400,
    messaging: {
        whatsapp: {
            enabled: true,
            sessionDir: path.join(DEFAULT_DATA_DIR, 'whatsapp-session'),
            userName: 'CoC',
        },
        teams: {
            enabled: true,
            // Graph mode disabled: az CLI tokens lack ChatMessage.Send/Chat.ReadWrite scopes.
            // MCP mode uses SendMessageToSelf which works with first-party app tokens.
            mode: 'mcp',
            target: 'chat',
            teamName: 'Coc',
            channelName: 'Coc-General',
            mcpServerUrl: 'https://agent365.svc.cloud.microsoft/agents/tenants/72f988bf-86f1-41af-91ab-2d7cd011db47/servers/mcp_TeamsServer',
            botName: 'CoC',
            pollIntervalMs: 3000,
        },
    },
};

export function getDefaultDataDir(): string {
    return DEFAULT_DATA_DIR;
}

/**
 * Resolve configuration by merging file config with defaults.
 */
export function resolveConfig(overrides?: Partial<ContainerConfig>): ResolvedContainerConfig {
    const fileConfig = loadConfigFile();
    const waFile = fileConfig.messaging?.whatsapp;
    const waOver = overrides?.messaging?.whatsapp;
    const teamsFile = fileConfig.messaging?.teams;
    const teamsOver = overrides?.messaging?.teams;
    return {
        serve: {
            port: overrides?.serve?.port ?? fileConfig.serve?.port ?? DEFAULTS.serve.port,
            host: overrides?.serve?.host ?? fileConfig.serve?.host ?? DEFAULTS.serve.host,
            dataDir: overrides?.serve?.dataDir ?? fileConfig.serve?.dataDir ?? DEFAULTS.serve.dataDir,
        },
        healthCheckIntervalMs: overrides?.healthCheckIntervalMs ?? fileConfig.healthCheckIntervalMs ?? DEFAULTS.healthCheckIntervalMs,
        tunnelBridgeBasePort: overrides?.tunnelBridgeBasePort ?? fileConfig.tunnelBridgeBasePort ?? DEFAULTS.tunnelBridgeBasePort,
        messaging: {
            whatsapp: {
                enabled: waOver?.enabled ?? waFile?.enabled ?? DEFAULTS.messaging.whatsapp.enabled,
                sessionDir: waOver?.sessionDir ?? waFile?.sessionDir ?? DEFAULTS.messaging.whatsapp.sessionDir,
                groupJid: waOver?.groupJid ?? waFile?.groupJid ?? DEFAULTS.messaging.whatsapp.groupJid,
                userName: waOver?.userName ?? waFile?.userName ?? DEFAULTS.messaging.whatsapp.userName,
                defaultAgentId: waOver?.defaultAgentId ?? waFile?.defaultAgentId ?? DEFAULTS.messaging.whatsapp.defaultAgentId,
            },
            teams: {
                enabled: teamsOver?.enabled ?? teamsFile?.enabled ?? DEFAULTS.messaging.teams.enabled,
                mode: teamsOver?.mode ?? teamsFile?.mode ?? DEFAULTS.messaging.teams.mode,
                target: (teamsOver as any)?.target ?? (teamsFile as any)?.target ?? DEFAULTS.messaging.teams.target,
                teamName: teamsOver?.teamName ?? teamsFile?.teamName ?? DEFAULTS.messaging.teams.teamName,
                channelName: teamsOver?.channelName ?? teamsFile?.channelName ?? DEFAULTS.messaging.teams.channelName,
                teamId: teamsOver?.teamId ?? teamsFile?.teamId ?? DEFAULTS.messaging.teams.teamId,
                mcpServerUrl: teamsOver?.mcpServerUrl ?? teamsFile?.mcpServerUrl ?? DEFAULTS.messaging.teams.mcpServerUrl,
                channelId: teamsOver?.channelId ?? teamsFile?.channelId ?? DEFAULTS.messaging.teams.channelId,
                botName: teamsOver?.botName ?? teamsFile?.botName ?? DEFAULTS.messaging.teams.botName,
                pollIntervalMs: teamsOver?.pollIntervalMs ?? teamsFile?.pollIntervalMs ?? DEFAULTS.messaging.teams.pollIntervalMs,
                defaultAgentId: teamsOver?.defaultAgentId ?? teamsFile?.defaultAgentId ?? DEFAULTS.messaging.teams.defaultAgentId,
            },
        },
    };
}

function loadConfigFile(): ContainerConfig {
    const configPath = path.join(DEFAULT_DATA_DIR, 'config.yaml');
    try {
        if (!fs.existsSync(configPath)) {
            return {};
        }
        const content = fs.readFileSync(configPath, 'utf8');
        return (yaml.load(content) as ContainerConfig) ?? {};
    } catch {
        return {};
    }
}

/**
 * Ensure the data directory exists.
 */
export function ensureDataDir(dataDir: string = DEFAULT_DATA_DIR): void {
    fs.mkdirSync(dataDir, { recursive: true });
}
