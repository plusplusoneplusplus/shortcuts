/**
 * TeamsBridge — glue between WS relay / agent proxy and TeamsBot.
 *
 * Only imported via dynamic import when messaging.teams.enabled is true.
 * Uses MCP server for communication (Graph API disabled — az CLI tokens lack Chat permissions).
 * The transport is abstracted behind the TeamsTransport interface.
 *
 * Outbound flow:
 * - Subscribes to the same WS relay that feeds the web client (no extra connections).
 * - On process-updated (running): HTTP-fetches process, forwards new user turns,
 *   tracks last assistant content.
 * - On process-updated (completed): sends the last tracked message to Teams.
 */

import type { InboundTeamsMessage, BotStatus, TeamsTransport } from '@plusplusoneplusplus/teams-bot';
import { TeamsBot, createTransport, acquireMcpOAuthToken } from '@plusplusoneplusplus/teams-bot';
import type { WebSocketRelay, WSRelayMessage } from '../proxy/ws-relay';
import type { SSERelay, SSEEvent } from '../proxy/sse-relay';
import type { AgentStore } from '../store/agent-store';
import type { TunnelBridge } from '../proxy/tunnel-bridge';
import type { AgentManager } from '../inbound/agent-manager';
import type { ResolvedTeamsConfig } from '../config';
import { MessagingStore } from './messaging-store';
import { TeamsCommandExecutor, type ProcessInfo } from './teams-command-executor';

export interface TeamsBridgeOptions {
    config: ResolvedTeamsConfig;
    dataDir: string;
    wsRelay: WebSocketRelay;
    sseRelay: SSERelay;
    agentStore: AgentStore;
    tunnelBridge: TunnelBridge;
    agentManager: AgentManager;
}

export interface TeamsStatus {
    enabled: boolean;
    status: BotStatus;
    mode: 'graph' | 'mcp';
    error: string | null;
    teamName?: string;
    channelName?: string;
    teamId?: string;
    channelId?: string;
    botName: string;
}

export class TeamsBridge {
    private store: MessagingStore | null = null;
    private bot: TeamsBot | null = null;
    private transport: TeamsTransport;
    private wsHandler: ((msg: WSRelayMessage) => void) | null = null;
    private sseHandler: ((event: SSEEvent) => void) | null = null;
    private reconnectHandler: ((agent: { id: string; name: string }) => void) | null = null;
    private commandExecutor: TeamsCommandExecutor | null = null;
    /** Track latest assistant content per process (updated on each WS event) */
    private _lastAssistantContent = new Map<string, string>();
    private _workspaceNameCache = new Map<string, string>();
    private _azToken: string | null = null;

    constructor(private opts: TeamsBridgeOptions) {
        // Force MCP mode — Graph API is disabled (az CLI tokens lack Chat permissions)
        this.opts.config.mode = 'mcp';
        this.transport = createTransport(opts.config.mode, { mcpServerUrl: opts.config.mcpServerUrl });
    }

