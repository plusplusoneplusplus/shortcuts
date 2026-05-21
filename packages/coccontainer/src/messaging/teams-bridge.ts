/**
 * TeamsBridge — glue between WS relay / agent proxy and TeamsBot.
 *
 * Only imported via dynamic import when messaging.teams.enabled is true.
 * Uses the Teams MCP server for all communication (send, poll, resolve).
 * On startup, resolves team/channel names to IDs via MCP tools.
 */

import type { InboundTeamsMessage, BotStatus } from '@plusplusoneplusplus/teams-bot';
import { TeamsBot, GraphClient, McpClient, acquireTokenViaAzCli, acquireMcpOAuthToken } from '@plusplusoneplusplus/teams-bot';
import type { WebSocketRelay, WSRelayMessage } from '../proxy/ws-relay';
import type { AgentStore } from '../store/agent-store';
import type { TunnelBridge } from '../proxy/tunnel-bridge';
import type { ResolvedTeamsConfig } from '../config';
import { MessagingStore } from './messaging-store';

export interface TeamsBridgeOptions {
    config: ResolvedTeamsConfig;
    dataDir: string;
    wsRelay: WebSocketRelay;
    agentStore: AgentStore;
    tunnelBridge: TunnelBridge;
}

export interface TeamsStatus {
    enabled: boolean;
    status: BotStatus;
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
    private wsHandler: ((msg: WSRelayMessage) => void) | null = null;
    private _processingLocks = new Set<string>();
    private _runningLocks: Set<string> | undefined;
    private _workspaceNameCache = new Map<string, string>();
    private _azToken: string | null = null;

    constructor(private opts: TeamsBridgeOptions) {}

    async start(): Promise<void> {
        this.store = new MessagingStore(this.opts.dataDir);

        // Resolve team/channel names → IDs (create if missing) using az token
        await this.resolveTeamAndChannel();

        // Ensure we have a token even if resolution was skipped (IDs pre-configured)
        if (!this._azToken && this.opts.config.mode === 'mcp') {
            try {
                this._azToken = await acquireMcpOAuthToken(this.opts.config.mcpServerUrl);
            } catch { /* will be handled by bot start */ }
        }

        this.bot = new TeamsBot({
            mode: this.opts.config.mode,
            teamId: this.opts.config.teamId,
            mcpServerUrl: this.opts.config.mcpServerUrl,
            botName: this.opts.config.botName,
            pollIntervalMs: this.opts.config.pollIntervalMs,
            auth: {
                bearerToken: this._azToken ?? undefined,
                clientId: this.opts.config.clientId,
                scope: this.opts.config.scope,
            },
            onMessage: (msg) => this.onInboundMessage(msg),
            onStatusChange: (status) => {
                console.log(`[teams-bridge] Status changed: ${status}`);
            },
            onError: (error) => {
                console.error(`[teams-bridge] Error: ${error}`);
            },
        });

        // Start in background
        this.bot.start().catch(err => console.error('[teams-bridge] Start failed:', err));

        // Set the configured channel for polling
        if (this.opts.config.channelId) {
            this.bot.setChannelId(this.opts.config.channelId);
        }

        this.wsHandler = (msg) => this.onWsMessage(msg);
        this.opts.wsRelay.on('message', this.wsHandler);
    }

    async stop(): Promise<void> {
        if (this.wsHandler) {
            this.opts.wsRelay.off('message', this.wsHandler);
            this.wsHandler = null;
        }
        await this.bot?.stop();
        this.bot = null;
        this.store?.close();
        this.store = null;
    }

    /** Get current Teams bridge status for REST API. */
    getTeamsStatus(): TeamsStatus {
        return {
            enabled: true,
            status: this.bot?.getStatus() ?? 'disconnected',
            error: this.bot?.getLastError() ?? null,
            teamName: this.opts.config.teamName,
            channelName: this.opts.config.channelName,
            teamId: this.opts.config.teamId,
            channelId: this.opts.config.channelId,
            botName: this.opts.config.botName,
        };
    }

    /** List Teams channels (for channel picker UI). */
    async listChannels(): Promise<Array<{ id: string; displayName: string }>> {
        if (!this.bot) return [];
        return this.bot.listChannels();
    }

    /** Update mutable config fields and persist to config.yaml. */
    async updateConfig(patch: { botName?: string; channelId?: string; enabled?: boolean; teamName?: string; channelName?: string }): Promise<void> {
        if (patch.botName !== undefined) this.opts.config.botName = patch.botName;
        if (patch.channelId !== undefined) {
            this.opts.config.channelId = patch.channelId;
            this.bot?.setChannelId(patch.channelId);
        }
        if (patch.teamName !== undefined) this.opts.config.teamName = patch.teamName;
        if (patch.channelName !== undefined) this.opts.config.channelName = patch.channelName;
        if (patch.enabled !== undefined) this.opts.config.enabled = patch.enabled;
        await this.persistTeamsConfig(patch as Record<string, string | boolean | undefined>);
    }

