/**
 * TeamsBot — high-level bot API for Microsoft Teams.
 *
 * Supports two transport modes:
 * - 'graph' (default): Uses Microsoft Graph API directly with az login tokens.
 *   Works with any Entra ID app that has Teams Graph permissions.
 * - 'mcp': Uses the Teams MCP server (agent365). Requires McpServers.Teams.All
 *   scope, which is only preauthorized for first-party Microsoft apps
 *   (Copilot Studio, M365 Copilot, VS Code Copilot Chat).
 */

import type { TeamsBotOptions, BotStatus, InboundTeamsMessage, TeamsChannel, TeamsTransportMode } from './types';
import { McpClient } from './mcp-client';
import { GraphClient } from './graph-client';
import { acquireTokenViaAzCli } from './auth';

export class TeamsBot {
    private readonly opts: Required<Pick<TeamsBotOptions, 'onMessage' | 'pollIntervalMs' | 'botName'>> & TeamsBotOptions;
    private readonly mode: TeamsTransportMode;
    private mcpClient: McpClient | null = null;
    private graphClient: GraphClient | null = null;
    private _status: BotStatus = 'disconnected';
    private _lastError: string | null = null;
    private _pollTimer: ReturnType<typeof setInterval> | null = null;
    private _lastSeenTimestamp: string | null = null;
    private _firstPollDone = false;
    private _channelId: string | null = null;
    /** Track message IDs sent by this bot to distinguish from user-typed messages. */
    private _sentMessageIds = new Set<string>();

    constructor(opts: TeamsBotOptions) {
        this.opts = {
            pollIntervalMs: 3000,
            botName: 'CoC',
            ...opts,
        };
        this.mode = opts.mode ?? 'graph';

        if (this.mode === 'mcp') {
            if (!opts.mcpServerUrl) throw new Error('mcpServerUrl is required for MCP mode');
            this.mcpClient = new McpClient({
                serverUrl: opts.mcpServerUrl,
                bearerToken: opts.auth?.bearerToken,
            });
        }
    }

    /** Connect to Teams. In graph mode, verifies token; in MCP mode, initializes session. */
    async start(): Promise<void> {
        this.setStatus('connecting');
        this._lastError = null;

        if (this.mode === 'graph') {
            await this.startGraph();
        } else {
            await this.startMcp();
        }
    }

    private async startGraph(): Promise<void> {
        let token = this.opts.auth?.bearerToken;

        // If no token provided, acquire via az CLI
        if (!token) {
            try {
                this.setStatus('authenticating');
                token = await acquireTokenViaAzCli();
            } catch (err: any) {
                this._lastError = err.message ?? 'Failed to acquire token via az CLI';
                this.setStatus('error');
                this.opts.onError?.(this._lastError!);
                return;
            }
        }

        if (!this.opts.teamId) {
            this._lastError = 'teamId is required for Graph mode';
            this.setStatus('error');
            this.opts.onError?.(this._lastError);
            return;
        }

        this.graphClient = new GraphClient({
            bearerToken: token,
            teamId: this.opts.teamId,
            channelId: this._channelId ?? undefined,
        });

        try {
            await this.graphClient.verifyConnection();
            this.setStatus('connected');
            console.log('[teams-bot] Connected via Graph API');
            this.startPolling();
        } catch (err: any) {
            this._lastError = err.message ?? 'Failed to connect via Graph API';
            this.setStatus('error');
            this.opts.onError?.(this._lastError!);
        }
    }

    private async startMcp(): Promise<void> {
        if (!this.mcpClient) {
            this._lastError = 'MCP client not initialized';
            this.setStatus('error');
            return;
        }

        // If no bearer token, acquire via az CLI
        if (!this.opts.auth?.bearerToken) {
            try {
                this.setStatus('authenticating');
                const token = await acquireTokenViaAzCli();
                this.mcpClient.setBearerToken(token);
            } catch (err: any) {
                this._lastError = err.message ?? 'Failed to acquire token via az CLI';
                this.setStatus('error');
                this.opts.onError?.(this._lastError!);
                return;
            }
        }

        try {
            await this.mcpClient.initialize();
            this.setStatus('connected');
            console.log('[teams-bot] Connected to Teams MCP server');
            this.startPolling();
        } catch (err: any) {
            this._lastError = err.message ?? 'Failed to connect to MCP server';
            this.setStatus('error');
            this.opts.onError?.(this._lastError!);
        }
    }