    async start(): Promise<void> {
        this.store = new MessagingStore(this.opts.dataDir);

        // Initialize the command executor for handling /slash commands locally
        this.commandExecutor = new TeamsCommandExecutor({
            agentManager: this.opts.agentManager,
            agentStore: this.opts.agentStore,
            messagingStore: this.store,
            fetchProcess: async (agentId, processId, workspaceId) => {
                try {
                    const wsParam = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
                    const res = await this.fetchFromAgent(agentId, `/api/processes/${processId}${wsParam}`);
                    if (!res.ok) return null;
                    const body = await res.json() as Record<string, unknown>;
                    const pd = (body.process ?? body) as Record<string, unknown>;
                    return {
                        id: pd.id as string,
                        status: pd.status as string,
                        title: pd.title as string | undefined,
                        promptPreview: pd.promptPreview as string | undefined,
                        startTime: pd.startTime as string | undefined,
                        workspaceId: pd.workspaceId as string | undefined,
                    };
                } catch { return null; }
            },
            listProcesses: async (agentId, workspaceId) => {
                try {
                    const wsParam = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}&limit=10` : '?limit=10';
                    const res = await this.fetchFromAgent(agentId, `/api/processes${wsParam}`);
                    if (!res.ok) return [];
                    const body = await res.json() as { processes?: Array<Record<string, unknown>> };
                    return (body.processes ?? []).map(p => ({
                        id: p.id as string,
                        status: p.status as string,
                        title: p.title as string | undefined,
                        promptPreview: p.promptPreview as string | undefined,
                        startTime: p.startTime as string | undefined,
                        workspaceId: p.workspaceId as string | undefined,
                    }));
                } catch { return []; }
            },
        });
        console.log('[teams-bridge] Command executor initialized');

        // Resolve team/channel names → IDs (create if missing) using az token
        await this.resolveTeamAndChannel();

        // Ensure we have a token even if resolution was skipped (IDs pre-configured)
        if (!this._azToken) {
            try {
                this._azToken = await acquireMcpOAuthToken(this.opts.config.mcpServerUrl);
            } catch { /* will be handled by bot start */ }
        }

        // When target is 'chat' AND mode is 'mcp', don't pass teamId — triggers DM mode in transport.
        // For graph mode, always use channel mode (az CLI tokens lack ChatMessage.Send for chat API).
        const useChat = this.opts.config.target === 'chat' && this.opts.config.mode === 'mcp';
        if (useChat) {
            console.log(`[teams-bridge] ╔══════════════════════════════════════════════╗`);
            console.log(`[teams-bridge] ║  DIRECT MESSAGE MODE (SendMessageToSelf)     ║`);
            console.log(`[teams-bridge] ║  Messages will be sent to the authenticated  ║`);
            console.log(`[teams-bridge] ║  user's own Teams account.                   ║`);
            console.log(`[teams-bridge] ╚══════════════════════════════════════════════╝`);
        }
        console.log(`[teams-bridge] Creating bot: mode=${this.opts.config.mode}, target=${this.opts.config.target}, teamId=${useChat ? 'omitted (DM self)' : this.opts.config.teamId}`);

        this.bot = new TeamsBot({
            mode: this.opts.config.mode,
            teamId: useChat ? undefined : this.opts.config.teamId,
            mcpServerUrl: this.opts.config.mcpServerUrl,
            botName: this.opts.config.botName,
            pollIntervalMs: this.opts.config.pollIntervalMs,
            debug: this.opts.config.debug ?? false,
            auth: {
                bearerToken: this._azToken ?? undefined,
                clientId: this.opts.config.clientId,
                scope: this.opts.config.scope,
                onTokenRefresh: () => this.refreshMcpToken(),
            },
            onMessage: (msg) => this.onInboundMessage(msg),
            onStatusChange: (status) => {
                console.log(`[teams-bridge] Status changed: ${status}`);
            },
            onError: (error) => {
                console.error(`[teams-bridge] Error: ${error}`);
            },
        });

        // Subscribe to event relays BEFORE waiting for bot connection.
        // Events received before connection completes are harmlessly dropped
        // (the handlers check bot.getStatus() === 'connected').
        // This prevents a slow MCP server from blocking event subscription entirely.
        this.wsHandler = (msg) => this.onWsMessage(msg);
        this.opts.wsRelay.on('message', this.wsHandler);

        this.sseHandler = (event) => this.onSSEEvent(event);
        this.opts.sseRelay.on('event', this.sseHandler);

        // On agent reconnection, poll for missed completions
        this.reconnectHandler = (agent) => this.onAgentReconnected(agent);
        this.opts.agentManager.on('agent-connected', this.reconnectHandler);

        // Start and wait for connection (with timeout to avoid hanging on slow MCP server)
        try {
            await Promise.race([
                this.bot.start(),
                new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Bot start timed out after 30s')), 30_000)),
            ]);
        } catch (err: any) {
            console.error(`[teams-bridge] Start failed: ${err.message ?? err}`);
        }

        // Set the configured channel for polling (if not already set by DM mode)
        if (this.opts.config.channelId && !this.bot.getChannelId()) {
            this.bot.setChannelId(this.opts.config.channelId);
        }
    }

    async stop(): Promise<void> {
        if (this.wsHandler) {
            this.opts.wsRelay.off('message', this.wsHandler);
            this.wsHandler = null;
        }
        if (this.sseHandler) {
            this.opts.sseRelay.off('event', this.sseHandler);
            this.sseHandler = null;
        }
        if (this.reconnectHandler) {
            this.opts.agentManager.off('agent-connected', this.reconnectHandler);
            this.reconnectHandler = null;
        }
        await this.bot?.stop();
        this.bot = null;
        this.store?.close();
        this.store = null;
    }

    /** Refresh OAuth token (called by bot on 401). */
    private async refreshMcpToken(): Promise<string | null> {
        try {
            this._azToken = await acquireMcpOAuthToken(this.opts.config.mcpServerUrl);
            console.log('[teams-bridge] OAuth token refreshed');
            return this._azToken;
        } catch (err: any) {
            console.error(`[teams-bridge] OAuth token refresh failed: ${err.message}`);
            return null;
        }
    }

    /** Get current Teams bridge status for REST API. */
    getTeamsStatus(): TeamsStatus {
        return {
            enabled: true,
            status: this.bot?.getStatus() ?? 'disconnected',
            mode: this.opts.config.mode,
            error: this.bot?.getLastError() ?? null,
            teamName: this.opts.config.teamName,
            channelName: this.opts.config.channelName,
            teamId: this.opts.config.teamId,
            channelId: this.bot?.getChannelId() ?? this.opts.config.channelId,
            botName: this.opts.config.botName,
        };
    }

    /** List Teams channels (for channel picker UI). */
    async listChannels(): Promise<Array<{ id: string; displayName: string }>> {
        if (!this.bot) return [];
        return this.bot.listChannels();
    }

    /** Update mutable config fields and persist to config.yaml. */
    async updateConfig(patch: { botName?: string; channelId?: string; enabled?: boolean; teamName?: string; channelName?: string; mode?: 'graph' | 'mcp' }): Promise<void> {
        if (patch.botName !== undefined) this.opts.config.botName = patch.botName;
        if (patch.channelId !== undefined) {
            this.opts.config.channelId = patch.channelId;
            this.bot?.setChannelId(patch.channelId);
        }
        if (patch.teamName !== undefined) this.opts.config.teamName = patch.teamName;
        if (patch.channelName !== undefined) this.opts.config.channelName = patch.channelName;
        if (patch.enabled !== undefined) this.opts.config.enabled = patch.enabled;
        if (patch.mode !== undefined) this.opts.config.mode = patch.mode;
        await this.persistTeamsConfig(patch as Record<string, string | boolean | undefined>);
    }

    /** Reconnect to Teams. */
    async reconnect(): Promise<void> {
        await this.bot?.stop();

        // Re-acquire token from cached OAuth tokens (refreshes if needed)
        try {
            this._azToken = await acquireMcpOAuthToken(this.opts.config.mcpServerUrl);
        } catch (err: any) {
            console.error(`[teams-bridge] Failed to acquire token on reconnect: ${err.message}`);
        }

        const useChat = this.opts.config.target === 'chat' && this.opts.config.mode === 'mcp';
        this.bot = new TeamsBot({
            mode: this.opts.config.mode,
            teamId: useChat ? undefined : this.opts.config.teamId,
            mcpServerUrl: this.opts.config.mcpServerUrl,
            botName: this.opts.config.botName,
            pollIntervalMs: this.opts.config.pollIntervalMs,
            debug: this.opts.config.debug ?? false,
            auth: {
                bearerToken: this._azToken ?? undefined,
                clientId: this.opts.config.clientId,
                scope: this.opts.config.scope,
                onTokenRefresh: () => this.refreshMcpToken(),
            },
            onMessage: (msg) => this.onInboundMessage(msg),
            onStatusChange: (status) => {
                console.log(`[teams-bridge] Status changed: ${status}`);
            },
            onError: (error) => {
                console.error(`[teams-bridge] Error: ${error}`);
            },
        });
        try {
            await this.bot.start();
        } catch (err) {
            console.error('[teams-bridge] Reconnect start failed:', err);
        }
        if (this.opts.config.channelId && !this.bot.getChannelId()) {
            this.bot.setChannelId(this.opts.config.channelId);
        }
    }

    /**
     * Resolve team/channel names to IDs using the configured transport.
     * Skipped when target is 'chat' (DM mode).
     */
    private async resolveTeamAndChannel(): Promise<void> {
        // In chat (DM) mode, no team/channel resolution needed
        if (this.opts.config.target === 'chat') {
            console.log('[teams-bridge] target=chat — skipping team/channel resolution');
            return;
        }

        // In graph mode without team config, we use direct message (chat) mode
        if (this.opts.config.mode === 'graph' && !this.opts.config.teamName && !this.opts.config.teamId) {
            console.log('[teams-bridge] No team configured — using direct message (chat) mode');
            return;
        }

        // Need team/channel names to resolve
        const teamName = this.opts.config.teamName;
        const channelName = this.opts.config.channelName;
        if (!teamName && !this.opts.config.teamId) {
            console.warn('[teams-bridge] No teamName or teamId configured — cannot resolve');
            return;
        }

        // Acquire token for resolution
        try {
            this._azToken = await acquireMcpOAuthToken(this.opts.config.mcpServerUrl);
        } catch (err: any) {
            console.error(`[teams-bridge] Failed to acquire token for resolution: ${err.message}`);
            return;
        }

        try {
            await this.transport.initialize(this._azToken!, {
                teamId: this.opts.config.teamId,
                channelId: this.opts.config.channelId,
            });

            if (teamName && !this.opts.config.teamId) {
                const result = await this.transport.resolveTeamAndChannel(
                    teamName,
                    channelName ?? 'General',
                );
                this.opts.config.teamId = result.teamId;
                this.opts.config.channelId = result.channelId;
                console.log(`[teams-bridge] Resolved team "${teamName}" → ${result.teamId}, channel "${channelName}" → ${result.channelId}`);
                await this.persistTeamsConfig({ teamId: result.teamId, channelId: result.channelId });
            } else if (this.opts.config.teamId && channelName && !this.opts.config.channelId) {
                const channels = await this.transport.listChannels(this.opts.config.teamId);
                const channel = channels.find(c => c.displayName.toLowerCase() === channelName.toLowerCase());
                if (channel) {
                    this.opts.config.channelId = channel.id;
                    console.log(`[teams-bridge] Resolved channel "${channelName}" → ${channel.id}`);
                    await this.persistTeamsConfig({ channelId: channel.id });
                } else if (teamName) {
                    // Channel not found — use resolveTeamAndChannel which creates if missing
                    console.log(`[teams-bridge] Channel "${channelName}" not found, creating...`);
                    const result = await this.transport.resolveTeamAndChannel(teamName, channelName);
                    this.opts.config.channelId = result.channelId;
                    console.log(`[teams-bridge] Created channel "${channelName}" → ${result.channelId}`);
                    await this.persistTeamsConfig({ channelId: result.channelId });
                } else {
                    console.warn(`[teams-bridge] Channel "${channelName}" not found and no teamName to create it`);
                }
            }
        } catch (err: any) {
            console.error(`[teams-bridge] Failed to resolve team/channel: ${err.message}`);
        } finally {
            this.transport.stop();
        }
    }

    /** Save Teams config fields to the config file. */
    private async persistTeamsConfig(fields: Record<string, string | boolean | undefined>): Promise<void> {
        try {
            const fs = await import('fs');
            const path = await import('path');
            const jsYaml = await import('js-yaml');
            const configPath = path.join(this.opts.dataDir, 'config.yaml');
            let doc: Record<string, any> = {};
            try {
                const raw = fs.readFileSync(configPath, 'utf8');
                doc = (jsYaml.load(raw) as Record<string, any>) ?? {};
            } catch { /* file doesn't exist yet */ }
            if (!doc.messaging) doc.messaging = {};
            if (!doc.messaging.teams) doc.messaging.teams = {};
            for (const [key, value] of Object.entries(fields)) {
                if (value !== undefined) {
                    doc.messaging.teams[key] = value;
                }
            }
            fs.writeFileSync(configPath, jsYaml.dump(doc), 'utf8');
            console.log(`[teams-bridge] Saved config to ${configPath}`);
        } catch (err) {
            console.error('[teams-bridge] Failed to persist config:', err);
        }
    }

    // ── Reconnection catchup: poll agent for missed completions ──

    /**
     * When an agent reconnects after a WebSocket gap, poll it for any
     * recently-completed processes whose completion event we missed.
     */
    private async onAgentReconnected(agent: { id: string; name: string }): Promise<void> {
        if (!this.bot || !this.store) return;
        if (this.bot.getStatus() !== 'connected') return;

        const agentId = agent.id;
        const recentProcesses = this.store.getRecentProcesses(agentId);
        if (recentProcesses.length === 0) return;

        console.log(`[teams-bridge] 🔄 Agent "${agent.name}" reconnected — checking ${recentProcesses.length} recent process(es) for missed completions`);

        for (const { processId, workspaceId } of recentProcesses) {
            if (this.store!.isCompletionSent(processId)) continue;

            try {
                const wsParam = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
                const res = await this.fetchFromAgent(agentId, `/api/processes/${processId}${wsParam}`);
                if (!res.ok) continue;

                const body = await res.json() as Record<string, unknown>;
                const processData = (body.process ?? body) as Record<string, unknown>;
                const status = processData.status as string;

                if (status !== 'completed') continue;

                console.log(`[teams-bridge] 🔄 Missed completion detected for process ${processId} — sending to Teams`);
                const msg: WSRelayMessage = { agentId, agentName: agent.name, data: JSON.stringify({ type: 'process-updated', process: processData }) };
                await this.handleCompletion(processId, msg, processData);
            } catch (err) {
                console.error(`[teams-bridge] 🔄 Error checking process ${processId} on reconnect:`, err);
            }
        }
    }

    // ── Outbound: CoC process update → Teams ────────────
    // Teams-bridge subscribes to BOTH the WS relay and the SSE relay.
    // Each relay carries different data:
    //
    // WS Relay (WSRelayMessage):
    //   - data: JSON string with { type, process: ProcessSummary }
    //   - ProcessSummary has: id, status, title, lastMessagePreview (~120 chars)
    //   - Used for: detecting status changes (running → completed)
    //
    // SSE Relay (SSEEvent):
    //   - event: SSE event name (e.g., "process-updated", "chunk")
    //   - data: JSON string payload (varies by event type)
    //   - id: optional event ID for resumability
    //   - Used for: future per-event-type handling (e.g., streaming chunks)
    //
    // On process-updated events (from either relay):
    // - running: fetch process, forward new user turns, track last assistant content
    // - completed: send the last tracked assistant content (or task_complete summary) to Teams

    /**
     * Handle WS relay messages.
     * WS relay delivers: { agentId, agentName, data: "<JSON>" }
     * where data contains { type: "process-updated", process: ProcessSummary }
     */
    private async onWsMessage(msg: WSRelayMessage): Promise<void> {
        console.log(`[teams-bridge] onWsMessage called: bot=${!!this.bot} store=${!!this.store} agentId=${msg.agentId} data=${(msg.data ?? '').substring(0, 100)}`);
        if (!this.bot) return;
        if (!this.store) return;

        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(msg.data);
        } catch {
            return;
        }

        if (parsed.type !== 'process-updated') return;
        const proc = parsed.process as Record<string, unknown> | undefined;
        if (!proc) return;

        const status = proc.status as string;
        const processId = proc.id as string;
        if (!processId) return;

        console.log(`[teams-bridge] 📥 WS event: process=${processId} status=${status}`);

        if (status !== 'completed' && status !== 'running') return;

        if (status === 'completed') {
            await this.handleCompletion(processId, msg, proc);
        } else {
            await this.handleRunning(processId, msg, proc);
        }
    }

    /**
     * Handle SSE relay events.
     * SSE relay delivers: { agentId, agentName, event?: string, data: string, id?: string }
     * The `event` field is the SSE event name (e.g., "process-updated").
     * The `data` field is the JSON payload.
     * The `id` field is the SSE event ID for resumability.
     *
     * Currently SSE relay carries the same process-updated events as WS.
     * In the future, it could carry per-process streaming chunks directly.
     */
    private async onSSEEvent(event: SSEEvent): Promise<void> {
        if (!this.bot) return;
        if (!this.store) return;

        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(event.data);
        } catch {
            return;
        }

        // SSE events have an explicit event name field
        const eventType = event.event || (parsed.type as string) || 'unknown';
        if (eventType !== 'process-updated') return;

        const proc = parsed.process as Record<string, unknown> | undefined;
        if (!proc) return;

        const status = proc.status as string;
        const processId = proc.id as string;
        if (!processId) return;

        console.log(`[teams-bridge] 📥 SSE event: type=${eventType} process=${processId} status=${status}`);

        if (status !== 'completed' && status !== 'running') return;

        // Construct a WSRelayMessage to reuse existing handlers
        const msg: WSRelayMessage = {
            agentId: event.agentId,
            agentName: event.agentName,
            data: event.data,
        };

        if (status === 'completed') {
            await this.handleCompletion(processId, msg, proc);
        } else {
            await this.handleRunning(processId, msg, proc);
        }
    }

