/**
 * Runtime behavior tests for the ProcessStore interface (mock implementation).
 */

import { describe, it, expect } from 'vitest';
import {
    WorkspaceInfo,
    ProcessFilter,
    ProcessStore,
    AIProcess,
    AIProcessStatus,
} from '../src/index';

describe('ProcessStore (mock implementation)', () => {
    function createMockStore(): ProcessStore {
        const processes = new Map<string, AIProcess>();
        const workspaces = new Map<string, WorkspaceInfo>();

        return {
            async addProcess(process: AIProcess) {
                processes.set(process.id, process);
            },
            async updateProcess(id: string, updates: Partial<AIProcess>) {
                const existing = processes.get(id);
                if (existing) {
                    processes.set(id, { ...existing, ...updates });
                }
            },
            async getProcess(id: string, workspaceId?: string) {
                // With workspaceId hint: only return process if it matches workspace
                if (workspaceId !== undefined) {
                    const p = processes.get(id);
                    if (!p) { return undefined; }
                    const wsId = p.metadata?.workspaceId ?? '';
                    return wsId === workspaceId ? p : undefined;
                }
                return processes.get(id);
            },
            async getAllProcesses(filter?: ProcessFilter) {
                let result = Array.from(processes.values());
                if (filter?.workspaceId) {
                    result = result.filter(p => (p.metadata?.workspaceId ?? '') === filter.workspaceId);
                }
                if (filter?.status) {
                    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
                    result = result.filter(p => statuses.includes(p.status));
                }
                if (filter?.type) {
                    result = result.filter(p => p.type === filter.type);
                }
                if (filter?.limit !== undefined) {
                    const offset = filter.offset ?? 0;
                    result = result.slice(offset, offset + filter.limit);
                }
                return result;
            },
            async removeProcess(id: string) {
                processes.delete(id);
            },
            async clearProcesses(filter?: ProcessFilter) {
                if (!filter) {
                    const count = processes.size;
                    processes.clear();
                    return count;
                }
                let count = 0;
                for (const [id, process] of processes) {
                    let match = true;
                    if (filter.workspaceId) {
                        match = (process.metadata?.workspaceId ?? '') === filter.workspaceId;
                    }
                    if (match && filter.status) {
                        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
                        match = statuses.includes(process.status);
                    }
                    if (match) {
                        processes.delete(id);
                        count++;
                    }
                }
                return count;
            },
            async getWorkspaces() {
                return Array.from(workspaces.values());
            },
            async registerWorkspace(workspace: WorkspaceInfo) {
                workspaces.set(workspace.id, workspace);
            },
            async getProcessIds(filter?: ProcessFilter) {
                const all = await this.getAllProcesses(filter);
                return all.map((p: AIProcess) => p.id);
            },
        };
    }

    it('should add and retrieve a process', async () => {
        const store = createMockStore();
        const process: AIProcess = {
            id: 'test-1',
            type: 'clarification',
            promptPreview: 'Test prompt',
            fullPrompt: 'Full test prompt',
            status: 'running',
            startTime: new Date(),
        };
        await store.addProcess(process);
        const retrieved = await store.getProcess('test-1');
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe('test-1');
    });

    it('should register and retrieve workspaces', async () => {
        const store = createMockStore();
        await store.registerWorkspace({
            id: 'ws-1',
            name: 'Project A',
            rootPath: '/home/user/project-a',
        });
        const workspaces = await store.getWorkspaces();
        expect(workspaces).toHaveLength(1);
        expect(workspaces[0].name).toBe('Project A');
    });

    it('should filter processes by status array', async () => {
        const store = createMockStore();
        const makeProcess = (id: string, status: AIProcessStatus): AIProcess => ({
            id,
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status,
            startTime: new Date(),
        });
        await store.addProcess(makeProcess('p1', 'running'));
        await store.addProcess(makeProcess('p2', 'completed'));
        await store.addProcess(makeProcess('p3', 'queued'));

        const result = await store.getAllProcesses({ status: ['running', 'queued'] });
        expect(result).toHaveLength(2);
        expect(result.map(p => p.id).sort()).toEqual(['p1', 'p3']);
    });

    it('should clear processes and return count', async () => {
        const store = createMockStore();
        const makeProcess = (id: string, status: AIProcessStatus): AIProcess => ({
            id,
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status,
            startTime: new Date(),
        });
        await store.addProcess(makeProcess('p1', 'running'));
        await store.addProcess(makeProcess('p2', 'completed'));
        const count = await store.clearProcesses();
        expect(count).toBe(2);
    });

    // 29. getProcess(id, workspaceId?) signature accepted
    it('should accept optional workspaceId in getProcess and return correct entry', async () => {
        const store = createMockStore();
        const process: AIProcess = {
            id: 'x',
            type: 'clarification',
            promptPreview: 'p',
            fullPrompt: 'fp',
            status: 'completed',
            startTime: new Date(),
            metadata: { type: 'clarification', workspaceId: 'ws-a' },
        };
        await store.addProcess(process);

        const found = await store.getProcess('x', 'ws-a');
        expect(found).toBeDefined();
        expect(found!.id).toBe('x');

        // Wrong workspace hint returns undefined
        const notFound = await store.getProcess('x', 'ws-b');
        expect(notFound).toBeUndefined();
    });

    // 30. getAllProcesses with filter.workspaceId
    it('should return only entries matching filter.workspaceId', async () => {
        const store = createMockStore();
        const makeWsProcess = (id: string, wsId: string): AIProcess => ({
            id,
            type: 'clarification',
            promptPreview: 'p',
            fullPrompt: 'fp',
            status: 'completed',
            startTime: new Date(),
            metadata: { type: 'clarification', workspaceId: wsId },
        });
        await store.addProcess(makeWsProcess('a1', 'ws-a'));
        await store.addProcess(makeWsProcess('a2', 'ws-a'));
        await store.addProcess(makeWsProcess('b1', 'ws-b'));

        const wsB = await store.getAllProcesses({ workspaceId: 'ws-b' });
        expect(wsB).toHaveLength(1);
        expect(wsB[0].id).toBe('b1');
    });

    // 31. clearProcesses with filter.workspaceId returns correct count
    it('should clear only processes matching filter.workspaceId and return count', async () => {
        const store = createMockStore();
        const makeWsProcess = (id: string, wsId: string): AIProcess => ({
            id,
            type: 'clarification',
            promptPreview: 'p',
            fullPrompt: 'fp',
            status: 'completed',
            startTime: new Date(),
            metadata: { type: 'clarification', workspaceId: wsId },
        });
        await store.addProcess(makeWsProcess('a1', 'ws-a'));
        await store.addProcess(makeWsProcess('a2', 'ws-a'));
        await store.addProcess(makeWsProcess('a3', 'ws-a'));
        await store.addProcess(makeWsProcess('b1', 'ws-b'));
        await store.addProcess(makeWsProcess('b2', 'ws-b'));

        const count = await store.clearProcesses({ workspaceId: 'ws-a' });
        expect(count).toBe(3);

        const remaining = await store.getAllProcesses();
        expect(remaining).toHaveLength(2);
        expect(remaining.map(p => p.id).sort()).toEqual(['b1', 'b2']);
    });
});
