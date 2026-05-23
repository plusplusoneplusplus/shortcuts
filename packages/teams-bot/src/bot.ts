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

import type { TeamsBotOptions, BotStatus, InboundTeamsMessage, TeamsChannel, TeamsTransportMode, TeamsTransport } from './types';
import { GraphTransport } from './transport-graph';
import { McpTransport } from './transport-mcp';
import { acquireTokenViaAzCli } from './auth';

/**
 * Create a TeamsTransport for the given mode.
 */
export function createTransport(mode: TeamsTransportMode, opts: { mcpServerUrl?: string }): TeamsTransport {
    if (mode === 'mcp') {
        if (!opts.mcpServerUrl) throw new Error('mcpServerUrl is required for MCP mode');
        return new McpTransport(opts.mcpServerUrl);
    }
    return new GraphTransport();
}

export class TeamsBot {
    private readonly opts: Required<Pick<TeamsBotOptions, 'onMessage' | 'pollIntervalMs' | 'botName'>> & TeamsBotOptions;
    private readonly mode: TeamsTransportMode;
    private transport: TeamsTransport;
    private _status: BotStatus = 'disconnected';
    private _lastError: string | null = null;
    private _pollTimer: ReturnType<typeof setInterval> | null = null;
    private _channelId: string | null = null;
    /** Last polled message ID (MCP mode watermark). */
    private _lastPolledId: string | null = null;
    /** Last seen timestamp for Graph API delta queries. */
    private _lastSeenTimestamp: string | null = null;
    /** Track message IDs sent by this bot to skip on poll. */
    private _sentMessageIds = new Set<string>();
    /** Whether a token refresh is already in progress. */
    private _refreshingToken = false;

    private get debug(): boolean { return this.opts.debug ?? false; }

    constructor(opts: TeamsBotOptions) {
        this.opts = {
            pollIntervalMs: 3000,
            botName: 'CoC',
            ...opts,
        };
        this.mode = opts.mode ?? 'graph';
        this.transport = createTransport(this.mode, { mcpServerUrl: opts.mcpServerUrl });
        this.transport.debug = opts.debug ?? false;
    }

    /** Connect to Teams. Acquires token if needed, then initializes transport. */
    async start(): Promise<void> {
        this.setStatus('connecting');
        this._lastError = null;
        console.log(`[teams-bot] Starting in ${this.mode} mode, teamId=${this.opts.teamId ?? 'none'}`);

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

        try {
            await this.transport.initialize(token, {
                teamId: this.opts.teamId,
                channelId: this._channelId ?? undefined,
            });

            // In chat mode (no teamId), use auto-discovered chatId as poll target
            if (this.mode === 'graph' && !this.opts.teamId && this.transport instanceof GraphTransport) {
                const chatId = (this.transport as GraphTransport).getChatId();
                if (chatId) this._channelId = chatId;
            } else if (this.mode === 'mcp' && !this.opts.teamId && this.transport instanceof McpTransport) {
                const chatId = (this.transport as McpTransport).getChatId();
                if (chatId) this._channelId = chatId;
            }

            this.setStatus('connected');
            console.log(`[teams-bot] Connected via ${this.mode} transport${this._channelId ? ` (target: ${this._channelId.substring(0, 12)}...)` : ''}`);
            this.startPolling();
        } catch (err: any) {
            this._lastError = err.message ?? `Failed to connect via ${this.mode}`;
            this.setStatus('error');
            this.opts.onError?.(this._lastError!);
        }
    }

    /** Gracefully disconnect. */
    async stop(): Promise<void> {
        this.stopPolling();
        this.transport.stop();
        this.setStatus('disconnected');
    }

    /** Send a text message to a Teams channel/chat. Returns the message ID. */
    async send(channelId: string, text: string, opts?: { replyToId?: string; mentions?: Array<{ aadId: string; displayName: string }> }): Promise<string> {
        if (this._status !== 'connected') {
            throw new Error('TeamsBot is not connected');
        }
        this.resetPollInterval();

        console.log(`[teams-bot] send() target=${channelId.substring(0, 20)}..., text length=${text.length}, mode=${this.mode}`);
        try {
            const messageId = await this.transport.send(channelId, text, opts);
            if (messageId) this._sentMessageIds.add(messageId);
            console.log(`[teams-bot] send() success, messageId=${messageId}`);
            return messageId;
        } catch (err: any) {
            console.error(`[teams-bot] send() failed: ${err.message}`);
            // On 401, refresh token and retry once
            if (err.message?.includes('401')) {
                const refreshed = await this.refreshToken();
                if (refreshed) {
                    const messageId = await this.transport.send(channelId, text, opts);
                    if (messageId) this._sentMessageIds.add(messageId);
                    return messageId;
                }
            }
            throw err;
        }
    }