    /**
     * Handle running status: fetch process, forward new user turns,
     * track latest assistant content for when completion arrives.
     */
    private async handleRunning(
        processId: string,
        msg: WSRelayMessage,
        proc: Record<string, unknown>,
    ): Promise<void> {
        const agentId = msg.agentId;
        if (!agentId) {
            console.warn(`[teams-bridge] ⚠️ handleRunning skipped: no agentId for process ${processId}`);
            return;
        }
        if (!this.bot || this.bot.getStatus() !== 'connected') {
            console.warn(`[teams-bridge] ⚠️ handleRunning skipped for process ${processId}: bot ${!this.bot ? 'not initialized' : `status=${this.bot.getStatus()}`}`);
            return;
        }

        const workspaceId = (proc.workspaceId ?? proc.workspace) as string || '';

        try {
            const apiPath = `/api/processes/${processId}?workspaceId=${encodeURIComponent(workspaceId)}`;
            console.log(`[teams-bridge] 🔍 Fetching process: ${apiPath} (agent=${agentId})`);
            const res = await this.fetchFromAgent(agentId, apiPath);
            if (!res.ok) {
                console.log(`[teams-bridge] ⚠️ Fetch failed: ${res.status}`);
                return;
            }

            const body = await res.json() as Record<string, unknown>;
            const processData = (body.process ?? body) as Record<string, unknown>;
            const turns = (processData.conversationTurns ?? processData.conversation ?? processData.turns) as Array<{ role: string; content?: string; text?: string; streaming?: boolean }> | undefined;
            if (!turns || turns.length === 0) {
                console.log(`[teams-bridge] ⚠️ No turns in response for ${processId}`);
                return;
            }

            // Log all turns received
            console.log(`[teams-bridge] 📋 Process ${processId}: got ${turns.length} turn(s):`);
            for (let i = 0; i < turns.length; i++) {
                const t = turns[i];
                const content = (t.content ?? t.text ?? '').trim();
                const streaming = t.streaming ? ' [streaming]' : '';
                console.log(`[teams-bridge]   turn[${i}] role=${t.role}${streaming} (${content.length} chars): ${content.substring(0, 80)}`);
            }

            // Forward new user turns (skip slash commands — they should not have been sent to agents)
            let currentUserCount = 0;
            for (const turn of turns) {
                if (turn.role === 'user') currentUserCount++;
            }
            const prevUserCount = this.store!.getUserTurnCount(processId);
            if (currentUserCount > prevUserCount) {
                this.store!.setUserTurnCount(processId, currentUserCount);
                this._lastAssistantContent.delete(processId);

                for (let i = turns.length - 1; i >= 0; i--) {
                    if (turns[i].role === 'user') {
                        const content = (turns[i].content ?? turns[i].text ?? '').trim();
                        if (content && !content.startsWith('/')) {
                            console.log(`[teams-bridge] 📝 New user turn for ${processId} (${content.length} chars): ${content.substring(0, 100)}`);
                            await this.sendToTeams(processId, 'user', content, msg.agentId, msg.agentName, workspaceId);
                        } else if (content.startsWith('/')) {
                            console.log(`[teams-bridge] ⏭️ Skipping command turn for ${processId}: ${content.substring(0, 60)}`);
                        }
                        break;
                    }
                }
            }

            // Track latest assistant content — only keep the LAST non-streaming assistant message
            for (let i = turns.length - 1; i >= 0; i--) {
                const turn = turns[i];
                if (turn.role === 'user') break;
                if (turn.role === 'assistant' && !turn.streaming) {
                    const content = (turn.content ?? turn.text ?? '').trim();
                    if (content) {
                        const prev = this._lastAssistantContent.get(processId);
                        if (prev !== content) {
                            this._lastAssistantContent.set(processId, content);
                            console.log(`[teams-bridge] ✅ Kept as LAST message for ${processId} (turn[${i}], ${content.length} chars): ${content.substring(0, 120)}`);
                        } else {
                            console.log(`[teams-bridge] ⏭️ Same as previous last message, skipping update`);
                        }
                    }
                    break;
                }
            }
        } catch (err) {
            console.log(`[teams-bridge] ❌ Error in handleRunning for ${processId}:`, err);
        }
    }