    /** Reconnect to Teams. */
    async reconnect(): Promise<void> {
        await this.bot?.stop();

        // Re-acquire token from cached MCP OAuth tokens (refreshes if needed)
        try {
            if (this.opts.config.mode === 'mcp') {
                this._azToken = await acquireMcpOAuthToken(this.opts.config.mcpServerUrl);
            } else {
                this._azToken = await acquireTokenViaAzCli();
            }
        } catch (err: any) {
            console.error(`[teams-bridge] Failed to acquire token on reconnect: ${err.message}`);
        }

        this.bot = new TeamsBot({
            mode: this.opts.config.mode,
            teamId: this.opts.config.teamId,
            mcpServerUrl: this.opts.config.mcpServerUrl,
            botName: this.opts.config.botName,
            pollIntervalMs: this.opts.config.pollIntervalMs,
            auth: {
                bearerToken: this._azToken ?? undefined,
                clientId: this.opts.config.clientId,
                scope: this.opts.config.scope,
            },
            onMessage: (msg) => this.onInboundMessage(msg),
            onStatusChange: (status) => {
                console.log(`[teams-bridge] Status changed: ${status}`);
            },
            onError: (error) => {
                console.error(`[teams-bridge] Error: ${error}`);
            },
        });
        this.bot.start().catch(err => console.error('[teams-bridge] Reconnect start failed:', err));
        if (this.opts.config.channelId) {
            this.bot.setChannelId(this.opts.config.channelId);
        }
    }

    /**
     * Resolve team/channel names to IDs.
     * In MCP mode: uses MCP tools (ListTeams/ListChannels).
     * In Graph mode: uses Graph API (legacy, requires ChannelMessage.Read.All).
     */
    private async resolveTeamAndChannel(): Promise<void> {
        // Already have explicit IDs — no resolution needed
        if (this.opts.config.teamId && this.opts.config.channelId) return;

        // Need team/channel names to resolve
        const teamName = this.opts.config.teamName;
        const channelName = this.opts.config.channelName;
        if (!teamName && !this.opts.config.teamId) {
            console.warn('[teams-bridge] No teamName or teamId configured — cannot resolve');
            return;
        }

        if (this.opts.config.mode === 'mcp') {
            await this.resolveViaMcp(teamName, channelName);
        } else {
            await this.resolveViaGraph(teamName, channelName);
        }
    }

    /** Resolve team/channel IDs using MCP tools. */
    private async resolveViaMcp(teamName?: string, channelName?: string): Promise<void> {
        try {
            this._azToken = await acquireMcpOAuthToken(this.opts.config.mcpServerUrl);
        } catch (err: any) {
            console.error(`[teams-bridge] Failed to acquire MCP OAuth token: ${err.message}`);
            return;
        }

        const mcpClient = new McpClient({
            serverUrl: this.opts.config.mcpServerUrl,
            bearerToken: this._azToken!,
        });

        try {
            await mcpClient.initialize();

            if (teamName && !this.opts.config.teamId) {
                const teamsResult = await mcpClient.callTool('ListTeams', {});
                const teamsText = teamsResult.content?.[0]?.text ?? '{}';
                let teams: Array<{ id: string; displayName: string }> = [];
                try {
                    const parsed = JSON.parse(teamsText);
                    teams = parsed.teams ?? parsed.value ?? (Array.isArray(parsed) ? parsed : []);
                } catch { /* empty */ }

                const team = teams.find(t => t.displayName.toLowerCase() === teamName.toLowerCase());
                if (team) {
                    this.opts.config.teamId = team.id;
                    console.log(`[teams-bridge] Resolved team "${teamName}" → ${team.id}`);
                } else {
                    console.warn(`[teams-bridge] Team "${teamName}" not found via MCP`);
                    return;
                }
            }

            if (this.opts.config.teamId && channelName && !this.opts.config.channelId) {
                const channelsResult = await mcpClient.callTool('ListChannels', {
                    teamId: this.opts.config.teamId,
                });
                const channelsText = channelsResult.content?.[0]?.text ?? '{}';
                let channels: Array<{ id: string; displayName: string }> = [];
                try {
                    const parsed = JSON.parse(channelsText);
                    channels = parsed.channels ?? parsed.value ?? (Array.isArray(parsed) ? parsed : []);
                } catch { /* empty */ }

                const channel = channels.find(c => c.displayName.toLowerCase() === channelName.toLowerCase());
                if (channel) {
                    this.opts.config.channelId = channel.id;
                    console.log(`[teams-bridge] Resolved channel "${channelName}" → ${channel.id}`);
                } else {
                    console.warn(`[teams-bridge] Channel "${channelName}" not found via MCP`);
                    return;
                }
            }

            await this.persistTeamsConfig({
                teamId: this.opts.config.teamId,
                channelId: this.opts.config.channelId,
            });
        } catch (err: any) {
            console.error(`[teams-bridge] Failed to resolve team/channel via MCP: ${err.message}`);
        }
    }