    /** List available Teams channels. */
    async listChannels(): Promise<TeamsChannel[]> {
        if (this._status !== 'connected') {
            throw new Error('TeamsBot is not connected');
        }
        if (!this.opts.teamId) return [];
        return this.transport.listChannels(this.opts.teamId);
    }

    /** Set the target channel for message polling. */
    setChannelId(channelId: string): void {
        this._channelId = channelId;
        this.transport.setChannelId(channelId);
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

    private _lastActivityTime: number = Date.now();
    private static readonly IDLE_TIMEOUT_MS = 60_000; // 1 minute
    private static readonly IDLE_POLL_MS = 30_000; // 30s when idle

    private startPolling(): void {
        // Graph mode is send-only — do not poll for messages
        if (this.mode === 'graph') {
            console.log('[teams-bot] Graph mode is send-only — polling disabled');
            return;
        }
        if (this._pollTimer) return;
        this._lastActivityTime = Date.now();
        this.schedulePoll();
    }

    private schedulePoll(): void {
        if (this._pollTimer) return;
        const elapsed = Date.now() - this._lastActivityTime;
        const interval = elapsed >= TeamsBot.IDLE_TIMEOUT_MS
            ? TeamsBot.IDLE_POLL_MS
            : this.opts.pollIntervalMs;
        this._pollTimer = setTimeout(() => {
            this._pollTimer = null;
            void this.pollMessages();
        }, interval);
    }

    private stopPolling(): void {
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
    }

    /** Cancel any pending slow poll and reschedule at fast interval. */
    private resetPollInterval(): void {
        this._lastActivityTime = Date.now();
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
            this.schedulePoll();
        }
    }

    private async pollMessages(): Promise<void> {
        if (this._status !== 'connected' || !this._channelId) {
            this.schedulePoll();
            return;
        }

        try {
            const since = this.mode === 'graph' ? this._lastSeenTimestamp ?? undefined : this._lastPolledId ?? undefined;
            const { messages, nextSince } = await this.transport.poll(this._channelId, since);

            if (this.mode === 'mcp') {
                await this.handleMcpPoll(messages, nextSince);
            } else {
                await this.handleGraphPoll(messages, nextSince);
            }

            // Reset activity timer when new messages arrive
            if (messages.length > 0) {
                this._lastActivityTime = Date.now();
            }
        } catch (err: any) {
            // On 401, attempt token refresh
            if (err.message?.includes('401') && !this._refreshingToken) {
                await this.refreshToken();
            } else {
                console.error(`[teams-bot] ${this.mode} poll error:`, err.message);
            }
        }

        // Schedule next poll (adaptive interval based on activity)
        this.schedulePoll();
    }