    /** Gracefully disconnect. */
    async stop(): Promise<void> {
        this.stopPolling();
        this.setStatus('disconnected');
    }

    /** Send a text message to a Teams channel. Returns the message ID. */
    async send(channelId: string, text: string, opts?: { replyToId?: string }): Promise<string> {
        if (this._status !== 'connected') {
            throw new Error('TeamsBot is not connected');
        }

        if (this.mode === 'graph') {
            return this.sendViaGraph(channelId, text, opts);
        } else {
            return this.sendViaMcp(channelId, text, opts);
        }
    }

    private async sendViaGraph(channelId: string, text: string, opts?: { replyToId?: string }): Promise<string> {
        if (!this.graphClient) throw new Error('Graph client not initialized');

        // Ensure the graph client targets the right channel
        this.graphClient.setChannelId(channelId);

        let messageId: string;
        if (opts?.replyToId) {
            messageId = await this.graphClient.replyToChannelMessage(opts.replyToId, text);
        } else {
            messageId = await this.graphClient.postChannelMessage(text);
        }
        if (messageId) this._sentMessageIds.add(messageId);
        return messageId;
    }

    private async sendViaMcp(channelId: string, text: string, opts?: { replyToId?: string }): Promise<string> {
        if (!this.mcpClient) throw new Error('MCP client not initialized');

        let toolName: string;
        const args: Record<string, unknown> = {
            teamId: this.opts.teamId,
            channelId,
            content: text,
        };

        if (opts?.replyToId) {
            toolName = 'ReplyToChannelMessage';
            args['messageId'] = opts.replyToId;
        } else {
            toolName = 'SendMessageToChannel';
        }

        const result = await this.mcpClient.callTool(toolName, args);
        const responseText = result.content?.[0]?.text ?? '';
        let messageId = '';
        try {
            const parsed = JSON.parse(responseText);
            messageId = parsed.messageId ?? parsed.id ?? '';
        } catch {
            messageId = responseText;
        }
        if (messageId) this._sentMessageIds.add(messageId);
        return messageId;
    }

    /** List available Teams channels. */
    async listChannels(): Promise<TeamsChannel[]> {
        if (this._status !== 'connected') {
            throw new Error('TeamsBot is not connected');
        }

        if (this.mode === 'graph') {
            if (!this.graphClient) return [];
            const channels = await this.graphClient.listChannels();
            return channels.map(ch => ({ id: ch.id, displayName: ch.displayName }));
        }

        // MCP mode
        if (!this.mcpClient) return [];
        const result = await this.mcpClient.callTool('ListChannels', {
            teamId: this.opts.teamId,
        });
        const responseText = result.content?.[0]?.text ?? '[]';
        try {
            const parsed = JSON.parse(responseText);
            return Array.isArray(parsed) ? parsed : (parsed.channels ?? parsed.value ?? []);
        } catch {
            return [];
        }
    }

    /** Set the target channel for message polling. */
    setChannelId(channelId: string): void {
        this._channelId = channelId;
        if (this.graphClient) {
            this.graphClient.setChannelId(channelId);
        }
    }

    /** Get the target channel ID. */
    getChannelId(): string | null {
        return this._channelId;
    }

    /** Whether the bot is currently connected. */
    isConnected(): boolean {
        return this._status === 'connected';
    }

    /** Current connection status. */
    getStatus(): BotStatus {
        return this._status;
    }

    /** Last error message, if any. */
    getLastError(): string | null {
        return this._lastError;
    }

    /** Get the transport mode. */
    getMode(): TeamsTransportMode {
        return this.mode;
    }

    private setStatus(status: BotStatus): void {
        this._status = status;
        this.opts.onStatusChange?.(status);
    }

    private startPolling(): void {
        if (this._pollTimer) return;
        this._pollTimer = setInterval(() => void this.pollMessages(), this.opts.pollIntervalMs);
    }

