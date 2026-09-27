/**
 * Manages the MS Teams bot lifecycle (connect, disconnect, poll).
 * Persists Teams configuration (team name, channel name, resolved IDs, botName).
 * On "connect", reads the configured global Teams MCP server,
 * acquires a cached SDK OAuth token, resolves team/channel
 * IDs via MCP tools, and starts the bot in MCP mode for polling.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { BotStatus, InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsBot } from '@plusplusoneplusplus/coc-connector/teams';
import { readMcpServerAuthInfo } from '../mcp-oauth/mcp-oauth-token-cache';
import type { TeamsOAuthFlow } from './teams-oauth-flow';
import { readRawGlobalConfig, writeRawGlobalConfig } from '../routes/mcp-config-writer';
import { TeamsAttemptStore, type TeamsAttempt, type TeamsFailureCategory, type TeamsAttemptResult } from './teams-attempt-store';

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

export const TEAMS_MCP_SERVER_NAME = 'Microsoft Teams';

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
    serverUrl: string | null;
    authStatus: string | null;
}

export class TeamsMessagingManager {
    private config: TeamsMessagingConfig;
    private bot: TeamsBot | null = null;
    private _status: BotStatus = 'disconnected';
    private _lastError: string | null = null;
    private readonly configPath: string;
    private onInboundMessage: ((msg: InboundTeamsMessage) => Promise<void>) | null = null;
    private readonly _homeDir: string;
    private readonly customHome: boolean;
    private generation = 0;
    private oauthFlow: TeamsOAuthFlow | null = null;
    private history: TeamsAttemptStore | null = null;
    private attemptId: string | null = null;
    private readonly getObservabilityEnabled: () => boolean;

    setOAuthFlow(flow: TeamsOAuthFlow): void {
        this.oauthFlow = flow;
    }

    constructor(private readonly dataDir: string, opts?: { homeDir?: string; getObservabilityEnabled?: () => boolean }) {
        this.configPath = path.join(dataDir, 'teams-messaging.json');
        this._homeDir = opts?.homeDir ?? os.homedir();
        this.customHome = opts?.homeDir !== undefined;
        this.getObservabilityEnabled = opts?.getObservabilityEnabled ?? (() => false);
        this.config = this.loadConfig();
    }

    getAttemptHistory(): TeamsAttempt[] | null {
        return this.getAttemptStore()?.list() ?? null;
    }

    private getAttemptStore(): TeamsAttemptStore | null {
        if (!this.getObservabilityEnabled()) return null;
        return this.history ??= new TeamsAttemptStore(this.dataDir);
    }

    setMessageHandler(handler: (msg: InboundTeamsMessage) => Promise<void>): void {
        this.onInboundMessage = handler;
    }

    /** Get the current status for the REST API. */
    getStatus(): TeamsMessagingStatus {
        const serverUrl = this.getServerUrl();
        return {
            enabled: this.config.enabled,
            status: this._status,
            error: this._lastError,
            teamName: this.config.teamName,
            channelName: this.config.channelName,
            teamId: this.config.teamId,
            channelId: this.config.channelId,
            botName: this.config.botName,
            serverUrl,
            authStatus: serverUrl
                ? readMcpServerAuthInfo(serverUrl, 'http', this._homeDir).status
                : null,
        };
    }

    /** Update configuration fields. Disconnect on disable or target changes. */
    async updateConfig(patch: Partial<TeamsMessagingConfig>): Promise<void> {
        if (patch.enabled === false || patch.teamName !== undefined || patch.channelName !== undefined || patch.botName !== undefined) {
            await this.disconnect();
            this._lastError = null;
        }
        if (patch.teamName !== undefined || patch.channelName !== undefined) {
            this.config.teamId = undefined;
            this.config.channelId = undefined;
        }
        Object.assign(this.config, patch);
        this.saveConfig();
    }

    /** Register the shared global MCP endpoint used by both OAuth and polling. */
    async configureServer(url: string): Promise<void> {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
            throw new RangeError('Teams MCP URL must be HTTPS without credentials or a fragment');
        }
        const configFile = path.join(this._homeDir, '.copilot', 'mcp-config.json');
        if (fs.existsSync(configFile)) {
            const existingConfig: unknown = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
            if (!existingConfig || typeof existingConfig !== 'object' || Array.isArray(existingConfig)
                || ('mcpServers' in existingConfig && (
                    !existingConfig.mcpServers || typeof existingConfig.mcpServers !== 'object'
                    || Array.isArray(existingConfig.mcpServers)
                ))) {
                throw new Error('Global MCP configuration must contain an object of servers');
            }
        }
        const config = this.customHome
            ? (fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf-8')) as Record<string, unknown> : { mcpServers: {} })
            : readRawGlobalConfig();
        const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
        const existing = servers[TEAMS_MCP_SERVER_NAME];
        if (existing && (typeof existing !== 'object' || (existing as { type?: string }).type !== 'http')) {
            throw new Error('Microsoft Teams MCP entry must use HTTP; edit it in workspace MCP settings');
        }
        servers[TEAMS_MCP_SERVER_NAME] = { ...(existing ?? {}), type: 'http', url: parsed.href };
        config.mcpServers = servers;
        if (this.customHome) {
            fs.mkdirSync(path.dirname(configFile), { recursive: true });
            fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        } else {
            await writeRawGlobalConfig(config);
        }
        await this.disconnect();
        this._lastError = null;
    }

    /**
     * Connect (or reconnect) the bot.
     * 1. Reads the global MCP server configured in the MCP settings panel.
     * 2. Acquires a bearer token from the shared SDK OAuth cache.
     * 3. Resolves team + channel IDs via MCP tools.
     * 4. Starts the TeamsBot in MCP mode for message polling.
     */
    async connect(): Promise<void> {
        const history = this.getAttemptStore();
        const attemptId = history?.start();
        if (!this.config.enabled) {
            this._lastError = 'Teams integration is disabled';
            this._status = 'disconnected';
            if (attemptId) history?.finish(attemptId, 'failed', 'configuration');
            throw new Error(this._lastError);
        }

        // Stop existing bot if running
        let generation: number;
        try {
            const stopping = this.disconnect('superseded');
            generation = this.generation;
            await stopping;
        } catch (err) {
            if (attemptId) history?.finish(attemptId, 'failed', 'unknown');
            throw err;
        }
        if (generation !== this.generation) {
            throw new Error('Teams connection cancelled');
        }
        this.attemptId = attemptId ?? null;
        this._status = 'connecting';
        this._lastError = null;
        let failureCategory: TeamsFailureCategory = 'configuration';
        let connectedRecorded = false;

        try {
            const serverUrl = this.getServerUrl();
            if (!serverUrl) throw new Error('Configure a global HTTP Microsoft Teams MCP server before connecting');
            if (!this.onInboundMessage) throw new Error('Teams command router is unavailable');

            // Step 2: Acquire token from the shared MCP OAuth cache
            this._status = 'authenticating';
            if (attemptId) history?.phase(attemptId, 'authenticating');
            failureCategory = 'authentication';
            const { acquireMcpOAuthToken, McpClient } = await import('@plusplusoneplusplus/coc-connector/teams');
            const token = await acquireMcpOAuthToken(serverUrl, this._homeDir);
            if (generation !== this.generation || !this.config.enabled) throw new Error('Teams connection cancelled');

            // Step 3: Resolve team and channel via MCP tools
            if (attemptId) history?.phase(attemptId, 'resolving');
            failureCategory = 'resolution';
            const mcpClient = new McpClient({
                serverUrl,
                bearerToken: token,
            });
            await mcpClient.initialize();
            if (generation !== this.generation || !this.config.enabled) throw new Error('Teams connection cancelled');

            const resolved = await this.resolveTeamAndChannelViaMcp(mcpClient);
            if (generation !== this.generation || !this.config.enabled) throw new Error('Teams connection cancelled');
            this.config.teamId = resolved.teamId;
            this.config.channelId = resolved.channelId;
            this.saveConfig();

            // Step 4: Create bot in MCP mode for polling
            if (attemptId) history?.phase(attemptId, 'starting-polling');
            failureCategory = 'polling';
            const bot = new TeamsBot({
                mode: 'mcp',
                mcpServerUrl: serverUrl,
                teamId: resolved.teamId,
                auth: {
                    bearerToken: token,
                    onTokenRefresh: () => acquireMcpOAuthToken(serverUrl, this._homeDir),
                },
                botName: this.config.botName,
                onMessage: async (msg) => {
                    if (this.onInboundMessage) {
                        await this.onInboundMessage(msg);
                    }
                },
                onStatusChange: (s) => {
                    if (generation !== this.generation) return;
                    this._status = s;
                    if (s === 'connected') {
                        this._lastError = null;
                        if (attemptId && this.attemptId === attemptId && !connectedRecorded) {
                            connectedRecorded = true;
                            history?.phase(attemptId, 'connected');
                        }
                    }
                },
                onError: (e) => { if (generation === this.generation) this._lastError = e; },
            });
            this.bot = bot;
            bot.setChannelId(resolved.channelId);
            await bot.start();
            if (generation !== this.generation || !this.config.enabled) {
                await bot.stop();
                throw new Error('Teams connection cancelled');
            }
            if (!bot.isConnected()) throw new Error(this._lastError ?? 'Teams bot did not connect');
        } catch (err: any) {
            if (generation === this.generation) {
                this._lastError = err.message ?? 'Failed to connect';
                await this.disconnect('failed', failureCategory);
                this._status = 'error';
            }
            throw err;
        }
    }

    /**
     * Resolve team and channel IDs using MCP tools (ListTeams + ListChannels).
     * Creates the team/channel if they don't exist.
     */
    private async resolveTeamAndChannelViaMcp(mcpClient: InstanceType<typeof import('@plusplusoneplusplus/coc-connector/teams').McpClient>): Promise<{ teamId: string; channelId: string }> {
        // List teams to find the configured one
        const teamsResult = await mcpClient.callTool('ListTeams', {});
        const teamsText = teamsResult.content?.[0]?.text ?? '{}';
        let teams: Array<{ id: string; displayName: string }> = [];
        try {
            const parsed = JSON.parse(teamsText);
            teams = parsed.teams ?? parsed.value ?? (Array.isArray(parsed) ? parsed : []);
        } catch { /* empty */ }

        let teamId = teams.find(
            t => t.displayName.toLowerCase() === this.config.teamName.toLowerCase(),
        )?.id;

        if (!teamId) {
            const createResult = await mcpClient.callTool('CreateTeam', {
                displayName: this.config.teamName,
                description: `CoC Teams bridge — ${this.config.teamName}`,
            });
            const createText = createResult.content?.[0]?.text ?? '{}';
            try {
                const parsed = JSON.parse(createText);
                teamId = parsed.id ?? parsed.teamId;
            } catch { /* empty */ }
            if (!teamId) throw new Error(`Failed to create team "${this.config.teamName}"`);
            // Wait for team provisioning
            await new Promise(r => setTimeout(r, 3000));
        }

        // List channels to find the configured one
        const channelsResult = await mcpClient.callTool('ListChannels', { teamId });
        const channelsText = channelsResult.content?.[0]?.text ?? '{}';
        let channels: Array<{ id: string; displayName: string }> = [];
        try {
            const parsed = JSON.parse(channelsText);
            channels = parsed.channels ?? parsed.value ?? (Array.isArray(parsed) ? parsed : []);
        } catch { /* empty */ }

        let channelId = channels.find(
            c => c.displayName.toLowerCase() === this.config.channelName.toLowerCase(),
        )?.id;

        if (!channelId) {
            const createChResult = await mcpClient.callTool('CreateChannel', {
                teamId,
                displayName: this.config.channelName,
                description: `CoC bridge channel — ${this.config.channelName}`,
            });
            const createChText = createChResult.content?.[0]?.text ?? '{}';
            try {
                const parsed = JSON.parse(createChText);
                channelId = parsed.id ?? parsed.channelId;
            } catch { /* empty */ }
            if (!channelId) throw new Error(`Failed to create channel "${this.config.channelName}"`);
        }

        return { teamId, channelId };
    }

    async disconnect(result: TeamsAttemptResult = 'disconnected', category?: TeamsFailureCategory): Promise<void> {
        this.oauthFlow?.cancel();
        this.generation++;
        const attemptId = this.attemptId;
        this.attemptId = null;
        if (attemptId) this.history?.finish(attemptId, result, category);
        if (this.bot) {
            await this.bot.stop();
            this.bot = null;
        }
        this._status = 'disconnected';
    }

    /** Send a message to the configured channel. Optionally reply to a specific message. */
    async sendMessage(text: string, replyToId?: string): Promise<string> {
        if (!this.bot || this._status !== 'connected') {
            throw new Error('Teams bot is not connected');
        }
        if (!this.config.channelId) {
            throw new Error('No channel configured');
        }
        return this.bot.send(this.config.channelId, text, replyToId ? { replyToId } : undefined);
    }

    // ── Private helpers ──────────────────────────────────────

    private loadConfig(): TeamsMessagingConfig {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, 'utf-8');
                return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
            }
        } catch (err) {
            this._status = 'error';
            this._lastError = `Cannot read Teams settings: ${err instanceof Error ? err.message : String(err)}`;
        }
        return { ...DEFAULT_CONFIG };
    }

    private saveConfig(): void {
        fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    }

    private getServerUrl(): string | null {
        const configFile = path.join(this._homeDir, '.copilot', 'mcp-config.json');
        if (!fs.existsSync(configFile)) return null;
        try {
            const config = JSON.parse(fs.readFileSync(configFile, 'utf-8')) as {
                mcpServers?: Record<string, { type?: string; url?: string }>;
            };
            const server = config.mcpServers?.[TEAMS_MCP_SERVER_NAME];
            return server?.type === 'http' && typeof server.url === 'string' ? server.url : null;
        } catch (err) {
            this._lastError = `Cannot read Teams MCP configuration: ${err instanceof Error ? err.message : String(err)}`;
            this._status = 'error';
            return null;
        }
    }
}
