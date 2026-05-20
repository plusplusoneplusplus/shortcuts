/**
 * Teams Messaging Manager
 *
 * Manages the MS Teams bot lifecycle (connect, disconnect, poll).
 * Persists Teams configuration (team name, channel name, resolved IDs, botName).
 * On "connect", ensures the MCP server entry exists in ~/.copilot/mcp-config.json,
 * acquires a Graph token via az CLI, resolves team/channel IDs, and starts polling.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { BotStatus, InboundTeamsMessage } from '@plusplusoneplusplus/teams-bot';
import { TeamsBot } from '@plusplusoneplusplus/teams-bot';

// ── Persisted Config ─────────────────────────────────────────

export interface TeamsMessagingConfig {
    enabled: boolean;
    botName: string;
    teamName: string;
    channelName: string;
    teamId?: string;
    channelId?: string;
}

const DEFAULT_CONFIG: TeamsMessagingConfig = {
    enabled: false,
    botName: 'CoC',
    teamName: 'Coc',
    channelName: 'Coc-General',
};

/** MCP Server URL for Microsoft Teams (Microsoft tenant). */
const TEAMS_MCP_SERVER_URL = 'https://agent365.svc.cloud.microsoft/agents/tenants/72f988bf-86f1-41af-91ab-2d7cd011db47/servers/mcp_TeamsServer';

// ── Manager ──────────────────────────────────────────────────

export interface TeamsMessagingStatus {
    enabled: boolean;
    status: BotStatus;
    error: string | null;
    teamName?: string;
    channelName?: string;
    teamId?: string;
    channelId?: string;
    botName: string;
}

export class TeamsMessagingManager {
    private config: TeamsMessagingConfig;
    private bot: TeamsBot | null = null;
    private _status: BotStatus = 'disconnected';
    private _lastError: string | null = null;
    private readonly configPath: string;
    private onInboundMessage: ((msg: InboundTeamsMessage) => Promise<void>) | null = null;
    private readonly _homeDir: string;

    constructor(private readonly dataDir: string, opts?: { homeDir?: string }) {
        this.configPath = path.join(dataDir, 'teams-messaging.json');
        this._homeDir = opts?.homeDir ?? os.homedir();
        this.config = this.loadConfig();
    }

    /** Register a callback for inbound messages from Teams. */
    setMessageHandler(handler: (msg: InboundTeamsMessage) => Promise<void>): void {
        this.onInboundMessage = handler;
    }

    /** Get the current status for the REST API. */
    getStatus(): TeamsMessagingStatus {
        return {
            enabled: this.config.enabled,
            status: this._status,
            error: this._lastError,
            teamName: this.config.teamName,
            channelName: this.config.channelName,
            teamId: this.config.teamId,
            channelId: this.config.channelId,
            botName: this.config.botName,
        };
    }

    /** Update configuration fields. Does NOT reconnect automatically. */
    async updateConfig(patch: Partial<TeamsMessagingConfig>): Promise<void> {
        Object.assign(this.config, patch);
        this.saveConfig();
    }

    /**
     * Connect (or reconnect) the bot.
     * 1. Ensures MCP server config is in ~/.copilot/mcp-config.json.
     * 2. Acquires Graph token via az CLI.
     * 3. Resolves team + channel IDs (creates them if missing).
     * 4. Starts message polling.
     */
    async connect(): Promise<void> {
        if (!this.config.enabled) {
            this._lastError = 'Teams integration is disabled';
            this._status = 'disconnected';
            return;
        }

        // Stop existing bot if running
        await this.disconnect();

        this._status = 'connecting';
        this._lastError = null;

        try {
            // Step 1: Ensure MCP server is configured
            this.ensureMcpServerConfig();

            // Step 2: Acquire token via az CLI (Graph scope)
            this._status = 'authenticating';
            const { acquireTokenViaAzCli } = await import('@plusplusoneplusplus/teams-bot');
            const token = await acquireTokenViaAzCli();

            // Step 3: Create bot in Graph mode and resolve team/channel
            this.bot = new TeamsBot({
                mode: 'graph',
                teamId: this.config.teamId ?? 'placeholder',
                auth: { bearerToken: token },
                botName: this.config.botName,
                onMessage: async (msg) => {
                    if (this.onInboundMessage) {
                        await this.onInboundMessage(msg);
                    }
                },
                onStatusChange: (s) => { this._status = s; },
                onError: (e) => { this._lastError = e; },
            });

            // Resolve team and channel using GraphClient directly
            const { GraphClient } = await import('@plusplusoneplusplus/teams-bot');
            const graphClient = new GraphClient({ bearerToken: token });
            const resolved = await graphClient.resolveOrCreateTeamAndChannel(
                this.config.teamName,
                this.config.channelName,
            );

            this.config.teamId = resolved.teamId;
            this.config.channelId = resolved.channelId;
            this.saveConfig();

            // Re-create bot with correct teamId
            this.bot = new TeamsBot({
                mode: 'graph',
                teamId: resolved.teamId,
                auth: { bearerToken: token },
                botName: this.config.botName,
                onMessage: async (msg) => {
                    if (this.onInboundMessage) {
                        await this.onInboundMessage(msg);
                    }
                },
                onStatusChange: (s) => { this._status = s; },
                onError: (e) => { this._lastError = e; },
            });
            this.bot.setChannelId(resolved.channelId);
            await this.bot.start();
        } catch (err: any) {
            this._lastError = err.message ?? 'Failed to connect';
            this._status = 'error';
        }
    }

    /** Disconnect the bot. */
    async disconnect(): Promise<void> {
        if (this.bot) {
            await this.bot.stop();
            this.bot = null;
        }
        this._status = 'disconnected';
    }

    /** Send a message to the configured channel. */
    async sendMessage(text: string): Promise<string> {
        if (!this.bot || this._status !== 'connected') {
            throw new Error('Teams bot is not connected');
        }
        if (!this.config.channelId) {
            throw new Error('No channel configured');
        }
        return this.bot.send(this.config.channelId, text);
    }

    // ── Private helpers ──────────────────────────────────────

    private loadConfig(): TeamsMessagingConfig {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, 'utf-8');
                return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
            }
        } catch { /* use defaults */ }
        return { ...DEFAULT_CONFIG };
    }

    private saveConfig(): void {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch { /* best effort */ }
    }

    /**
     * Ensure the Teams MCP server entry exists in ~/.copilot/mcp-config.json.
     * This allows the Copilot SDK to use the Teams tools in chat sessions.
     */
    private ensureMcpServerConfig(): void {
        const configDir = path.join(this._homeDir, '.copilot');
        const configFile = path.join(configDir, 'mcp-config.json');

        let config: { mcpServers?: Record<string, { type: string; url: string }> } = { mcpServers: {} };

        try {
            if (fs.existsSync(configFile)) {
                const raw = fs.readFileSync(configFile, 'utf-8');
                config = JSON.parse(raw);
            }
        } catch { /* start fresh */ }

        if (!config.mcpServers) {
            config.mcpServers = {};
        }

        // Add or update the Teams MCP server entry
        if (!config.mcpServers['Microsoft Teams']) {
            config.mcpServers['Microsoft Teams'] = {
                type: 'http',
                url: TEAMS_MCP_SERVER_URL,
            };

            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        }
    }
}
