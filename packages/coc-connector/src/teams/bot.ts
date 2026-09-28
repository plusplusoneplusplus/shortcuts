/**
 * TeamsBot — high-level bot API for Microsoft Teams.
 *
 * Supports two transport modes:
 * - 'graph' (default): Uses Microsoft Graph API directly with az login tokens.
 *   Works with any Entra ID app that has Teams Graph permissions.
 * - 'mcp': Uses the Teams MCP server (agent365). Requires McpServers.Teams.All
 *   scope, which is only preauthorized for first-party Microsoft apps
 *   (Copilot Studio, M365 Copilot, editor chat clients).
 */

import type { TeamsBotOptions, BotStatus, InboundTeamsMessage, TeamsChannel, TeamsTransportMode, TeamsTransport } from './types';
import type { MessagingConnector, MessagingTarget, SendOptions } from '../core';
import { GraphTransport } from './transport-graph';
import { McpTransport } from './transport-mcp';
import { McpHttpError } from './mcp-client';
import { acquireTokenViaAzCli } from './auth';

export function createTransport(mode: TeamsTransportMode, opts: {
    mcpServerUrl?: string; pollChannelReplies?: () => boolean;
    channelThreadRoots?: (channelId: string) => readonly string[];
    onChannelRootDiscovered?: (root: InboundTeamsMessage) => Promise<void>;
}): TeamsTransport {
    if (mode === 'mcp') {
        if (!opts.mcpServerUrl) throw new Error('mcpServerUrl is required for MCP mode');
        return new McpTransport(opts.mcpServerUrl, opts.pollChannelReplies, opts.channelThreadRoots,
            opts.onChannelRootDiscovered);
    }
    return new GraphTransport();
}

function isHistoricalSelectionCommand(text: string): boolean {
    const command = text.trim();
    if (/^\/select\s+repos?\s+\S/i.test(command)
        || /^\/create\s+(?:chat\s+)?topic$/i.test(command)) return true;
    const topic = /^\/select\s+(?:chat\s+)?topic\s+(.+)$/i.exec(command)?.[1].trim();
    return !!topic && !/^\d+$/.test(topic);
}

export class TeamsBot implements MessagingConnector {
    /** Stable provider id for the MessagingConnector contract. */
    readonly provider = 'teams';
    private readonly opts: Required<Pick<TeamsBotOptions, 'onMessage' | 'pollIntervalMs' | 'botName'>> & TeamsBotOptions;
    private readonly mode: TeamsTransportMode;
    private transport: TeamsTransport;
    private _status: BotStatus = 'disconnected';
    private _lastError: string | null = null;
    private _pollTimer: ReturnType<typeof setTimeout> | null = null;
    private _rateLimitFailures = 0;
    private _retryAt = 0;
    private _channelId: string | null = null;
    /** DM watermark and channel-poll initialization marker. */
    private _lastPolledId: string | null = null;
    private readonly _seenChannelMessageIds = new Set<string>();
    private _channelBatchPolling = false;
    private _channelBaselineTime: number | null = null;
    /** Last seen timestamp for Graph API delta queries. */
    private _lastSeenTimestamp: string | null = null;
    /** Track message IDs sent by this bot to skip on poll. */
    private _sentMessageIds = new Set<string>();
    /** Whether a token refresh is already in progress. */
    private _refreshingToken = false;

    private get debug(): boolean { return this.opts.debug ?? false; }