    /**
     * Handle completion: send final message to Teams.
     * Uses tracked last assistant content or task_complete summary.
     */
    private async handleCompletion(
        processId: string,
        msg: WSRelayMessage,
        proc: Record<string, unknown>,
    ): Promise<void> {
        const agentId = msg.agentId;
        if (!agentId) {
            console.warn(`[teams-bridge] ⚠️ handleCompletion skipped: no agentId for process ${processId}`);
            return;
        }
        if (!this.bot || this.bot.getStatus() !== 'connected') {
            console.warn(`[teams-bridge] ⚠️ handleCompletion skipped for process ${processId}: bot ${!this.bot ? 'not initialized' : `status=${this.bot.getStatus()}`}`);
            return;
        }

        const workspaceId = (proc.workspaceId ?? proc.workspace) as string || '';

        try {
            const apiPath = `/api/processes/${processId}?workspaceId=${encodeURIComponent(workspaceId)}`;
            console.log(`[teams-bridge] 🏁 Completion: fetching process ${processId}`);
            const res = await this.fetchFromAgent(agentId, apiPath);
            if (!res.ok) {
                console.log(`[teams-bridge] ⚠️ Completion fetch failed: ${res.status}`);
                return;
            }

            const body = await res.json() as Record<string, unknown>;
            const processData = (body.process ?? body) as Record<string, unknown>;
            const turns = (processData.conversationTurns ?? processData.conversation ?? processData.turns) as Array<{ role: string; content?: string; text?: string; streaming?: boolean; toolCalls?: Array<{ name: string; toolName?: string; args?: { summary?: string } }>; timeline?: Array<{ type: string; content?: string }> }> | undefined;
            if (!turns || turns.length === 0) {
                console.log(`[teams-bridge] ⚠️ No turns in completion response for ${processId}`);
                return;
            }

            // Log all turns received on completion
            console.log(`[teams-bridge] 🏁 Process ${processId} COMPLETED: got ${turns.length} turn(s):`);
            for (let i = 0; i < turns.length; i++) {
                const t = turns[i];
                const content = (t.content ?? t.text ?? '').trim();
                const streaming = t.streaming ? ' [streaming]' : '';
                const hasToolCalls = t.toolCalls?.length ? ` [${t.toolCalls.length} tool call(s)]` : '';
                console.log(`[teams-bridge]   turn[${i}] role=${t.role}${streaming}${hasToolCalls} (${content.length} chars): ${content.substring(0, 80)}`);
            }

            // Detect new user turns → reset completion tracking for new round
            let currentUserCount = 0;
            for (const turn of turns) {
                if (turn.role === 'user') currentUserCount++;
            }
            const prevUserCount = this.store!.getUserTurnCount(processId);
            if (currentUserCount > prevUserCount) {
                this.store!.setUserTurnCount(processId, currentUserCount);
                this._lastAssistantContent.delete(processId);

                // Forward the new user turn (skip slash commands)
                for (let i = turns.length - 1; i >= 0; i--) {
                    if (turns[i].role === 'user') {
                        const content = (turns[i].content ?? turns[i].text ?? '').trim();
                        if (content && !content.startsWith('/')) {
                            await this.sendToTeams(processId, 'user', content, msg.agentId, msg.agentName, workspaceId);
                        } else if (content.startsWith('/')) {
                            console.log(`[teams-bridge] ⏭️ Skipping command turn in completion for ${processId}: ${content.substring(0, 60)}`);
                        }
                        break;
                    }
                }
            }

            if (this.store!.isCompletionSent(processId)) return;

            // Find last user turn (start of current round)
            let lastUserIdx = -1;
            for (let i = turns.length - 1; i >= 0; i--) {
                if (turns[i].role === 'user') { lastUserIdx = i; break; }
            }

            // Try task_complete summary first
            let content: string | undefined;
            for (let i = turns.length - 1; i > lastUserIdx; i--) {
                const turn = turns[i];
                if (turn.role === 'assistant' && turn.toolCalls) {
                    const tc = turn.toolCalls.find(t => (t.name || t.toolName) === 'task_complete');
                    if (tc?.args?.summary) {
                        content = tc.args.summary;
                        console.log(`[teams-bridge] Process ${processId}: found task_complete summary (${content.length} chars)`);
                        break;
                    }
                }
            }

            // Fallback: last non-streaming assistant turn after last user turn
            if (!content) {
                for (let i = turns.length - 1; i > lastUserIdx; i--) {
                    if (turns[i].role === 'assistant' && !turns[i].streaming) {
                        content = (turns[i].content ?? turns[i].text ?? '').trim();
                        if (content) break;
                    }
                }
            }

            // Final fallback: use tracked content from running events
            if (!content) {
                content = this._lastAssistantContent.get(processId);
            }

            if (content) {
                this.store!.markCompletionSent(processId);
                this._lastAssistantContent.delete(processId);

                // Extract content chunks from the timeline of the last assistant turn.
                // Only send the last chunk — it's the final prose the user cares about;
                // intermediate chunks are just reasoning between tool calls.
                const lastAssistantTurn = (() => {
                    for (let i = turns.length - 1; i > lastUserIdx; i--) {
                        if (turns[i].role === 'assistant' && !turns[i].streaming) return turns[i];
                    }
                    return undefined;
                })();

                const contentChunks = extractTimelineContentChunks(lastAssistantTurn?.timeline);
                const messageToSend = contentChunks.length > 1
                    ? contentChunks[contentChunks.length - 1]
                    : content;

                console.log(`[teams-bridge] *** SENDING FINAL MESSAGE for process ${processId} (${messageToSend.length} chars, from ${contentChunks.length > 1 ? 'last of ' + contentChunks.length + ' chunks' : 'full content'}):\n${messageToSend.substring(0, 300)}`);
                await this.sendToTeams(processId, 'assistant', messageToSend, msg.agentId, msg.agentName, workspaceId);
            }
        } catch (err) {
            console.error(`[teams-bridge] Failed to handle completion for ${processId}:`, err);
        }
    }

