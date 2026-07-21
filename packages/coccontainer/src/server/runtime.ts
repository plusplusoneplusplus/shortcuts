/**
 * Container runtime.
 *
 * Owns the lifetime of every long-lived container service: the agent store,
 * tunnel/SSH bridges, SSE/WS relays, the web-client bridge, the health monitor,
 * the inbound agent manager, and the optional WhatsApp/Teams messaging bridges.
 * Startup ordering, reconnect-on-boot, and cleanup all live here so route
 * modules can depend on a single, explicit runtime instead of a startup closure.
 */

import type { ResolvedContainerConfig, ResolvedTeamsConfig } from '../config';
import { createAgentStore, type AgentStore } from '../store';
import { TunnelBridge } from '../proxy/tunnel-bridge';
import { SshBridge, isSshAddress } from '../proxy/ssh-bridge';
import { SSERelay } from '../proxy/sse-relay';
import { WebSocketRelay } from '../proxy/ws-relay';
import { WebClientBridge } from '../proxy/webclient-bridge';
import { AgentHealthMonitor } from './health-monitor';
import { AgentManager } from '../inbound';
import { AgentProxyClient } from './agent-proxy-client';
import { WorkspaceAggregationService } from './workspace-aggregation';

/** Structural type of the WhatsApp messaging bridge used by routes. */
export interface WhatsAppBridgeLike {
    stop(): Promise<void>;
    getWhatsAppStatus(): { enabled: boolean; status: string; qr: string | null; error: string | null; groupJid?: string; userName: string };
    updateConfig(patch: { userName?: string; groupJid?: string }): Promise<void>;
    reconnect(): Promise<void>;
    listGroups(): Promise<Array<{ jid: string; name: string }>>;
}

/** Structural type of the Teams messaging bridge used by routes. */
export interface TeamsBridgeLike {
    stop(): Promise<void>;
    getTeamsStatus(): { enabled: boolean; status: string; mode: string; error: string | null; teamName?: string; channelName?: string; teamId?: string; channelId?: string; botName: string };
    updateConfig(patch: { botName?: string; channelId?: string; enabled?: boolean; teamName?: string; channelName?: string; mode?: 'graph' | 'mcp' }): Promise<void>;
    reconnect(): Promise<void>;
    listChannels(): Promise<Array<{ id: string; displayName: string }>>;
}

export class ContainerRuntime {
    readonly agentStore: AgentStore;
    readonly tunnelBridge: TunnelBridge;
    readonly sshBridge: SshBridge;
    readonly sseRelay: SSERelay;
    readonly wsRelay: WebSocketRelay;
    readonly agentManager: AgentManager;
    readonly webClientBridge: WebClientBridge;
    readonly healthMonitor: AgentHealthMonitor;
    readonly proxyClient: AgentProxyClient;
    readonly workspaces: WorkspaceAggregationService;

    whatsappBridge: WhatsAppBridgeLike | undefined;
    teamsBridge: TeamsBridgeLike | undefined;

    constructor(readonly config: ResolvedContainerConfig) {
        this.agentStore = createAgentStore(config.serve.dataDir);
        this.tunnelBridge = new TunnelBridge({ basePort: config.tunnelBridgeBasePort });
        this.sshBridge = new SshBridge();
        this.sseRelay = new SSERelay();
        this.wsRelay = new WebSocketRelay();
        this.agentManager = new AgentManager();
        this.wsRelay.setAgentManager(this.agentManager);
        this.webClientBridge = new WebClientBridge({ wsRelay: this.wsRelay });
        this.healthMonitor = new AgentHealthMonitor(this.agentStore, config.healthCheckIntervalMs, this.tunnelBridge, this.agentManager, this.sshBridge);
        this.proxyClient = new AgentProxyClient(this.agentManager, this.tunnelBridge, this.sshBridge);
        this.workspaces = new WorkspaceAggregationService(this.proxyClient, this.agentManager);
        this.wireAgentManagerEvents();
    }

    /** Resolve the address to reach an agent over HTTP (bridge local URL wins). */
    resolveEffectiveAddress(agentId: string, address: string): string {
        return this.proxyClient.resolveEffectiveAddress(agentId, address);
    }