    /**
     * MCP poll logic: only process the LAST message if its ID differs from watermark.
     * First poll just sets the watermark without processing.
     */
    private async handleMcpPoll(messages: InboundTeamsMessage[], nextSince: string): Promise<void> {
        if (messages.length === 0) {
            if (!this._lastPolledId && nextSince) this._lastPolledId = nextSince;
            return;
        }

        const lastMsg = messages[messages.length - 1];

        // Debug: log all polled messages
        if (this.debug) {
            console.log(`[teams-bot] Poll returned ${messages.length} message(s):`);
            for (const m of messages) {
                const preview = m.text.substring(0, 80).replace(/\n/g, '\\n');
                console.log(`[teams-bot]   id=${m.messageId}, sender=${m.senderName}, replyToId=${m.replyToMessageId ?? '(none)'}, text="${preview}"`);
            }
        }

        // First poll: just set watermark, don't process
        if (!this._lastPolledId) {
            this._lastPolledId = lastMsg.messageId;
            if (this.debug) console.log(`[teams-bot] First poll — setting watermark to ${lastMsg.messageId}`);
            return;
        }

        // No new message since last poll
        if (lastMsg.messageId === this._lastPolledId) return;

        // Update watermark
        this._lastPolledId = lastMsg.messageId;

        // Skip messages sent by this bot
        if (this._sentMessageIds.has(lastMsg.messageId)) {
            if (this.debug) console.log(`[teams-bot] Skipping own sent message: ${lastMsg.messageId}`);
            this._sentMessageIds.delete(lastMsg.messageId);
            return;
        }

        if (!lastMsg.text.trim()) return;

        // Skip bot-formatted messages (CoC outbound format)
        if (this.isBotFormattedMessage(lastMsg.text)) {
            if (this.debug) console.log(`[teams-bot] Skipping bot-formatted message: ${lastMsg.messageId}`);
            return;
        }

        // In DM mode: if user message has no replyToMessageId, infer it from
        // the preceding bot message. This ensures replies route to the correct
        // chat session even when Teams DM doesn't provide replyToId.
        if (!lastMsg.replyToMessageId && messages.length >= 2) {
            const preceding = messages[messages.length - 2];
            if (this.debug) console.log(`[teams-bot] No replyToId on last msg. Preceding: id=${preceding.messageId}, isSent=${this._sentMessageIds.has(preceding.messageId)}, isBotFormatted=${this.isBotFormattedMessage(preceding.text)}`);
            if (preceding && (this._sentMessageIds.has(preceding.messageId) || this.isBotFormattedMessage(preceding.text))) {
                lastMsg.replyToMessageId = preceding.messageId;
                if (this.debug) console.log(`[teams-bot] ✓ Inferred replyToMessageId=${preceding.messageId} from preceding bot message`);
            }
        }

        if (this.debug) console.log(`[teams-bot] Delivering inbound message: id=${lastMsg.messageId}, replyToMessageId=${lastMsg.replyToMessageId ?? '(none)'}, text="${lastMsg.text.substring(0, 60)}"`);
        await this.opts.onMessage(lastMsg).catch((err) => {
            console.error('[teams-bot] Error handling message:', err);
        });
    }

    /** Graph poll logic: process all new messages since last timestamp. */
    private async handleGraphPoll(messages: InboundTeamsMessage[], nextSince: string): Promise<void> {
        for (const msg of messages) {
            if (this._sentMessageIds.has(msg.messageId)) {
                this._sentMessageIds.delete(msg.messageId);
                continue;
            }
            if (!msg.text.trim()) continue;
            if (this.isBotFormattedMessage(msg.text)) continue;

            await this.opts.onMessage(msg).catch((err) => {
                console.error('[teams-bot] Error handling message:', err);
            });
        }
        if (nextSince) this._lastSeenTimestamp = nextSince;
    }

    /** Attempt to refresh the bearer token via the configured callback. */
    private async refreshToken(): Promise<boolean> {
        const refreshFn = this.opts.auth?.onTokenRefresh;
        if (!refreshFn || this._refreshingToken) return false;

        this._refreshingToken = true;
        try {
            const newToken = await refreshFn();
            if (newToken) {
                this.transport.setToken(newToken);
                console.log('[teams-bot] Token refreshed successfully');
                return true;
            }
        } catch (err: any) {
            console.error('[teams-bot] Token refresh failed:', err.message);
            this._lastError = `Token refresh failed: ${err.message}`;
            this.setStatus('error');
        } finally {
            this._refreshingToken = false;
        }
        return false;
    }

    /**
     * Detect if a message matches the CoC outbound format:
     *   <name>
     *   Agent: ...
     *   Repo: ...
     *   Message:
     *   ...
     */
    private isBotFormattedMessage(text: string): boolean {
        const lines = text.split('\n');
        if (lines.length < 4) return false;
        // Check for "Agent:" and "Repo:" in lines 2-4
        const hasAgent = lines.some((l, i) => i > 0 && i < 5 && /^Agent:\s/i.test(l.trim()));
        const hasRepo = lines.some((l, i) => i > 0 && i < 5 && /^Repo:\s/i.test(l.trim()));
        const hasMessage = lines.some((l, i) => i > 0 && i < 6 && /^Message:\s*$/i.test(l.trim()));
        return hasAgent && hasRepo && hasMessage;
    }
}