    /**
     * Send a command response directly to Teams (not tied to a process).
     */
    private async sendCommandResponse(text: string, originalMsg: InboundTeamsMessage): Promise<void> {
        if (!this.bot) {
            console.warn(`[teams-bridge] ⚠️ sendCommandResponse skipped: bot not initialized`);
            return;
        }
        const target = this.bot.getChannelId() ?? this.opts.config.channelId;
        if (!target) {
            console.warn(`[teams-bridge] ⚠️ sendCommandResponse skipped: no target available`);
            return;
        }
        if (this.bot.getStatus() !== 'connected') {
            console.warn(`[teams-bridge] ⚠️ sendCommandResponse skipped: bot status=${this.bot.getStatus()}`);
            return;
        }

        // Format: sender name + command response
        const senderName = originalMsg.senderName ?? 'User';
        const formatted = `**${senderName}** ${text}`;

        try {
            const mentions = originalMsg.senderAadId && originalMsg.senderName
                ? [{ aadId: originalMsg.senderAadId, displayName: originalMsg.senderName }]
                : undefined;
            const messageId = await this.bot.send(target, formatted, { mentions });
            console.log(`[teams-bridge] ✅ Command response sent: ${messageId} (${text.length} chars)`);
        } catch (err: any) {
            console.error(`[teams-bridge] ❌ Failed to send command response: ${err.message}`);
        }
    }