    /** Start health monitoring, boot bridges, reconnect existing agents, and start messaging bridges. */
    async start(): Promise<void> {
        this.agentManager.startHeartbeatCheck(30_000);

        // Start health monitoring and SSE/WS connections for existing agents
        this.healthMonitor.start();

        for (const agent of this.agentStore.list()) {
            // Start tunnel bridges for agents with tunnelId
            if (agent.tunnelId) {
                await this.tunnelBridge.start(agent.id, agent.tunnelId, agent.address).catch(() => {});
            }
            // Start SSH bridges for ssh:// agents
            if (isSshAddress(agent.address)) {
                await this.sshBridge.connect(agent.id, agent.address).catch(() => {});
            }
            // Skip SSE/WS relay for inbound agents — they use the WebSocket channel
            if (agent.address.startsWith('inbound://')) continue;
            const effectiveAddr = this.resolveEffectiveAddress(agent.id, agent.address);
            this.sseRelay.connect(agent.id, agent.name, effectiveAddr);
            this.agentManager.connectOutbound(agent.id, agent.name, effectiveAddr);
        }

        // ── WhatsApp bridge (only when enabled) ─────────────
        const waConfig = this.config.messaging?.whatsapp;
        if (waConfig?.enabled) {
            const { WhatsAppBridge } = await import('../messaging/whatsapp-bridge');
            const bridge = new WhatsAppBridge({
                config: waConfig,
                dataDir: this.config.serve.dataDir,
                wsRelay: this.wsRelay,
                agentStore: this.agentStore,
                tunnelBridge: this.tunnelBridge,
            });
            await bridge.start();
            this.whatsappBridge = bridge;
        }

        // ── Teams bridge (only when enabled) ─────────────
        const teamsConfig = this.config.messaging?.teams;
        if (teamsConfig?.enabled) {
            await this.startTeamsBridge(teamsConfig);
        }
    }

    /** Construct, start, and store a Teams bridge from a resolved Teams config. */
    async startTeamsBridge(teamsConfig: ResolvedTeamsConfig): Promise<TeamsBridgeLike> {
        const { TeamsBridge } = await import('../messaging/teams-bridge');
        const bridge = new TeamsBridge({
            config: teamsConfig,
            dataDir: this.config.serve.dataDir,
            wsRelay: this.wsRelay,
            sseRelay: this.sseRelay,
            agentStore: this.agentStore,
            tunnelBridge: this.tunnelBridge,
            agentManager: this.agentManager,
        });
        await bridge.start();
        this.teamsBridge = bridge;
        return bridge;
    }

    /** Stop every owned service. Best-effort and idempotent; safe to call once on shutdown. */
    cleanup(): void {
        this.whatsappBridge?.stop();
        this.teamsBridge?.stop();
        this.healthMonitor.stop();
        this.tunnelBridge.stopAll();
        this.sshBridge.dispose();
        this.sseRelay.disconnectAll();
        this.agentManager.disconnectAllOutbound();
        this.agentManager.close();
        this.agentStore.close();
    }

    private wireAgentManagerEvents(): void {
        // Inbound agent lifecycle — auto-register/deregister agents that call home
        this.agentManager.on('agent-connected', (agent: { id: string; name: string }) => {
            // Add or update in agent store with a placeholder address (inbound agents don't expose a port)
            const existing = this.agentStore.list().find(a => a.address === `inbound://${agent.id}`);
            if (!existing) {
                this.agentStore.add(`inbound://${agent.id}`, agent.name);
            } else if (existing.name !== agent.name) {
                // Agent reconnected with updated name — sync it
                this.agentStore.update(existing.id, { name: agent.name });
            }
            const entry = this.agentStore.list().find(a => a.address === `inbound://${agent.id}`);
            if (entry) {
                this.agentStore.updateStatus(entry.id, 'online');
            }
            console.log(`[inbound] Agent "${agent.name}" (${agent.id}) connected via call-home`);
        });

        this.agentManager.on('agent-disconnected', (agentId: string, agentName: string) => {
            // Look up agent by inbound:// address, not by agentId (which is the WebSocket ID, not the store UUID)
            const existing = this.agentStore.list().find(a => a.address === `inbound://${agentId}`);
            if (existing) {
                this.agentStore.updateStatus(existing.id, 'offline');
            }
            console.log(`[inbound] Agent "${agentName}" (${agentId}) disconnected`);
        });

        // Forward inbound agent WS events to browser clients (same path as wsRelay)
        this.agentManager.on('agent-event', (agentId: string, agentName: string, data: string) => {
            console.log(`[container] Forwarding agent-event to wsRelay from ${agentName}: ${data.substring(0, 120)}`);
            this.wsRelay.emit('message', { agentId, agentName, data });
        });
    }
}
