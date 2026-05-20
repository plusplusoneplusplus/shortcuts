/**
 * TeamsBot — high-level bot API wrapping the Teams MCP server.
 *
 * Uses the MCP protocol (HTTP transport) to send/receive messages
 * via the Microsoft Teams MCP server.
 */

import type { TeamsBotOptions, BotStatus, InboundTeamsMessage, TeamsChannel } from './types';
import { McpClient } from './mcp-client';

export class TeamsBot {
    private readonly opts: Required<Pick<TeamsBotOptions, 'onMessage' | 'pollIntervalMs' | 'botName'>> & TeamsBotOptions;
    private mcpClient: McpClient;
    private _status: BotStatus = 'disconnected';
    private _lastError: string | null = null;
    private _pollTimer: ReturnType<typeof setInterval> | null = null;
    private _lastSeenMessageId: string | null = null;
    private _channelId: string | null = null;
    /** Track message IDs sent by this bot to distinguish from user-typed messages. */
    private _sentMessageIds = new Set<string>();

    constructor(opts: TeamsBotOptions) {
        this.opts = {
            pollIntervalMs: 3000,
            botName: 'CoC',
            ...opts,
        };
        this.mcpClient = new McpClient({ serverUrl: opts.mcpServerUrl });
    }

    /** Connect to Teams via the MCP server. */
    async start(): Promise<void> {
        this.setStatus('connecting');
        this._lastError = null;
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

        const args: Record<string, unknown> = {
            channelId,
            content: text,
        };
        if (opts?.replyToId) {
            args.replyToMessageId = opts.replyToId;
        }

        const result = await this.mcpClient.callTool('send_message', args);
        const responseText = result.content?.[0]?.text ?? '';
        // Parse message ID from response
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

        const result = await this.mcpClient.callTool('list_channels', {});
        const responseText = result.content?.[0]?.text ?? '[]';
        try {
            const parsed = JSON.parse(responseText);
            return Array.isArray(parsed) ? parsed : (parsed.channels ?? []);
        } catch {
            return [];
        }
    }

    /** Set the target channel for message polling. */
    setChannelId(channelId: string): void {
        this._channelId = channelId;
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

        try {
            const args: Record<string, unknown> = { channelId: this._channelId };
            if (this._lastSeenMessageId) {
                args.afterMessageId = this._lastSeenMessageId;
            }

            const result = await this.mcpClient.callTool('get_messages', args);
            const responseText = result.content?.[0]?.text ?? '[]';
            let messages: Array<{
                id: string;
                text?: string;
                content?: string;
                senderName?: string;
                senderAadId?: string;
                replyToMessageId?: string;
                channelId?: string;
            }> = [];

            try {
                const parsed = JSON.parse(responseText);
                messages = Array.isArray(parsed) ? parsed : (parsed.messages ?? []);
            } catch {
                return;
            }

            for (const msg of messages) {
                // Skip messages sent by this bot
                if (this._sentMessageIds.has(msg.id)) {
                    this._sentMessageIds.delete(msg.id);
                    this._lastSeenMessageId = msg.id;
                    continue;
                }

                const text = msg.text ?? msg.content ?? '';
                if (!text.trim()) {
                    this._lastSeenMessageId = msg.id;
                    continue;
                }

                const inbound: InboundTeamsMessage = {
                    channelId: msg.channelId ?? this._channelId!,
                    messageId: msg.id,
                    text,
                    senderName: msg.senderName,
                    senderAadId: msg.senderAadId,
                    replyToMessageId: msg.replyToMessageId,
                };

                await this.opts.onMessage(inbound).catch((err) => {
                    console.error('[teams-bot] Error handling message:', err);
                });

                this._lastSeenMessageId = msg.id;
            }
        } catch (err: any) {
            console.error('[teams-bot] Poll error:', err.message);
            // Don't disconnect on transient poll errors
        }
    }
}