    /**
     * Send a message to Teams for a given process.
     */
    private async sendToTeams(
        processId: string,
        role: string,
        content: string,
        agentId: string,
        agentName: string,
        workspaceId: string,
    ): Promise<void> {
        if (!this.bot || !this.store) {
            console.warn(`[teams-bridge] ⚠️ sendToTeams skipped for process ${processId}: ${!this.bot ? 'bot not initialized' : 'store not initialized'}`);
            return;
        }

        let target = this.bot.getChannelId() ?? this.opts.config.channelId;
        if (!target) {
            console.warn(`[teams-bridge] ⚠️ sendToTeams skipped for process ${processId}: no target (chatId/channelId) available`);
            return;
        }

        if (this.bot.getStatus() !== 'connected') {
            console.warn(`[teams-bridge] ⚠️ sendToTeams skipped for process ${processId}: bot status=${this.bot.getStatus()}`);
            return;
        }

        const repoName = await this.resolveWorkspaceName(undefined, undefined, workspaceId, agentId);

        // Fetch process title
        let title = '';
        if (agentId) {
            try {
                const res = await this.fetchFromAgent(agentId, `/api/processes/${processId}?workspaceId=${encodeURIComponent(workspaceId)}`);
                if (res.ok) {
                    const body = await res.json() as Record<string, unknown>;
                    const pd = (body.process ?? body) as Record<string, unknown>;
                    title = (pd.title ?? '') as string;
                }
            } catch { /* ignore */ }
        }

        const sender = this.store.getProcessSender(processId);
        const teamsText = this.formatOutboundMessage({
            role,
            agent: agentName,
            repo: repoName,
            title,
            content,
            botName: this.opts.config.botName,
            mentionName: sender?.senderName,
            processId,
        });

        try {
            const mentions = sender
                ? [{ aadId: sender.senderAadId, displayName: sender.senderName }]
                : undefined;
            const messageId = await this.bot.send(target, teamsText, { mentions });
            console.log(`[teams-bridge] ✅ Sent message ${messageId} for process ${processId} (role=${role}, ${content.length} chars)`);
            this.store.bindMessage(messageId, processId, agentId, `${agentName}:${repoName}`, workspaceId);

            // Reset forceNewTopic for the sender — agent has responded, session is active
            if (sender?.senderAadId && this.commandExecutor) {
                const state = this.commandExecutor.getUserState(sender.senderAadId);
                if (state.forceNewTopic) {
                    this.commandExecutor.updateUserState(sender.senderAadId, { forceNewTopic: false });
                }
            }
        } catch (err: any) {
            if (err?.message?.includes('NotFound') && this.opts.config.teamName) {
                console.warn(`[teams-bridge] Channel NotFound — re-resolving...`);
                this.opts.config.channelId = undefined;
                this.opts.config.teamId = undefined;
                await this.resolveTeamAndChannel();
                const newTarget = this.bot.getChannelId();
                if (newTarget && newTarget !== target) {
                    target = newTarget;
                    try {
                        const mentions = sender
                            ? [{ aadId: sender.senderAadId, displayName: sender.senderName }]
                            : undefined;
                        const messageId = await this.bot.send(target, teamsText, { mentions });
                        console.log(`[teams-bridge] ✅ Sent message ${messageId} (after re-resolve) for process ${processId}`);
                        this.store.bindMessage(messageId, processId, agentId, `${agentName}:${repoName}`, workspaceId);
                    } catch (retryErr) {
                        console.error('[teams-bridge] Retry after re-resolve also failed:', retryErr);
                    }
                }
            } else {
                console.error('[teams-bridge] Failed to send outbound message:', err);
            }
        }
    }

