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
    /** Track last-seen turn count per process to detect new turns. */
    private lastTurnCount = new Map<string, number>();

    constructor(private opts: WhatsAppBridgeOptions) {}

    async start(): Promise<void> {
        this.store = new MessagingStore(this.opts.dataDir);
        this.bot = new WhatsAppBot({
            sessionDir: this.opts.config.sessionDir,
            deviceName: this.opts.config.userName,
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

    /** Update mutable config fields. */
    async updateConfig(patch: { userName?: string; groupJid?: string }): Promise<void> {
        if (patch.userName !== undefined) this.opts.config.userName = patch.userName;
        if (patch.groupJid !== undefined) this.opts.config.groupJid = patch.groupJid;
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
     * Auto-create a WhatsApp group if none is configured.
     * Called automatically when the bot connects.
     */
    private async ensureGroup(): Promise<void> {
        if (this.opts.config.groupJid) return;
        if (this._creatingGroup) return;
        if (!this.bot) return;
        this._creatingGroup = true;
        const groupName = `${this.opts.config.userName || 'CoC'} Bridge`;
        // Try immediately, then retry with delays if connection isn't stable yet
        const retryDelays = [0, 15_000, 25_000];
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
                    await this.persistGroupJid(jid);
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

    /** Save groupJid to the config file so it persists across restarts. */
    private async persistGroupJid(jid: string): Promise<void> {
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
            doc.messaging.whatsapp.groupJid = jid;
            fs.writeFileSync(configPath, jsYaml.dump(doc), 'utf8');
            console.log(`[whatsapp-bridge] Saved groupJid to ${configPath}`);
        } catch (err) {
            console.error('[whatsapp-bridge] Failed to persist groupJid:', err);
        }
    }

    // ── Outbound: CoC process update → WhatsApp ────────────
    private async onWsMessage(msg: WSRelayMessage): Promise<void> {
        if (!this.bot || !this.store) return;

        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(msg.data);
        } catch {
            return;
        }

        console.log(`[whatsapp-bridge] WS event: type=${parsed.type} from=${msg.agentName}`);

        if (parsed.type !== 'process-updated') return;
        const proc = parsed.process as Record<string, unknown> | undefined;
        if (!proc) { console.log('[whatsapp-bridge] No process in event'); return; }

        const status = proc.status as string;
        const processId = proc.id as string;
        console.log(`[whatsapp-bridge] Process ${processId} status=${status}`);
        if (!processId) return;

        if (status !== 'completed' && status !== 'running') return;

        const target = this.opts.config.groupJid;
        if (!target) { console.log('[whatsapp-bridge] No groupJid set, skipping'); return; }

        const agentId = msg.agentId;
        const agentAddr = this.getAgentAddress(agentId);
        if (!agentAddr) { console.log(`[whatsapp-bridge] No address for agent ${agentId}`); return; }

        try {
            const workspaceId = (proc.workspaceId ?? proc.workspace) as string || '';
            const url = `${agentAddr}/api/processes/${processId}?workspaceId=${encodeURIComponent(workspaceId)}`;
            console.log(`[whatsapp-bridge] Fetching turns from ${url}`);
            const res = await fetch(url);
            if (!res.ok) { console.log(`[whatsapp-bridge] Fetch failed: ${res.status}`); return; }
            const body = await res.json() as Record<string, unknown>;
            // Response shape: { process: { conversationTurns: [...] }, children, total }
            const processData = (body.process ?? body) as Record<string, unknown>;
            const turns = (processData.conversationTurns ?? processData.conversation ?? processData.turns) as Array<{ role: string; content?: string; text?: string }> | undefined;
            console.log(`[whatsapp-bridge] Got ${turns?.length ?? 0} turns (keys: ${Object.keys(processData).join(',')})`);
            if (!turns || turns.length === 0) return;

            const lastSeen = this.lastTurnCount.get(processId) ?? 0;

            // Only consider non-streaming turns with actual content.
            // During 'running' status, the latest assistant turn may still be
            // streaming with empty/partial content — skip it so we pick it up
            // on the next update when content is finalized.
            let sendableEnd = turns.length;
            for (let i = turns.length - 1; i >= lastSeen; i--) {
                const t = turns[i] as Record<string, unknown>;
                if (t.streaming) { sendableEnd = i; continue; }
                break;
            }

            const newTurns = turns.slice(lastSeen, sendableEnd);
            // Only advance watermark to what we actually processed
            if (sendableEnd > lastSeen) {
                this.lastTurnCount.set(processId, sendableEnd);
            }
            console.log(`[whatsapp-bridge] lastSeen=${lastSeen} sendableEnd=${sendableEnd} newTurns=${newTurns.length}`);

            if (newTurns.length === 0) return;

            const repoName = (proc.workspaceName ?? workspaceId ?? 'unknown') as string;
            const sessionLabel = `${msg.agentName}:${repoName}`;

            for (const turn of newTurns) {
                // Only forward assistant replies — user messages are redundant
                // since the bot is linked to the same WhatsApp account.
                // (Bot-sent messages always appear on the right/"sent" side.)
                if (turn.role === 'user') continue;

                const text = (turn.content ?? turn.text ?? '') as string;
                if (!text.trim()) continue;

                const prefix = `*🤖 ${sessionLabel}*`;

                try {
                    const waMessageId = await this.bot!.send(target, `${prefix}\n${text}`);
                    this.store!.bindMessage(waMessageId, processId, agentId, sessionLabel);
                    console.log(`[whatsapp-bridge] Sent to WA: ${waMessageId}`);
                } catch (err) {
                    console.error('[whatsapp-bridge] Failed to send outbound message:', err);
                }
            }
        } catch (err) {
            console.error('[whatsapp-bridge] Failed to fetch process turns:', err);
        }
    }

    // ── Inbound: WhatsApp message → CoC session ──────────
    private async onInboundMessage(msg: InboundWAMessage): Promise<void> {
        if (!this.store) return;

        let processId: string;
        let agentId: string;

        if (msg.quotedMessageId) {
            const entry = this.store.lookupMessage(msg.quotedMessageId);
            if (entry) {
                processId = entry.processId;
                agentId = entry.agentId;
            } else {
                ({ processId, agentId } = await this.resolveGlobalSession(msg.senderJid, msg.text));
            }
        } else {
            ({ processId, agentId } = await this.resolveGlobalSession(msg.senderJid, msg.text));
        }

        const agentAddr = this.getAgentAddress(agentId);
        if (!agentAddr) {
            console.error(`[whatsapp-bridge] No address for agent ${agentId}`);
            return;
        }

        try {
            await fetch(`${agentAddr}/api/queue/follow-up`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ processId, message: msg.text }),
            });
        } catch (err) {
            console.error('[whatsapp-bridge] Failed to inject inbound message:', err);
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
