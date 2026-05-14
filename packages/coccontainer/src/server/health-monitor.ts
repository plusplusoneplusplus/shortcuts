/**
 * Agent Health Monitor
 *
 * Periodically checks agent health and updates status in the store.
 */

import type { AgentStore } from '../store';
import type { TunnelBridge } from '../proxy/tunnel-bridge';
import { checkAgentHealth } from '../proxy/health';

export class AgentHealthMonitor {
    private intervalHandle: ReturnType<typeof setInterval> | null = null;

    constructor(
        private store: AgentStore,
        private intervalMs: number = 30_000,
        private tunnelBridge?: TunnelBridge
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
        await Promise.all(
            agents.map(async (agent) => {
                // Use tunnel bridge local URL if available
                const effectiveAddr = this.tunnelBridge?.getLocalUrl(agent.id) || agent.address;
                const healthy = await checkAgentHealth(effectiveAddr);
                this.store.updateStatus(agent.id, healthy ? 'online' : 'offline');
            })
        );
    }
}