    /** Format a structured Teams message for desktop display. */
    formatOutboundMessage(opts: { role: string; agent: string; repo: string; title: string; content: string; botName?: string; mentionName?: string; processId?: string }): string {
        const sender = opts.role === 'user'
            ? (opts.botName || 'User')
            : 'CoC Agent';

        const lines = [
            // Prepend @mention tag so Teams generates a notification
            ...(opts.mentionName ? [`<at id="0">${opts.mentionName}</at>`] : []),
            `${sender}:`,
            `Agent: ${opts.agent}`,
            `Repo: ${opts.repo}`,
        ];
        if (opts.title) {
            lines.push(`Title: ${opts.title}`);
        }
        if (opts.processId) {
            lines.push(`ChatId: ${opts.processId}`);
        }
        // Replace \n in content with <br> as well
        lines.push('Message:', opts.content.trimStart().replace(/\n/g, '<br>'));

        return lines.join('<br>');
    }

    /** Resolve a workspace ID to a human-readable name. */
    private async resolveWorkspaceName(
        wsEventName: string | undefined,
        metadataName: string | undefined,
        workspaceId: string,
        agentId: string,
    ): Promise<string> {
        if (wsEventName) return wsEventName;
        if (metadataName) return metadataName;
        if (!workspaceId) return 'unknown';

        const cached = this._workspaceNameCache.get(workspaceId);
        if (cached) return cached;

        if (!agentId) return workspaceId;
        try {
            const res = await this.fetchFromAgent(agentId, '/api/workspaces');
            if (res.ok) {
                const data = await res.json() as { workspaces?: Array<{ id: string; name: string }> };
                for (const ws of data.workspaces ?? []) {
                    if (ws.name) this._workspaceNameCache.set(ws.id, ws.name);
                }
                const name = this._workspaceNameCache.get(workspaceId);
                if (name) return name;
            }
        } catch { /* ignore */ }

        return workspaceId;
    }

    // ── Inbound: Teams message → CoC session ──────────
    private async onInboundMessage(msg: InboundTeamsMessage): Promise<void> {
        if (!this.store) return;

        const text = msg.text.trim();
        const _debug = this.opts.config.debug ?? false;

        console.log(`[teams-bridge] 📨 Inbound message: id=${msg.messageId}, sender=${msg.senderName ?? 'unknown'}, text="${text.substring(0, 60)}"`);

        // ── Slash command interception ──
        // ALL messages starting with / are handled locally, NEVER forwarded to agents.
        if (text.startsWith('/')) {
            if (this.commandExecutor) {
                console.log(`[teams-bridge] 🔧 Detected slash command: "${text.substring(0, 60)}"`);
                const result = await this.commandExecutor.tryExecute(msg);
                if (result.handled && result.response) {
                    console.log(`[teams-bridge] 🔧 Command executed locally, sending response (${result.response.length} chars)`);
                    await this.sendCommandResponse(result.response, msg);
                    console.log(`[teams-bridge] 🔧 Command response sent to Teams`);
                } else {
                    // Unknown /command — respond with help hint, still don't forward
                    console.log(`[teams-bridge] 🔧 Unknown slash command: "${text.substring(0, 60)}" — not forwarding to agent`);
                    await this.sendCommandResponse(`❓ Unknown command: \`${text.split(/\s/)[0]}\`<br>Type \`/help\` for available commands.`, msg);
                }
            } else {
                console.log(`[teams-bridge] 🔧 Slash command received but executor not initialized — ignoring`);
            }
            return;
        }

        let processId: string | undefined;
        let agentId: string | undefined;
        let workspaceId: string | undefined;
        let isFollowUp = false;

        if (_debug) console.log(`[teams-bridge] onInboundMessage: id=${msg.messageId}, replyToMessageId=${msg.replyToMessageId ?? '(none)'}, sender=${msg.senderName}, text="${text.substring(0, 60)}"`);

        // Check if replying to a specific bot message → continue that session
        if (msg.replyToMessageId) {
            const entry = this.store.lookupMessage(msg.replyToMessageId);
            if (_debug) console.log(`[teams-bridge] lookupMessage(${msg.replyToMessageId}) → ${entry ? `processId=${entry.processId}, agentId=${entry.agentId}` : 'NOT FOUND'}`);
            if (entry) {
                processId = entry.processId;
                agentId = entry.agentId;
                workspaceId = entry.workspaceId;
                isFollowUp = true;
            }
        }

        // [chatId] prefix → route to specific chat session (workaround for MCP not providing replyToId)
        const chatIdPrefix = /^\[([^\]]+)\]\s*/;
        if (!isFollowUp && chatIdPrefix.test(text)) {
            const match = text.match(chatIdPrefix)!;
            const targetProcessId = match[1];
            const stripped = text.replace(chatIdPrefix, '');
            if (_debug) console.log(`[teams-bridge] [chatId] prefix detected: processId="${targetProcessId}", message="${stripped.substring(0, 60)}"`);
            // Look up agent/workspace from an existing message binding for this process
            const lastMsgId = this.store.getLastMessageId(targetProcessId);
            if (lastMsgId) {
                const entry = this.store.lookupMessage(lastMsgId);
                if (entry) {
                    processId = entry.processId;
                    agentId = entry.agentId;
                    workspaceId = entry.workspaceId;
                    isFollowUp = true;
                    msg = { ...msg, text: stripped };
                    if (_debug) console.log(`[teams-bridge] ✓ Routed to processId=${processId}, agentId=${agentId}`);
                }
            }
            if (!isFollowUp) {
                // Process ID given but no stored binding — use it directly with default agent
                processId = targetProcessId;
                isFollowUp = true;
                msg = { ...msg, text: stripped };
                if (_debug) console.log(`[teams-bridge] ✓ Using processId=${processId} directly (no stored binding)`);
            }
        }

        // [global] prefix → switch to global session
        const globalPrefix = /^\[global\]\s*/i;
        if (!isFollowUp && globalPrefix.test(text)) {
            const stripped = text.replace(globalPrefix, '');
            const senderId = msg.senderAadId ?? msg.senderName ?? 'unknown';
            const existing = this.store.getGlobalSession(senderId);
            if (existing) {
                processId = existing.processId;
                agentId = existing.agentId;
                isFollowUp = true;
                msg = { ...msg, text: stripped };
            } else {
                msg = { ...msg, text: stripped };
                ({ processId, agentId } = await this.resolveGlobalSession(senderId, stripped));
                isFollowUp = false;
            }
        }

