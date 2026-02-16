/**
 * Smoke tests for shared mock-process-store helpers.
 */

import { describe, it, expect } from 'vitest';
import {
    createMockProcessStore,
    createProcessFixture,
    createCompletedProcessWithSession,
} from './mock-process-store';

describe('mock-process-store helpers', () => {
    describe('createMockProcessStore', () => {
        it('should return object implementing all core ProcessStore methods', () => {
            const store = createMockProcessStore();
            expect(store.addProcess).toBeDefined();
            expect(store.updateProcess).toBeDefined();
            expect(store.getProcess).toBeDefined();
            expect(store.getAllProcesses).toBeDefined();
            expect(store.removeProcess).toBeDefined();
            expect(store.clearProcesses).toBeDefined();
            expect(store.getWorkspaces).toBeDefined();
            expect(store.registerWorkspace).toBeDefined();
            expect(store.onProcessOutput).toBeDefined();
            expect(store.emitProcessOutput).toBeDefined();
            expect(store.emitProcessComplete).toBeDefined();
        });

        it('should round-trip addProcess / getProcess via backing Map', async () => {
            const store = createMockProcessStore();
            const proc = createProcessFixture({ id: 'p1' });
            await store.addProcess(proc);
            const retrieved = await store.getProcess('p1');
            expect(retrieved?.id).toBe('p1');
            expect(store.processes.has('p1')).toBe(true);
        });

        it('should merge updates via updateProcess', async () => {
            const store = createMockProcessStore();
            await store.addProcess(createProcessFixture({ id: 'p2', status: 'running' }));
            await store.updateProcess('p2', { status: 'completed' });
            const updated = await store.getProcess('p2');
            expect(updated?.status).toBe('completed');
        });

        it('should accumulate chunks in outputs Map via emitProcessOutput', () => {
            const store = createMockProcessStore();
            store.emitProcessOutput('x', 'chunk1');
            store.emitProcessOutput('x', 'chunk2');
            expect(store.outputs.get('x')).toEqual(['chunk1', 'chunk2']);
        });

        it('should store event in completions Map via emitProcessComplete', () => {
            const store = createMockProcessStore();
            store.emitProcessComplete('x', 'completed', '100ms');
            expect(store.completions.get('x')).toEqual({ status: 'completed', duration: '100ms' });
        });

        it('should pre-populate processes when initialProcesses provided', async () => {
            const p1 = createProcessFixture({ id: 'init-1' });
            const p2 = createProcessFixture({ id: 'init-2' });
            const store = createMockProcessStore({ initialProcesses: [p1, p2] });
            expect(store.processes.size).toBe(2);
            expect(await store.getProcess('init-1')).toBeDefined();
            expect(await store.getProcess('init-2')).toBeDefined();
        });

        it('should return all processes via getAllProcesses', async () => {
            const store = createMockProcessStore();
            await store.addProcess(createProcessFixture({ id: 'a' }));
            await store.addProcess(createProcessFixture({ id: 'b' }));
            const all = await store.getAllProcesses();
            expect(all).toHaveLength(2);
        });

        it('should delete process via removeProcess', async () => {
            const store = createMockProcessStore();
            await store.addProcess(createProcessFixture({ id: 'rm' }));
            await store.removeProcess('rm');
            expect(await store.getProcess('rm')).toBeUndefined();
        });

        it('should clear all processes and return count via clearProcesses', async () => {
            const store = createMockProcessStore();
            await store.addProcess(createProcessFixture({ id: 'c1' }));
            await store.addProcess(createProcessFixture({ id: 'c2' }));
            const count = await store.clearProcesses();
            expect(count).toBe(2);
            expect(store.processes.size).toBe(0);
        });
    });

    describe('createProcessFixture', () => {
        it('should return valid AIProcess with defaults', () => {
            const proc = createProcessFixture();
            expect(proc.id).toBe('proc-test');
            expect(proc.type).toBe('clarification');
            expect(proc.status).toBe('completed');
            expect(proc.startTime).toBeInstanceOf(Date);
        });

        it('should apply overrides', () => {
            const proc = createProcessFixture({ id: 'custom', status: 'running' });
            expect(proc.id).toBe('custom');
            expect(proc.status).toBe('running');
        });
    });

    describe('createCompletedProcessWithSession', () => {
        it('should return process with session and default turns', () => {
            const proc = createCompletedProcessWithSession('my-id', 'sess-1');
            expect(proc.id).toBe('my-id');
            expect(proc.status).toBe('completed');
            expect(proc.sdkSessionId).toBe('sess-1');
            expect(proc.conversationTurns).toHaveLength(2);
            expect(proc.conversationTurns![0].role).toBe('user');
            expect(proc.conversationTurns![1].role).toBe('assistant');
        });

        it('should accept custom conversation turns', () => {
            const turns = [
                { role: 'user' as const, content: 'Q', timestamp: new Date(), turnIndex: 0 },
            ];
            const proc = createCompletedProcessWithSession('id2', 'sess-2', turns);
            expect(proc.conversationTurns).toHaveLength(1);
            expect(proc.conversationTurns![0].content).toBe('Q');
        });
    });
});
