/**
 * Tests for agent lifecycle management in the container server.
 * Ensures agents are properly registered, tracked, and marked offline on disconnection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { createAgentStore, type Agent, type AgentStore } from '../../src/store/agent-store';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Mock InboundAgentManager for testing
class MockInboundAgentManager extends EventEmitter {
    private agents = new Map<string, { id: string; name: string }>();

    simulateAgentConnect(agentId: string, name: string) {
        this.agents.set(agentId, { id: agentId, name });
        this.emit('agent-connected', { id: agentId, name });
    }

    simulateAgentDisconnect(agentId: string) {
        const agent = this.agents.get(agentId);
        if (agent) {
            this.agents.delete(agentId);
            this.emit('agent-disconnected', agentId, agent.name);
        }
    }

    hasAgent(agentId: string): boolean {
        return this.agents.has(agentId);
    }

    listAgents() {
        return Array.from(this.agents.values());
    }
}

describe('Agent Lifecycle', () => {
    let tmpDir: string;
    let agentStore: AgentStore;
    let inboundManager: MockInboundAgentManager;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coccontainer-test-'));
        agentStore = createAgentStore(tmpDir);
        inboundManager = new MockInboundAgentManager();
    });

    afterEach(() => {
        agentStore.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('agent-connected event handling', () => {
        it('should add new inbound agent to store', () => {
            // Simulate the server's agent-connected handler
            inboundManager.on('agent-connected', (agent: { id: string; name: string }) => {
                const existing = agentStore.list().find(a => a.address === `inbound://${agent.id}`);
                if (!existing) {
                    agentStore.add(`inbound://${agent.id}`, agent.name);
                }
                const entry = agentStore.list().find(a => a.address === `inbound://${agent.id}`);
                if (entry) {
                    agentStore.updateStatus(entry.id, 'online');
                }
            });

            inboundManager.simulateAgentConnect('agent-ws-id-1', 'Agent-Dev3');

            const agents = agentStore.list();
            expect(agents.length).toBe(1);
            expect(agents[0].name).toBe('Agent-Dev3');
            expect(agents[0].address).toBe('inbound://agent-ws-id-1');
            expect(agents[0].status).toBe('online');
        });

        it('should update existing agent name on reconnection', () => {
            // Simulate the server's agent-connected handler
            inboundManager.on('agent-connected', (agent: { id: string; name: string }) => {
                const existing = agentStore.list().find(a => a.address === `inbound://${agent.id}`);
                if (!existing) {
                    agentStore.add(`inbound://${agent.id}`, agent.name);
                } else if (existing.name !== agent.name) {
                    agentStore.update(existing.id, { name: agent.name });
                }
                const entry = agentStore.list().find(a => a.address === `inbound://${agent.id}`);
                if (entry) {
                    agentStore.updateStatus(entry.id, 'online');
                }
            });

            // Initial connection
            inboundManager.simulateAgentConnect('agent-x', 'OldName');
            let agent = agentStore.list().find(a => a.address === 'inbound://agent-x');
            expect(agent?.name).toBe('OldName');

            // Reconnection with new name
            inboundManager.simulateAgentConnect('agent-x', 'NewName');
            agent = agentStore.list().find(a => a.address === 'inbound://agent-x');
            expect(agent?.name).toBe('NewName');
            expect(agentStore.list().length).toBe(1); // Still only one agent
        });
    });

    describe('agent-disconnected event handling', () => {
        it('should mark agent offline when disconnected (BUG FIX)', () => {
            // Setup: Add agent and mark online
            inboundManager.on('agent-connected', (agent: { id: string; name: string }) => {
                const existing = agentStore.list().find(a => a.address === `inbound://${agent.id}`);
                if (!existing) {
                    agentStore.add(`inbound://${agent.id}`, agent.name);
                }
                const entry = agentStore.list().find(a => a.address === `inbound://${agent.id}`);
                if (entry) {
                    agentStore.updateStatus(entry.id, 'online');
                }
            });

            // This is the FIXED handler - look up by address, not by WebSocket ID
            inboundManager.on('agent-disconnected', (agentId: string, agentName: string) => {
                const existing = agentStore.list().find(a => a.address === `inbound://${agentId}`);
                if (existing) {
                    agentStore.updateStatus(existing.id, 'offline');
                }
            });

            // Connect agent
            inboundManager.simulateAgentConnect('ws-agent-123', 'Agent-Dev2-Linux');
            let agent = agentStore.list().find(a => a.address === 'inbound://ws-agent-123');
            expect(agent?.status).toBe('online');

            // Disconnect agent
            inboundManager.simulateAgentDisconnect('ws-agent-123');

            // Agent should now be offline
            agent = agentStore.list().find(a => a.address === 'inbound://ws-agent-123');
            expect(agent?.status).toBe('offline');
        });

        it('should handle multiple agents independently', () => {
            // Setup handlers
            inboundManager.on('agent-connected', (agent: { id: string; name: string }) => {
                const existing = agentStore.list().find(a => a.address === `inbound://${agent.id}`);
                if (!existing) {
                    agentStore.add(`inbound://${agent.id}`, agent.name);
                }
                const entry = agentStore.list().find(a => a.address === `inbound://${agent.id}`);
                if (entry) {
                    agentStore.updateStatus(entry.id, 'online');
                }
            });

            inboundManager.on('agent-disconnected', (agentId: string, agentName: string) => {
                const existing = agentStore.list().find(a => a.address === `inbound://${agentId}`);
                if (existing) {
                    agentStore.updateStatus(existing.id, 'offline');
                }
            });

            // Connect multiple agents
            inboundManager.simulateAgentConnect('agent-1', 'Agent-Dev1');
            inboundManager.simulateAgentConnect('agent-2', 'Agent-Dev2');
            inboundManager.simulateAgentConnect('agent-3', 'Agent-Dev3');

            expect(agentStore.list().length).toBe(3);
            agentStore.list().forEach(a => expect(a.status).toBe('online'));

            // Disconnect only agent-2
            inboundManager.simulateAgentDisconnect('agent-2');

            const agents = agentStore.list();
            const agent1 = agents.find(a => a.address === 'inbound://agent-1');
            const agent2 = agents.find(a => a.address === 'inbound://agent-2');
            const agent3 = agents.find(a => a.address === 'inbound://agent-3');

            expect(agent1?.status).toBe('online');
            expect(agent2?.status).toBe('offline');
            expect(agent3?.status).toBe('online');
        });

        it('should not throw if agent not found in store', () => {
            // Setup disconnect handler
            inboundManager.on('agent-disconnected', (agentId: string, agentName: string) => {
                const existing = agentStore.list().find(a => a.address === `inbound://${agentId}`);
                if (existing) {
                    agentStore.updateStatus(existing.id, 'offline');
                }
            });

            // Disconnect non-existent agent - should not throw
            expect(() => {
                inboundManager.simulateAgentDisconnect('non-existent-agent');
            }).not.toThrow();
        });
    });

    describe('regression test for original bug', () => {
        it('OLD BUG: using agentStore.get(websocketId) fails to find agent', () => {
            // This demonstrates the ORIGINAL BUG
            // agentStore.get() expects UUID or agent name, not the WebSocket agent ID

            // Add an agent
            const added = agentStore.add('inbound://ws-id-456', 'TestAgent');
            const storeId = added.id; // This is a UUID like "abc-123-def"

            // Try to look up by WebSocket ID (the bug)
            const foundByWsId = agentStore.get('ws-id-456');
            expect(foundByWsId).toBeUndefined(); // Won't find it!

            // Try to look up by name (works)
            const foundByName = agentStore.get('TestAgent');
            expect(foundByName).toBeDefined();
            expect(foundByName?.id).toBe(storeId);

            // Try to look up by store UUID (works)
            const foundByUuid = agentStore.get(storeId);
            expect(foundByUuid).toBeDefined();
            expect(foundByUuid?.id).toBe(storeId);

            // Correct approach: look up by address
            const foundByAddress = agentStore.list().find(a => a.address === 'inbound://ws-id-456');
            expect(foundByAddress).toBeDefined();
            expect(foundByAddress?.id).toBe(storeId);
        });
    });
});
