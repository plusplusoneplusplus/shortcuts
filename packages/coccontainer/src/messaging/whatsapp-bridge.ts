/**
 * WhatsAppBridge — glue between WS relay / agent proxy and WhatsAppBot.
 *
 * Only imported via dynamic import when messaging.whatsapp.enabled is true.
 */

import type { InboundWAMessage, BotStatus } from '@plusplusoneplusplus/whatsapp-bot';
import { WhatsAppBot } from '@plusplusoneplusplus/whatsapp-bot';
import type { WebSocketRelay, WSRelayMessage } from '../proxy/ws-relay';
import type { AgentStore } from '../store/agent-store';
import type { TunnelBridge } from '../proxy/tunnel-bridge';
import type { ResolvedWhatsAppConfig } from '../config';
import { MessagingStore } from './messaging-store';

export interface WhatsAppBridgeOptions {
    config: ResolvedWhatsAppConfig;
    dataDir: string;
    wsRelay: WebSocketRelay;
    agentStore: AgentStore;
    tunnelBridge: TunnelBridge;
}

export interface WhatsAppStatus {
    enabled: boolean;
    status: BotStatus;
    qr: string | null;
    error: string | null;
    groupJid?: string;
    userName: string;
}

export class WhatsAppBridge {
    private store: MessagingStore | null = null;
    private bot: WhatsAppBot | null = null;
    private wsHandler: ((msg: WSRelayMessage) => void) | null = null;
    private _creatingGroup = false;
    private _processingLocks = new Set<string>();
    private _workspaceNameCache = new Map<string, string>();

    constructor(private opts: WhatsAppBridgeOptions) {}

