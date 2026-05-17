/**
 * WhatsAppBridge — glue between SSERelay / agent proxy and WhatsAppBot.
 *
 * Only imported via dynamic import when messaging.whatsapp.enabled is true.
 */

import type { InboundWAMessage } from '@plusplusoneplusplus/whatsapp-bot';
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

export class WhatsAppBridge {
    private store: MessagingStore | null = null;
    private bot: WhatsAppBot | null = null;
    private sseHandler: ((event: SSEEvent) => void) | null = null;

    constructor(private opts: WhatsAppBridgeOptions) {}

    async start(): Promise<void> {
        this.store = new MessagingStore(this.opts.dataDir);
        this.bot = new WhatsAppBot({
            sessionDir: this.opts.config.sessionDir,
            onMessage: (msg) => this.onInboundMessage(msg),
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
