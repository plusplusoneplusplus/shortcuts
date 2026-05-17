/**
 * WhatsAppBridge — glue between SSERelay / agent proxy and WhatsAppBot.
 *
 * Only imported via dynamic import when messaging.whatsapp.enabled is true.
 */

import type { InboundWAMessage, BotStatus } from '@plusplusoneplusplus/whatsapp-bot';
import { WhatsAppBot } from '@plusplusoneplusplus/whatsapp-bot';
import type { SSERelay, SSEEvent } from '../proxy/sse-relay';
import type { AgentStore } from '../store/agent-store';
import type { TunnelBridge } from '../proxy/tunnel-bridge';
import type { ResolvedWhatsAppConfig } from '../config';
import { MessagingStore } from './messaging-store';

export interface WhatsAppBridgeOptions {
    config: ResolvedWhatsAppConfig;
    dataDir: string;
    sseRelay: SSERelay;
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
    private sseHandler: ((event: SSEEvent) => void) | null = null;
    private _creatingGroup = false;

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

        this.sseHandler = (event) => this.onSseEvent(event);
        this.opts.sseRelay.on('event', this.sseHandler);
    }

    async stop(): Promise<void> {
        if (this.sseHandler) {
            this.opts.sseRelay.off('event', this.sseHandler);
            this.sseHandler = null;
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
        try {
            // Wait for connection to fully stabilize (pre-keys upload, history sync)
            console.log('[whatsapp-bridge] Waiting for connection to stabilize before creating group...');
            await new Promise(resolve => setTimeout(resolve, 10_000));
            if (!this.bot || this.bot.getStatus() !== 'connected') {
                console.log('[whatsapp-bridge] Connection lost during stabilization, skipping group creation');
                return;
            }
            const groupName = `${this.opts.config.userName || 'CoC'} Bridge`;
            console.log(`[whatsapp-bridge] Creating group "${groupName}"...`);
            const jid = await this.bot.createGroup(groupName);
            this.opts.config.groupJid = jid;
            console.log(`[whatsapp-bridge] Group created: ${jid}`);
            await this.persistGroupJid(jid);
        } catch (err) {
            console.error('[whatsapp-bridge] Failed to create group:', err);
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
            const configPath = path.join(this.opts.dataDir, '..', 'config.yaml');
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

    // ── Outbound: CoC turn → WhatsApp ────────────────────
    private async onSseEvent(event: SSEEvent): Promise<void> {
        if (!this.bot || !this.store) return;

        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(event.data);
        } catch {
            return;
        }
        if (parsed.type !== 'turn:complete') return;

        const role = parsed.role as string;
        const text = parsed.text as string;
        if (!text?.trim()) return;

        const repoName = (parsed.workspaceName ?? parsed.workspaceId ?? 'unknown') as string;
        const sessionLabel = `${event.agentName}:${repoName}`;

        const prefix = role === 'user'
            ? `*${(parsed.userName as string) ?? this.opts.config.userName} → ${sessionLabel}*`
            : `*${sessionLabel}*`;

        const target = this.opts.config.groupJid;
        if (!target) return;

        try {
            const waMessageId = await this.bot.send(target, `${prefix}\n${text}`);
            const processId = parsed.processId as string;
            if (processId) {
                this.store.bindMessage(waMessageId, processId, event.agentId, sessionLabel);
            }
        } catch (err) {
            console.error('[whatsapp-bridge] Failed to send outbound message:', err);
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
