/**
 * Process Store Types Tests
 *
 * Compile-time + runtime shape tests for WorkspaceInfo, ProcessFilter,
 * ProcessStore interface, and the new workspace fields on GenericProcessMetadata.
 */

import { describe, it, expect } from 'vitest';
import {
    WorkspaceInfo,
    ProcessFilter,
    ProcessChangeCallback,
    ProcessStore,
    GenericProcessMetadata,
    AIProcess,
    AIProcessStatus,
    ProcessEvent,
} from '../src/index';

describe('WorkspaceInfo', () => {
    it('should construct with required fields', () => {
        const ws: WorkspaceInfo = {
            id: 'abc123',
            name: 'my-project',
            rootPath: '/home/user/my-project',
        };
        expect(ws.id).toBe('abc123');
        expect(ws.name).toBe('my-project');
        expect(ws.rootPath).toBe('/home/user/my-project');
        expect(ws.color).toBeUndefined();
    });

    it('should construct with optional color field', () => {
        const ws: WorkspaceInfo = {
            id: 'abc123',
            name: 'my-project',
            rootPath: '/home/user/my-project',
            color: '#ff5733',
        };
        expect(ws.color).toBe('#ff5733');
    });
});

describe('ProcessFilter', () => {
    it('should construct with no fields (empty filter)', () => {
        const filter: ProcessFilter = {};
        expect(filter.workspaceId).toBeUndefined();
        expect(filter.status).toBeUndefined();
        expect(filter.type).toBeUndefined();
        expect(filter.since).toBeUndefined();
        expect(filter.limit).toBeUndefined();
        expect(filter.offset).toBeUndefined();
    });

    it('should accept a single status value', () => {
        const filter: ProcessFilter = { status: 'running' };
        expect(filter.status).toBe('running');
    });

    it('should accept an array of status values', () => {
        const filter: ProcessFilter = { status: ['running', 'queued'] };
        expect(filter.status).toEqual(['running', 'queued']);
    });

    it('should accept all optional fields', () => {
        const since = new Date('2026-01-01');
        const filter: ProcessFilter = {
            workspaceId: 'ws-1',
            status: 'completed',
            type: 'code-review',
            since,
            limit: 10,
            offset: 20,
        };
        expect(filter.workspaceId).toBe('ws-1');
        expect(filter.type).toBe('code-review');
        expect(filter.since).toBe(since);
        expect(filter.limit).toBe(10);
        expect(filter.offset).toBe(20);
    });
});

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
            async getProcess(id: string) {
                return processes.get(id);
            },
            async getAllProcesses(filter?: ProcessFilter) {
                let result = Array.from(processes.values());
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
                    if (filter.status) {
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
        };
    }

    it('should be implementable with all required methods', () => {
        const store = createMockStore();
        expect(store.addProcess).toBeDefined();
        expect(store.updateProcess).toBeDefined();
        expect(store.getProcess).toBeDefined();
        expect(store.getAllProcesses).toBeDefined();
        expect(store.removeProcess).toBeDefined();
        expect(store.clearProcesses).toBeDefined();
        expect(store.getWorkspaces).toBeDefined();
        expect(store.registerWorkspace).toBeDefined();
    });

    it('should support optional onProcessChange callback', () => {
        const store = createMockStore();
        expect(store.onProcessChange).toBeUndefined();

        const callback: ProcessChangeCallback = (_event: ProcessEvent) => {};
        store.onProcessChange = callback;
        expect(store.onProcessChange).toBe(callback);
    });

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
});

describe('GenericProcessMetadata workspace fields', () => {
    it('should accept workspaceId and workspaceName', () => {
        const metadata: GenericProcessMetadata = {
            type: 'code-review',
            workspaceId: 'ws-hash-123',
            workspaceName: 'my-project',
        };
        expect(metadata.workspaceId).toBe('ws-hash-123');
        expect(metadata.workspaceName).toBe('my-project');
    });

    it('should remain backward compatible without workspace fields', () => {
        const metadata: GenericProcessMetadata = {
            type: 'clarification',
        };
        expect(metadata.type).toBe('clarification');
        expect(metadata.workspaceId).toBeUndefined();
        expect(metadata.workspaceName).toBeUndefined();
    });

    it('should still support arbitrary feature-specific fields', () => {
        const metadata: GenericProcessMetadata = {
            type: 'code-review',
            workspaceId: 'ws-1',
            customField: 42,
            nested: { key: 'value' },
        };
        expect(metadata.customField).toBe(42);
        expect(metadata.nested).toEqual({ key: 'value' });
    });
});