    private stopPolling(): void {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    private async pollMessages(): Promise<void> {
        if (this._status !== 'connected' || !this._channelId) return;

        if (this.mode === 'graph') {
            await this.pollViaGraph();
        } else {
            await this.pollViaMcp();
        }
    }

    private async pollViaGraph(): Promise<void> {
        if (!this.graphClient) return;

        try {
            const filter = this._lastSeenTimestamp
                ? `createdDateTime gt ${this._lastSeenTimestamp}`
                : undefined;
            const messages = await this.graphClient.listChannelMessages({ top: 20, filter });

            // Messages come newest-first from Graph; process oldest-first
            const sorted = [...messages].sort((a, b) =>
                new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime(),
            );

            for (const msg of sorted) {
                // Skip messages sent by this bot
                if (this._sentMessageIds.has(msg.id)) {
                    this._sentMessageIds.delete(msg.id);
                    this._lastSeenTimestamp = msg.createdDateTime;
                    continue;
                }

                const text = msg.body?.content ?? '';
                if (!text.trim()) {
                    this._lastSeenTimestamp = msg.createdDateTime;
                    continue;
                }

                const inbound: InboundTeamsMessage = {
                    channelId: this._channelId!,
                    messageId: msg.id,
                    text,
                    senderName: msg.from?.user?.displayName,
                    senderAadId: msg.from?.user?.id,
                    replyToMessageId: msg.replyToId,
                };

                await this.opts.onMessage(inbound).catch((err) => {
                    console.error('[teams-bot] Error handling message:', err);
                });

                this._lastSeenTimestamp = msg.createdDateTime;
            }
        } catch (err: any) {
            console.error('[teams-bot] Graph poll error:', err.message);
        }
    }

    private async pollViaMcp(): Promise<void> {
        if (!this.mcpClient) return;

        try {
            const args: Record<string, unknown> = {
                teamId: this.opts.teamId,
                channelId: this._channelId,
                top: 10,
            };

            const result = await this.mcpClient.callTool('ListChannelMessages', args);
            const responseText = result.content?.[0]?.text ?? '[]';
            let messages: Array<{
                id: string;
                body?: { content?: string; contentType?: string };
                text?: string;
                content?: string;
                from?: { user?: { displayName?: string; id?: string; userId?: string }; displayName?: string; userId?: string };
                senderName?: string;
                senderAadId?: string;
                replyToId?: string;
                createdDateTime?: string;
            }> = [];

            try {
                const parsed = JSON.parse(responseText);
                messages = Array.isArray(parsed) ? parsed : (parsed.value ?? parsed.messages ?? []);
            } catch {
                return;
            }

            // Sort oldest-first
            messages.sort((a, b) => {
                const ta = a.createdDateTime ? new Date(a.createdDateTime).getTime() : 0;
                const tb = b.createdDateTime ? new Date(b.createdDateTime).getTime() : 0;
                return ta - tb;
            });

            // On first poll, just set the watermark — don't process existing messages
            if (!this._firstPollDone) {
                this._firstPollDone = true;
                const last = messages[messages.length - 1];
                if (last?.createdDateTime) {
                    this._lastSeenTimestamp = last.createdDateTime;
                }
                return;
            }

            for (const msg of messages) {
                // Skip messages we've already seen
                if (this._lastSeenTimestamp && msg.createdDateTime) {
                    if (new Date(msg.createdDateTime).getTime() <= new Date(this._lastSeenTimestamp).getTime()) {
                        continue;
                    }
                }

                if (this._sentMessageIds.has(msg.id)) {
                    this._sentMessageIds.delete(msg.id);
                    if (msg.createdDateTime) this._lastSeenTimestamp = msg.createdDateTime;
                    continue;
                }

                const text = msg.body?.content ?? msg.text ?? msg.content ?? '';
                if (!text.trim()) {
                    if (msg.createdDateTime) this._lastSeenTimestamp = msg.createdDateTime;
                    continue;
                }

                const inbound: InboundTeamsMessage = {
                    channelId: this._channelId!,
                    messageId: msg.id,
                    text,
                    senderName: msg.from?.user?.displayName ?? msg.from?.displayName ?? msg.senderName,
                    senderAadId: msg.from?.user?.id ?? msg.from?.userId ?? msg.senderAadId,
                    replyToMessageId: msg.replyToId,
                };

                await this.opts.onMessage(inbound).catch((err) => {
                    console.error('[teams-bot] Error handling message:', err);
                });

                if (msg.createdDateTime) this._lastSeenTimestamp = msg.createdDateTime;
            }
        } catch (err: any) {
            console.error('[teams-bot] MCP poll error:', err.message);
        }
    }
}