    constructor(opts: TeamsBotOptions) {
        this.opts = {
            botName: 'CoC',
            ...opts,
            pollIntervalMs: opts.pollIntervalMs ?? 12_000,
        };
        this.mode = opts.mode ?? 'graph';
        this.transport = createTransport(this.mode, {
            mcpServerUrl: opts.mcpServerUrl, pollChannelReplies: opts.pollChannelReplies,
            channelThreadRoots: opts.channelThreadRoots,
            onChannelRootDiscovered: opts.onChannelRootDiscovered,
        });
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
                // Track init probe message so polling skips it
                const initMsgId = (this.transport as McpTransport).getInitMessageId();
                if (initMsgId) this._sentMessageIds.add(initMsgId);
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
    async send(channelId: string, text: string, opts?: SendOptions): Promise<string> {
        if (this._status !== 'connected') {
            throw new Error('TeamsBot is not connected');
        }
        this.resetPollInterval();

        // Adapt the normalized SendOptions (mentions keyed by `id`) to the
        // transport-native shape (mentions keyed by `aadId`).
        const transportOpts = opts && (opts.replyToId || opts.mentions)
            ? {
                replyToId: opts.replyToId,
                mentions: opts.mentions?.map((m) => ({ aadId: m.id, displayName: m.displayName })),
            }
            : undefined;

        console.log(`[teams-bot] send() target=${channelId.substring(0, 20)}..., text length=${text.length}, mode=${this.mode}`);
        try {
            const messageId = await this.transport.send(channelId, text, transportOpts);
            if (messageId) this._sentMessageIds.add(messageId);
            console.log(`[teams-bot] send() success, messageId=${messageId}`);
            return messageId;
        } catch (err: any) {
            console.error(`[teams-bot] send() failed: ${err.message}`);
            // On 401, refresh token and retry once
            if (err.message?.includes('401')) {
                const refreshed = await this.refreshToken();
                if (refreshed) {
                    const messageId = await this.transport.send(channelId, text, transportOpts);
                    if (messageId) this._sentMessageIds.add(messageId);
                    return messageId;
                }
            }
            throw err;
        }
    }

    /** React only in channel mode; the caller handles best-effort failures. */
    async reactToChannelMessage(msg: InboundTeamsMessage): Promise<void> {
        if (this._status !== 'connected' || !this.opts.teamId) {
            throw new Error('Teams channel Like reaction unavailable: not connected to a channel');
        }
        await this.transport.reactToChannelMessage(msg);
    }

    /** List available Teams channels. */
    async listChannels(): Promise<TeamsChannel[]> {
        if (this._status !== 'connected') {
            throw new Error('TeamsBot is not connected');
        }
        if (!this.opts.teamId) return [];
        return this.transport.listChannels(this.opts.teamId);
    }

    /** MessagingConnector: list channels as normalized targets. */
    async listTargets(): Promise<MessagingTarget[]> {
        const channels = await this.listChannels();
        return channels.map((c) => ({ id: c.id, name: c.displayName }));
    }

    /** Set the target channel for message polling. */
    setChannelId(channelId: string): void {
        if (this._channelId !== channelId) {
            this._channelBatchPolling = false;
            this._channelBaselineTime = null;
            this._lastPolledId = null;
            this._seenChannelMessageIds.clear();
        }
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
    private static readonly MAX_BACKOFF_MS = 300_000;

    private startPolling(): void {
        // Graph DMs remain send-only; channel polling is opt-in and can be toggled live.
        if (this.mode === 'graph' && !this.opts.teamId) {
            console.log('[teams-bot] Graph mode is send-only — polling disabled');
            return;
        }
        if (this._pollTimer) return;
        this._lastActivityTime = Date.now();
        this._rateLimitFailures = 0;
        this._retryAt = 0;
        this.schedulePoll();
    }

    private schedulePoll(): void {
        if (this._pollTimer) return;
        const elapsed = Date.now() - this._lastActivityTime;
        const interval = elapsed >= TeamsBot.IDLE_TIMEOUT_MS
            ? TeamsBot.IDLE_POLL_MS
            : this.opts.pollIntervalMs;
        const delay = Math.min(2_147_483_647, Math.max(interval, this._retryAt - Date.now()));
        this._pollTimer = setTimeout(() => {
            this._pollTimer = null;
            void this.pollMessages();
        }, delay);
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
            if (this.mode === 'graph' && !this.opts.pollGraphChannel?.()) {
                this._lastSeenTimestamp = null;
                this.schedulePoll();
                return;
            }
            const since = this.mode === 'graph' ? this._lastSeenTimestamp ?? undefined : this._lastPolledId ?? undefined;
            const { messages, nextSince } = await this.transport.poll(this._channelId, since);

            let activity = false;
            if (this.mode === 'mcp') {
                activity = await this.handleMcpPoll(messages, nextSince);
            } else {
                await this.handleGraphPoll(messages, nextSince);
            }

            this.observePoll('success');
            this._rateLimitFailures = 0;
            this._retryAt = 0;
            if (activity) {
                this._lastActivityTime = Date.now();
            }
            if (this._lastError) {
                this._lastError = null;
                this.setStatus('connected');
            }
        } catch (err: any) {
            this.observePoll('failure');
            if (err instanceof McpHttpError && err.status === 429) {
                this._rateLimitFailures++;
                const cap = Math.min(TeamsBot.MAX_BACKOFF_MS,
                    this.opts.pollIntervalMs * 2 ** Math.min(this._rateLimitFailures, 20));
                const delay = err.retryAfterMs ?? Math.round(cap * (0.5 + Math.random() * 0.5));
                this._retryAt = Date.now() + delay;
            }
            if (err.message?.includes('401') && !this._refreshingToken) {
                if (!await this.refreshToken()) {
                    const message = this._lastError ?? err.message ?? 'Teams polling authorization failed';
                    this._lastError = message;
                    this.reportPollError(message);
                }
            } else {
                console.error(`[teams-bot] ${this.mode} poll error:`, err.message);
                const message = err.message ?? 'Teams polling failed';
                this._lastError = message;
                this.reportPollError(message);
            }
        }

        // Schedule next poll (adaptive interval based on activity)
        if (this._status === 'connected') this.schedulePoll();
    }

    private reportPollError(message: string): void {
        try { this.opts.onError?.(message); } catch (err) {
            console.error('[teams-bot] Error reporting poll failure:', err);
        }
    }

    /** Channel polls process unseen IDs; DM polls retain last-message routing. */
    private async handleMcpPoll(messages: InboundTeamsMessage[], nextSince: string): Promise<boolean> {
        if (this.opts.teamId && (this._channelBatchPolling || this.opts.pollChannelReplies?.())) {
            const initial = !this._channelBatchPolling;
            let activity = false;
            this._channelBatchPolling = true;
            this._channelBaselineTime ??= Date.now();
            for (const msg of messages) {
                if (this._seenChannelMessageIds.has(msg.messageId)) continue;
                const discoveredHistoricalReply = !!msg.replyToMessageId
                    && msg.initializationReplay === true
                    && this.transport instanceof McpTransport
                    && this.transport.hasDiscoveredRoot(msg.channelId, msg.replyToMessageId);
                const timestamp = msg.createdDateTime ? Date.parse(msg.createdDateTime) : NaN;
                const historicalSelectionReplay = discoveredHistoricalReply
                    && Number.isFinite(timestamp)
                    && timestamp <= this._channelBaselineTime
                    && isHistoricalSelectionCommand(msg.text);
                if (msg.initializationReplay
                    && this.transport instanceof McpTransport
                    && this.transport.hasDiscoveredRoot(msg.channelId, msg.replyToMessageId ?? msg.messageId)
                    && (!Number.isFinite(timestamp) || timestamp <= this._channelBaselineTime)
                    && !historicalSelectionReplay) {
                    this._seenChannelMessageIds.add(msg.messageId);
                    continue;
                }
                const trackedReply = !!msg.replyToMessageId
                    && (this.opts.channelThreadRoots?.(msg.channelId).includes(msg.replyToMessageId)
                        || (this.transport instanceof McpTransport
                            && this.transport.hasDiscoveredRoot(msg.channelId, msg.replyToMessageId)));
                if (initial && !trackedReply) {
                    this._seenChannelMessageIds.add(msg.messageId);
                    continue;
                }
                if (this._sentMessageIds.delete(msg.messageId) || this.opts.isOwnChannelReply?.(msg)) {
                    this.observeInbound('skipped', 'own');
                } else if (trackedReply && this.opts.isKnownChannelReply?.(msg)) {
                    this.observeInbound('skipped', 'unchanged');
                } else if (!msg.text.trim()) {
                    this.observeInbound('skipped', 'empty');
                } else if (this.isBotFormattedMessage(msg.text)) {
                    this.observeInbound('skipped', 'bot');
                } else {
                    this.observeInbound('observed');
                    await this.opts.onMessage({
                        ...msg,
                        ...(initial && trackedReply ? { initializationReplay: true } : {}),
                        ...(historicalSelectionReplay ? { historicalSelectionReplay: true } : {}),
                    });
                    activity = true;
                }
                this._seenChannelMessageIds.add(msg.messageId);
                if (this._seenChannelMessageIds.size > 1000) {
                    this._seenChannelMessageIds.delete(this._seenChannelMessageIds.values().next().value!);
                }
            }
            if (initial) {
                this._lastPolledId = messages.at(-1)?.messageId ?? nextSince ?? '';
                this.observeInbound('skipped', 'initial');
            }
            return activity;
        }
        if (messages.length === 0) {
            if (!this._lastPolledId && nextSince) this._lastPolledId = nextSince;
            return false;
        }

        const lastMsg = messages[messages.length - 1];

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
            this.observeInbound('skipped', 'initial');
            if (this.debug) console.log(`[teams-bot] First poll — setting watermark to ${lastMsg.messageId}`);
            return false;
        }

        // No new message since last poll
        if (lastMsg.messageId === this._lastPolledId) {
            this.observeInbound('skipped', 'unchanged');
            return false;
        }

        // Update watermark
        this._lastPolledId = lastMsg.messageId;

        if (this._sentMessageIds.has(lastMsg.messageId)) {
            if (this.debug) console.log(`[teams-bot] Skipping own sent message: ${lastMsg.messageId}`);
            this._sentMessageIds.delete(lastMsg.messageId);
            this.observeInbound('skipped', 'own');
            return false;
        }

        if (!lastMsg.text.trim()) {
            this.observeInbound('skipped', 'empty');
            return false;
        }

        // Skip bot-formatted messages (CoC outbound format)
        if (this.isBotFormattedMessage(lastMsg.text)) {
            this.observeInbound('skipped', 'bot');
            if (this.debug) console.log(`[teams-bot] Skipping bot-formatted message: ${lastMsg.messageId}`);
            return false;
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
        this.observeInbound('observed');
        await this.opts.onMessage(lastMsg).catch((err) => {
            console.error('[teams-bot] Error handling message:', err);
        });
        return true;
    }

    /** Graph poll logic: process all new messages since last timestamp. */
    private async handleGraphPoll(messages: InboundTeamsMessage[], nextSince: string): Promise<void> {
        if (!this._lastSeenTimestamp) {
            this._lastSeenTimestamp = nextSince || new Date().toISOString();
            this.observeInbound('skipped', 'initial');
            return;
        }
        for (const msg of messages) {
            if (this._sentMessageIds.has(msg.messageId)) {
                this._sentMessageIds.delete(msg.messageId);
                this.observeInbound('skipped', 'own');
                continue;
            }
            if (!msg.text.trim()) {
                this.observeInbound('skipped', 'empty');
                continue;
            }
            if (this.isBotFormattedMessage(msg.text)) {
                this.observeInbound('skipped', 'bot');
                continue;
            }

            this.observeInbound('observed');
            await this.opts.onMessage(msg).catch((err) => {
                console.error('[teams-bot] Error handling message:', err);
            });
        }
        if (nextSince) this._lastSeenTimestamp = nextSince;
    }

    private observePoll(outcome: 'success' | 'failure'): void {
        try { this.opts.onPoll?.(outcome); } catch { /* Observability cannot affect polling. */ }
    }

    private observeInbound(outcome: 'observed' | 'skipped', reason?: 'initial' | 'unchanged' | 'own' | 'empty' | 'bot'): void {
        try { this.opts.onInbound?.(outcome, reason); } catch { /* Observability cannot affect routing. */ }
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
