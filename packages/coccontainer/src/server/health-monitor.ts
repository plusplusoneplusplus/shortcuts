/**
 * Agent Health Monitor
 *
 * Periodically checks agent health and updates status in the store.
 * Health is determined solely by WebSocket connection status via AgentManager.
 * Agents are online only if they have an active call-home WebSocket connection.
 */

import type { AgentStore } from '../store';
import type { TunnelBridge } from '../proxy/tunnel-bridge';
import type { AgentManager } from '../inbound/agent-manager';

export class AgentHealthMonitor {
    private intervalHandle: ReturnType<typeof setInterval> | null = null;

    constructor(
        private store: AgentStore,
        private intervalMs: number = 30_000,
        private tunnelBridge?: TunnelBridge,
        private agentManager?: AgentManager
    ) {}

    start(): void {
        this.check(); // immediate first check
        this.intervalHandle = setInterval(() => this.check(), this.intervalMs);
    }

    stop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    private async check(): Promise<void> {
        const agents = this.store.list();
        for (const agent of agents) {
            // For inbound agents, check by stored agent ID
            if (agent.address.startsWith('inbound://')) {
                const agentId = agent.address.replace('inbound://', '');
                const connected = this.agentManager?.hasAgent(agentId) ?? false;
                this.store.updateStatus(agent.id, connected ? 'online' : 'offline');
                continue;
            }
            // Legacy outbound agents: check if they happen to have a call-home
            // WebSocket connection (by matching name). Otherwise mark offline.
            const inboundAgents = this.agentManager?.listAgents() ?? [];
            const matchByName = inboundAgents.find(a => a.name === agent.name);
            this.store.updateStatus(agent.id, matchByName ? 'online' : 'offline');
        }
    }
}