    async start(): Promise<void> {
        this.store = new MessagingStore(this.opts.dataDir);
        this.bot = new WhatsAppBot({
            sessionDir: this.opts.config.sessionDir,
            deviceName: this.opts.config.userName,
            printQR: false,
            onMessage: (msg) => this.onInboundMessage(msg),
            onStatusChange: (status) => {
                if (status === 'connected') {
                    void this.ensureGroup();
                }
            },
        });
        await this.bot.start();

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

    /** Get current WhatsApp bridge status for REST API. */
    getWhatsAppStatus(): WhatsAppStatus {
        return {
            enabled: true,
            status: this.bot?.getStatus() ?? 'disconnected',
            qr: this.bot?.getLastQR() ?? null,
            error: this.bot?.getLastError() ?? null,
            groupJid: this.opts.config.groupJid,
            userName: this.opts.config.userName,
        };
    }

    /** List WhatsApp groups (for group picker UI). */
    async listGroups(): Promise<Array<{ jid: string; name: string }>> {
        if (!this.bot) return [];
        return this.bot.listGroups();
    }

    /** Update mutable config fields and persist to config.yaml. */
    async updateConfig(patch: { userName?: string; groupJid?: string }): Promise<void> {
        if (patch.userName !== undefined) this.opts.config.userName = patch.userName;
        if (patch.groupJid !== undefined) this.opts.config.groupJid = patch.groupJid;
        await this.persistWhatsAppConfig(patch);
    }

    /** Stop the current bot, clear session, and reconnect (for re-pairing). */
    async reconnect(): Promise<void> {
        await this.bot?.stop();
        // Clear groupJid so ensureGroup creates a fresh one after re-pairing
        this.opts.config.groupJid = undefined;
        const fs = await import('fs');
        try { fs.rmSync(this.opts.config.sessionDir, { recursive: true, force: true }); } catch { /* ignore */ }
        this.bot = new WhatsAppBot({
            sessionDir: this.opts.config.sessionDir,
            deviceName: this.opts.config.userName,
            printQR: false,
            onMessage: (msg) => this.onInboundMessage(msg),
            onStatusChange: (status) => {
                if (status === 'connected') {
                    void this.ensureGroup();
                }
            },
        });
        await this.bot.start();
    }

    /**
     * Ensure a WhatsApp group exists for messaging.
     * If a groupJid is configured, trust it (skip verification to avoid init timeout).
     * If none is set, create a new one after a short stabilization delay.
     * Called automatically when the bot connects.
     */
    private async ensureGroup(): Promise<void> {
        if (this._creatingGroup) return;
        if (!this.bot) return;

        // If a group is already configured, trust it — avoid calling listGroups
        // right after connect as Baileys' init queries may not have finished yet.
        if (this.opts.config.groupJid) {
            console.log(`[whatsapp-bridge] Using configured group ${this.opts.config.groupJid}`);
            return;
        }

        this._creatingGroup = true;
        const groupName = `${this.opts.config.userName || 'CoC'} CoC Chat Group`;
        // Wait for Baileys init queries to settle, then retry with delays
        const retryDelays = [10_000, 15_000, 25_000];
        try {
            for (let i = 0; i < retryDelays.length; i++) {
                if (retryDelays[i] > 0) {
                    console.log(`[whatsapp-bridge] Retrying in ${retryDelays[i] / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelays[i]));
                }
                if (!this.bot || this.bot.getStatus() !== 'connected') {
                    console.log('[whatsapp-bridge] Not connected, will retry on next connect');
                    return;
                }
                try {
                    console.log(`[whatsapp-bridge] Creating group "${groupName}" (attempt ${i + 1}/${retryDelays.length})...`);
                    const jid = await this.bot.createGroup(groupName);
                    this.opts.config.groupJid = jid;
                    console.log(`[whatsapp-bridge] Group created: ${jid}`);
                    await this.persistWhatsAppConfig({ groupJid: jid });
                    return;
                } catch (err: any) {
                    console.warn(`[whatsapp-bridge] Attempt ${i + 1} failed: ${err.message}`);
                }
            }
            console.error('[whatsapp-bridge] All group creation attempts failed. Will retry on next connect.');
        } finally {
            this._creatingGroup = false;
        }
    }

    /** Save WhatsApp config fields to the config file so they persist across restarts. */
    private async persistWhatsAppConfig(fields: Record<string, string | undefined>): Promise<void> {
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
            if (!doc.messaging.whatsapp) doc.messaging.whatsapp = {};
            for (const [key, value] of Object.entries(fields)) {
                if (value !== undefined) {
                    doc.messaging.whatsapp[key] = value;
                }
            }
            fs.writeFileSync(configPath, jsYaml.dump(doc), 'utf8');
            console.log(`[whatsapp-bridge] Saved config to ${configPath}`);
        } catch (err) {
            console.error('[whatsapp-bridge] Failed to persist config:', err);
        }
    }

    // ── Outbound: CoC process update → WhatsApp ────────────
    private async onWsMessage(msg: WSRelayMessage): Promise<void> {
        if (!this.bot) { console.log('[whatsapp-bridge] WS event ignored: bot not started'); return; }
        if (!this.store) { console.log('[whatsapp-bridge] WS event ignored: store not ready'); return; }

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

        // Per-process concurrency guard to prevent duplicate sends
        if (this._processingLocks.has(processId)) {
            return;
        }
        this._processingLocks.add(processId);

        const target = this.opts.config.groupJid;
        if (!target) { this._processingLocks.delete(processId); return; }

        // Skip if WhatsApp is not connected (e.g. qr-pending, disconnected)
        if (!this.bot || this.bot.getStatus() !== 'connected') {
            this._processingLocks.delete(processId);
            return;
        }

        const agentId = msg.agentId;
        const agentAddr = this.getAgentAddress(agentId);
        if (!agentAddr) { console.log(`[whatsapp-bridge] No address for agent ${agentId}`); this._processingLocks.delete(processId); return; }

        try {
            const workspaceId = (proc.workspaceId ?? proc.workspace) as string || '';
            const url = `${agentAddr}/api/processes/${processId}?workspaceId=${encodeURIComponent(workspaceId)}`;
            console.log(`[whatsapp-bridge] Fetching turns from ${url}`);
            const res = await fetch(url);
            if (!res.ok) { console.log(`[whatsapp-bridge] Fetch failed: ${res.status}`); return; }
            const body = await res.json() as Record<string, unknown>;
            const processData = (body.process ?? body) as Record<string, unknown>;
            const turns = (processData.conversationTurns ?? processData.conversation ?? processData.turns) as Array<{ role: string; content?: string; text?: string; streaming?: boolean }> | undefined;
            console.log(`[whatsapp-bridge] Got ${turns?.length ?? 0} turns`);
            if (!turns || turns.length === 0) return;

            const lastSeen = this.store!.getWatermark(processId);

            // Skip streaming turns to avoid advancing watermark past incomplete content
            let sendableEnd = turns.length;
            for (let i = turns.length - 1; i >= lastSeen; i--) {
                if (turns[i].streaming) { sendableEnd = i; continue; }
                break;
            }

            const newTurns = turns.slice(lastSeen, sendableEnd);
            console.log(`[whatsapp-bridge] lastSeen=${lastSeen} sendableEnd=${sendableEnd} newTurns=${newTurns.length}`);

            if (newTurns.length === 0) return;

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

                const waText = this.formatOutboundMessage({
                    role: turn.role,
                    agent: msg.agentName,
                    repo: repoName,
                    title,
                    content,
                    userName: this.opts.config.userName,
                });

                try {
                    console.log(`[whatsapp-bridge] Sending to WA group ${target}, bot status=${this.bot!.getStatus()}`);
                    const waMessageId = await this.bot!.send(target, waText);
                    this.store!.bindMessage(waMessageId, processId, agentId, `${msg.agentName}:${repoName}`, workspaceId);
                    console.log(`[whatsapp-bridge] Sent to WA: ${waMessageId}`);
                } catch (err) {
                    console.error('[whatsapp-bridge] Failed to send outbound message:', err);
                }
            }

            // Persist watermark after all sends so restarts don't re-push
            if (sendableEnd > lastSeen) {
                this.store!.setWatermark(processId, sendableEnd);
            }
        } catch (err) {
            console.error('[whatsapp-bridge] Failed to fetch process turns:', err);
        } finally {
            // Only release lock for running processes (may get new turns later)
            // Keep lock for completed processes — no more turns will come
            if (status !== 'completed') {
                this._processingLocks.delete(processId);
            }
        }
    }

    /** Format a structured WhatsApp message with two sections. */
    formatOutboundMessage(opts: { role: string; agent: string; repo: string; title: string; content: string; userName?: string }): string {
        const sender = opts.role === 'user'
            ? (opts.userName || 'You')
            : 'CoC Agent';

        const lines = [
            `*${sender}*`,
            `Agent: ${opts.agent}`,
            `Repo: ${opts.repo}`,
        ];
        if (opts.title) {
            lines.push(`Title: ${opts.title}`);
        }
        lines.push('', '*Message:*', opts.content.trimStart());

        return lines.join('\n');
    }

    /** Resolve a workspace ID to a human-readable name, using cache and agent API. */
    private async resolveWorkspaceName(
        wsEventName: string | undefined,
        metadataName: string | undefined,
        workspaceId: string,
        agentAddr: string,
    ): Promise<string> {
        // Prefer names already available
        if (wsEventName) return wsEventName;
        if (metadataName) return metadataName;
        if (!workspaceId) return 'unknown';

        // Check cache
        const cached = this._workspaceNameCache.get(workspaceId);
        if (cached) return cached;

        // Fetch from agent's workspace list API
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
        } catch { /* ignore — fall through to workspaceId */ }

        return workspaceId;
    }

    // ── Inbound: WhatsApp message → CoC session ──────────
    private async onInboundMessage(msg: InboundWAMessage): Promise<void> {
        if (!this.store) return;

        // Only process messages from our configured group
        const groupJid = this.opts.config.groupJid;
        if (!groupJid || msg.senderJid !== groupJid) return;

        let processId: string | undefined;
        let agentId: string | undefined;
        let workspaceId: string | undefined;
        let isFollowUp = false;
        const text = msg.text.trim();

        // Check if replying to a specific bot message → continue that session
        if (msg.quotedMessageId) {
            const entry = this.store.lookupMessage(msg.quotedMessageId);
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
            const existing = this.store.getGlobalSession(msg.senderJid);
            if (existing) {
                processId = existing.processId;
                agentId = existing.agentId;
                isFollowUp = true;
                msg = { ...msg, text: stripped };
            } else {
                msg = { ...msg, text: stripped };
                ({ processId, agentId } = await this.resolveGlobalSession(msg.senderJid, stripped));
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
        if (!isFollowUp || !processId || !agentId) {
            ({ processId, agentId } = await this.resolveGlobalSession(msg.senderJid, msg.text));
            isFollowUp = false;
        }

        const agentAddr = this.getAgentAddress(agentId);
        if (!agentAddr) {
            console.error(`[whatsapp-bridge] No address for agent ${agentId}`);
            return;
        }

        try {
            if (isFollowUp) {
                // Send a follow-up message to the existing process session
                const wsParam = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
                const url = `${agentAddr}/api/processes/${processId}/message${wsParam}`;
                console.log(`[whatsapp-bridge] Sending follow-up to ${url}`);
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: msg.text }),
                });
                if (!res.ok) {
                    console.error(`[whatsapp-bridge] Follow-up failed: ${res.status}`);
                }
            } else {
                // New chat was already created by resolveGlobalSession
                console.log(`[whatsapp-bridge] New chat created: ${processId}`);
            }
        } catch (err) {
            console.error('[whatsapp-bridge] Failed to send inbound message:', err);
        }
    }

    // ── Global session ────────────────────────────────────
    private async resolveGlobalSession(senderJid: string, text: string): Promise<{ processId: string; agentId: string }> {
        if (!this.store) throw new Error('Store not initialized');

        const existing = this.store.getGlobalSession(senderJid);
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
        this.store.setGlobalSession(senderJid, processId, agentId);
        return { processId, agentId };
    }

    private getAgentAddress(agentId: string): string | undefined {
        const localUrl = this.opts.tunnelBridge.getLocalUrl(agentId);
        if (localUrl) return localUrl;
        return this.opts.agentStore.get(agentId)?.address;
    }
}
