/**
 * Agent Health Monitor
 *
 * Periodically checks agent health and updates status in the store.
 */

import type { AgentStore } from '../store';
import type { DevTunnelTokenService } from '../proxy/tunnel-token';
import { checkAgentHealth } from '../proxy/health';

export class AgentHealthMonitor {
    private intervalHandle: ReturnType<typeof setInterval> | null = null;

    constructor(
        private store: AgentStore,
        private intervalMs: number = 30_000,
        private tokenService?: DevTunnelTokenService
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
                let headers: Record<string, string> | undefined;
                if (agent.tunnelId && this.tokenService) {
                    const token = await this.tokenService.getToken(agent.tunnelId);
                    if (token) {
                        headers = { 'X-Tunnel-Authorization': `TunnelAccessToken ${token}` };
                    }
                }
                const healthy = await checkAgentHealth(agent.address, 5000, headers);
                this.store.updateStatus(agent.id, healthy ? 'online' : 'offline');
            })
        );
    }
}