        // Check if command executor flagged "force new topic" for this user
        const userKey = msg.senderAadId ?? msg.senderName ?? 'unknown';
        const forceNew = this.commandExecutor?.getUserState(userKey)?.forceNewTopic ?? false;

        // No reply, no [global] → continue the last active session (unless forced new)
        if (!isFollowUp && !processId && !forceNew) {
            const last = this.store.getLastActiveSession();
            if (last) {
                processId = last.processId;
                agentId = last.agentId;
                workspaceId = last.workspaceId;
                isFollowUp = true;
            }
        }

        // Still nothing (or forced new) → create a new chat via global session
        const senderId = msg.senderAadId ?? msg.senderName ?? 'unknown';
        if (!isFollowUp || !processId || !agentId) {
            if (forceNew) {
                console.log(`[teams-bridge] 🆕 Forced new topic for user ${userKey}`);
                // Clear existing global session so a fresh one is created
                this.store.clearGlobalSession(senderId);
            }
            ({ processId, agentId } = await this.resolveGlobalSession(senderId, msg.text));
            isFollowUp = false;
            // Clear the force flag after creating new session
            if (forceNew) {
                this.commandExecutor?.updateUserState(userKey, { forceNewTopic: false });
            }
        }

        if (!agentId) {
            console.error(`[teams-bridge] No agent resolved for message`);
            return;
        }

        // Save sender info so outbound messages can @mention them
        if (processId && msg.senderAadId && msg.senderName) {
            this.store.setProcessSender(processId, msg.senderAadId, msg.senderName);
        }

        try {
            if (isFollowUp) {
                const wsParam = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
                const apiPath = `/api/processes/${processId}/message${wsParam}`;
                const res = await this.fetchFromAgent(agentId, apiPath, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: msg.text }),
                });
                if (!res.ok) {
                    console.error(`[teams-bridge] Follow-up failed: ${res.status}`);
                }
            } else {
                console.log(`[teams-bridge] New chat created: ${processId}`);
            }
        } catch (err) {
            console.error('[teams-bridge] Failed to send inbound message:', err);
        }
    }

    // ── Global session ────────────────────────────────────
    private async resolveGlobalSession(senderId: string, text: string): Promise<{ processId: string; agentId: string }> {
        if (!this.store) throw new Error('Store not initialized');

        const existing = this.store.getGlobalSession(senderId);
        if (existing) return existing;

        const agentId = this.opts.config.defaultAgentId
            ?? this.opts.agentStore.list().find(a => a.status === 'online')?.id;
        if (!agentId) throw new Error('No online agent available for global session');

        const res = await this.fetchFromAgent(agentId, '/api/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'chat',
                payload: { workspaceId: 'ws-global', prompt: text, mode: 'ask' },
            }),
        });
        const { id: processId } = await res.json() as { id: string };
        this.store.setGlobalSession(senderId, processId, agentId);
        return { processId, agentId };
    }

    private getAgentAddress(agentId: string): string | undefined {
        const localUrl = this.opts.tunnelBridge.getLocalUrl(agentId);
        if (localUrl) return localUrl;
        return this.opts.agentStore.get(agentId)?.address;
    }

    /**
     * Fetch from an agent — routes through WSRelay for call-home agents,
     * or uses direct HTTP fetch for tunnel/direct agents.
     */
    private async fetchFromAgent(agentId: string, apiPath: string, options?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }> {
        // First: check if agentId IS the inbound registration ID directly
        if (this.opts.agentManager?.hasAgent(agentId)) {
            return this.proxyViaRelay(agentId, apiPath, options);
        }

        // Second: look up in agent store (agentId may be the store UUID)
        let agent = this.opts.agentStore.get(agentId);
        if (!agent) {
            // Fallback: look up by address pattern (event agentId = inbound registration ID)
            agent = this.opts.agentStore.list().find(a => a.address === `inbound://${agentId}`);
        }
        if (!agent) {
            return { ok: false, status: 404, json: async () => ({ error: 'Agent not found' }), text: async () => 'Agent not found' };
        }

        // For inbound agents found in store, extract inboundId and proxy via relay
        if (agent.address.startsWith('inbound://')) {
            const inboundId = agent.address.replace('inbound://', '');
            if (!this.opts.agentManager?.hasAgent(inboundId)) {
                return { ok: false, status: 503, json: async () => ({ error: 'Agent not connected' }), text: async () => 'Agent not connected' };
            }
            return this.proxyViaRelay(inboundId, apiPath, options);
        }

        // Direct HTTP fetch for tunnel/direct agents
        const localUrl = this.opts.tunnelBridge.getLocalUrl(agentId);
        const baseUrl = localUrl || agent.address;
        const url = `${baseUrl}${apiPath}`;
        const res = await fetch(url, {
            method: options?.method ?? 'GET',
            headers: options?.headers ? { ...options.headers } : undefined,
            body: options?.body,
        });
        return res;
    }

    /** Proxy an HTTP request to an agent via WSRelay → AgentManager. */
    private async proxyViaRelay(agentId: string, apiPath: string, options?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }> {
        try {
            const resp = await this.opts.wsRelay.proxyToAgent(
                agentId,
                options?.method ?? 'GET',
                apiPath,
                options?.headers ?? {},
                options?.body,
            );
            const ok = resp.status >= 200 && resp.status < 300;
            return {
                ok,
                status: resp.status,
                json: async () => JSON.parse(resp.body || '{}'),
                text: async () => resp.body || '',
            };
        } catch (err) {
            return { ok: false, status: 502, json: async () => ({ error: (err as Error).message }), text: async () => (err as Error).message };
        }
    }
}

/**
 * Extract content chunks from a turn's timeline array.
 * Each timeline item with type === 'content' represents a separate prose chunk
 * emitted between tool calls during streaming. Returns the non-empty chunks
 * in order, or an empty array if no usable timeline is available.
 */
export function extractTimelineContentChunks(
    timeline: Array<{ type: string; content?: string }> | undefined | null,
): string[] {
    if (!timeline || !Array.isArray(timeline) || timeline.length === 0) return [];
    const chunks: string[] = [];
    for (const item of timeline) {
        if (item.type === 'content' && item.content?.trim()) {
            chunks.push(item.content.trim());
        }
    }
    return chunks;
}