    /** Resolve team/channel IDs using Graph API (legacy). */
    private async resolveViaGraph(teamName?: string, channelName?: string): Promise<void> {

        try {
            this._azToken = await acquireTokenViaAzCli();
        } catch (err: any) {
            console.error(`[teams-bridge] Failed to acquire az token: ${err.message}`);
            return;
        }

        const graph = new GraphClient({ bearerToken: this._azToken });

        try {
            if (teamName && !this.opts.config.teamId) {
                const { teamId, channelId } = await graph.resolveOrCreateTeamAndChannel(
                    teamName,
                    channelName ?? 'General',
                );
                this.opts.config.teamId = teamId;
                this.opts.config.channelId = channelId;
                console.log(`[teams-bridge] Resolved team "${teamName}" → ${teamId}, channel "${channelName}" → ${channelId}`);
                // Persist resolved IDs
                await this.persistTeamsConfig({ teamId, channelId });
            } else if (this.opts.config.teamId && channelName && !this.opts.config.channelId) {
                graph.setTeamId(this.opts.config.teamId);
                let channel = await graph.findChannelByName(channelName);
                if (!channel) {
                    console.log(`[teams-bridge] Channel "${channelName}" not found, creating...`);
                    const channelId = await graph.createChannel(channelName);
                    this.opts.config.channelId = channelId;
                } else {
                    this.opts.config.channelId = channel.id;
                }
                console.log(`[teams-bridge] Resolved channel "${channelName}" → ${this.opts.config.channelId}`);
                await this.persistTeamsConfig({ channelId: this.opts.config.channelId });
            }
        } catch (err: any) {
            console.error(`[teams-bridge] Failed to resolve team/channel: ${err.message}`);
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

    // ── Outbound: CoC process update → Teams ────────────
    private async onWsMessage(msg: WSRelayMessage): Promise<void> {
        if (!this.bot) { console.log('[teams-bridge] WS ignored: bot is null'); return; }
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

        if (status !== 'completed' && status !== 'running') return;

        // For completed processes, skip if already processed (permanent lock)
        if (this._processingLocks.has(processId)) return;

        // For running processes, use a temporary lock to prevent concurrent processing
        // but allow re-entry on subsequent events (watermark prevents duplicate sends)
        if (status === 'completed') {
            this._processingLocks.add(processId);
        } else {
            // running: if currently being processed, skip this event
            // (the watermark will catch up on the next event)
            if (this._runningLocks?.has(processId)) return;
            if (!this._runningLocks) this._runningLocks = new Set();
            this._runningLocks.add(processId);
        }

        const target = this.opts.config.channelId;
        if (!target) { this.releaseLock(processId, status); return; }

        // Skip if Teams bot is not connected
        if (!this.bot || this.bot.getStatus() !== 'connected') {
            this.releaseLock(processId, status);
            return;
        }

        const agentId = msg.agentId;
        const agentAddr = this.getAgentAddress(agentId);
        if (!agentAddr) {
            console.warn(`[teams-bridge] No address for agent ${agentId} (${msg.agentName}) — skipping outbound`);
            this.releaseLock(processId, status);
            return;
        }

        console.log(`[teams-bridge] Process ${processId} status=${status} from=${msg.agentName}`);

        try {
            const workspaceId = (proc.workspaceId ?? proc.workspace) as string || '';
            const url = `${agentAddr}/api/processes/${processId}?workspaceId=${encodeURIComponent(workspaceId)}`;
            const res = await fetch(url);
            if (!res.ok) {
                console.warn(`[teams-bridge] Process fetch failed: ${res.status} from ${url}`);
                return;
            }
            const body = await res.json() as Record<string, unknown>;
            const processData = (body.process ?? body) as Record<string, unknown>;
            const turns = (processData.conversationTurns ?? processData.conversation ?? processData.turns) as Array<{ role: string; content?: string; text?: string; streaming?: boolean }> | undefined;
            if (!turns || turns.length === 0) return;

            const lastSeen = this.store!.getWatermark(processId);

            // Skip streaming turns
            let sendableEnd = turns.length;
            for (let i = turns.length - 1; i >= lastSeen; i--) {
                if (turns[i].streaming) { sendableEnd = i; continue; }
                break;
            }

            const newTurns = turns.slice(lastSeen, sendableEnd);
            if (newTurns.length === 0) return;

            // Advance watermark BEFORE sending — prevents infinite retry on send failure
            if (sendableEnd > lastSeen) {
                this.store!.setWatermark(processId, sendableEnd);
            }

            const repoName = await this.resolveWorkspaceName(
                proc.workspaceName as string | undefined,
                (processData.metadata as Record<string, unknown> | undefined)?.workspaceName as string | undefined,
                workspaceId,
                agentAddr,
            );
            const title = (processData.title ?? proc.title ?? '') as string;

            for (const turn of newTurns) {
                const content = (turn.content ?? turn.text ?? '') as string;
                if (!content.trim()) continue;

                const teamsText = this.formatOutboundMessage({
                    role: turn.role,
                    agent: msg.agentName,
                    repo: repoName,
                    title,
                    content,
                    botName: this.opts.config.botName,
                });

                try {
                    const messageId = await this.bot!.send(target, teamsText);
                    this.store!.bindMessage(messageId, processId, agentId, `${msg.agentName}:${repoName}`, workspaceId);
                } catch (err) {
                    console.error('[teams-bridge] Failed to send outbound message:', err);
                }
            }
        } catch (err) {
            console.error('[teams-bridge] Failed to fetch process turns:', err);
        } finally {
            // Release running lock so future events for this process can be processed
            if (status !== 'completed') {
                this._runningLocks?.delete(processId);
            }
        }
    }

    private releaseLock(processId: string, status: string): void {
        if (status === 'completed') {
            this._processingLocks.delete(processId);
        } else {
            this._runningLocks?.delete(processId);
        }
    }

    /** Format a structured Teams message for desktop display. */
    formatOutboundMessage(opts: { role: string; agent: string; repo: string; title: string; content: string; botName?: string }): string {
        const sender = opts.role === 'user'
            ? (opts.botName || 'User')
            : 'CoC Agent';

        const lines = [
            sender,
            `Agent: ${opts.agent}`,
            `Repo: ${opts.repo}`,
        ];
        if (opts.title) {
            lines.push(`Title: ${opts.title}`);
        }
        lines.push('Message:', opts.content.trimStart());

        return lines.join('\n');
    }

    /** Resolve a workspace ID to a human-readable name. */
    private async resolveWorkspaceName(
        wsEventName: string | undefined,
        metadataName: string | undefined,
        workspaceId: string,
        agentAddr: string,
    ): Promise<string> {
        if (wsEventName) return wsEventName;
        if (metadataName) return metadataName;
        if (!workspaceId) return 'unknown';

        const cached = this._workspaceNameCache.get(workspaceId);
        if (cached) return cached;

        try {
            const res = await fetch(`${agentAddr}/api/workspaces`);
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

        let processId: string | undefined;
        let agentId: string | undefined;
        let workspaceId: string | undefined;
        let isFollowUp = false;
        const text = msg.text.trim();

        // Check if replying to a specific bot message → continue that session
        if (msg.replyToMessageId) {
            const entry = this.store.lookupMessage(msg.replyToMessageId);
            if (entry) {
                processId = entry.processId;
                agentId = entry.agentId;
                workspaceId = entry.workspaceId;
                isFollowUp = true;
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

        // No reply, no [global] → continue the last active session
        if (!isFollowUp && !processId) {
            const last = this.store.getLastActiveSession();
            if (last) {
                processId = last.processId;
                agentId = last.agentId;
                workspaceId = last.workspaceId;
                isFollowUp = true;
            }
        }

        // Still nothing → create a new chat via global session
        const senderId = msg.senderAadId ?? msg.senderName ?? 'unknown';
        if (!isFollowUp || !processId || !agentId) {
            ({ processId, agentId } = await this.resolveGlobalSession(senderId, msg.text));
            isFollowUp = false;
        }

        const agentAddr = this.getAgentAddress(agentId);
        if (!agentAddr) {
            console.error(`[teams-bridge] No address for agent ${agentId}`);
            return;
        }

        try {
            if (isFollowUp) {
                const wsParam = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
                const url = `${agentAddr}/api/processes/${processId}/message${wsParam}`;
                const res = await fetch(url, {
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

        const agentAddr = this.getAgentAddress(agentId);
        if (!agentAddr) throw new Error(`No address for agent ${agentId}`);

        const res = await fetch(`${agentAddr}/api/queue`, {
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
}
