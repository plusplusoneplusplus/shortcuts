/**
 * Tests for process-history-mapper.ts
 *
 * Covers:
 * - processToHistorySummary mapping from AIProcess → HistorySummary
 * - processToQueuedTask reconstruction for requeue fallback
 * - Store-backed GET /api/queue/history after server restart
 * - Requeue fallback when in-memory history is empty
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { processToHistorySummary, processToQueuedTask } from '../../src/server/shared/process-history-mapper';
import { createExecutionServer } from '../../src/server/index';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') })
                );
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

// ============================================================================
// Unit tests for processToHistorySummary
// ============================================================================

describe('processToHistorySummary', () => {
    const baseProcess: AIProcess = {
        id: 'queue_test-123',
        type: 'clarification',
        promptPreview: 'Hello world',
        fullPrompt: 'Hello world, how are you?',
        status: 'completed',
        startTime: new Date('2026-01-01T00:00:00Z'),
        endTime: new Date('2026-01-01T00:01:00Z'),
        metadata: { type: 'clarification', workspaceId: 'ws-abc' },
    };

    it('should map basic fields correctly', () => {
        const summary = processToHistorySummary(baseProcess);
        expect(summary.id).toBe('queue_test-123');
        expect(summary.processId).toBe('queue_test-123');
        expect(summary.status).toBe('completed');
        expect(summary.type).toBe('clarification');
        expect(summary.repoId).toBe('ws-abc');
        expect(summary.prompt).toBe('Hello world, how are you?');
        expect(summary.promptPreview).toBe('Hello world');
    });

    it('should compute completedAt from endTime', () => {
        const summary = processToHistorySummary(baseProcess);
        expect(summary.completedAt).toBe(new Date('2026-01-01T00:01:00Z').getTime());
    });

    it('should return null completedAt when endTime is absent', () => {
        const proc = { ...baseProcess, endTime: undefined };
        const summary = processToHistorySummary(proc);
        expect(summary.completedAt).toBeNull();
    });

    it('should prefer title for displayName', () => {
        const proc = { ...baseProcess, title: 'My Chat Title' };
        const summary = processToHistorySummary(proc);
        expect(summary.displayName).toBe('My Chat Title');
    });

    it('should fall back to promptPreview for displayName', () => {
        const summary = processToHistorySummary(baseProcess);
        expect(summary.displayName).toBe('Hello world');
    });

    it('should fall back to id for displayName when no title or preview', () => {
        const proc = { ...baseProcess, title: undefined, promptPreview: '' };
        const summary = processToHistorySummary(proc);
        expect(summary.displayName).toBe('queue_test-123');
    });

    it('should include error when present', () => {
        const proc = { ...baseProcess, status: 'failed' as const, error: 'Something went wrong' };
        const summary = processToHistorySummary(proc);
        expect(summary.error).toBe('Something went wrong');
    });

    it('should populate chatMeta from conversation turns', () => {
        const proc: AIProcess = {
            ...baseProcess,
            title: 'Chat about auth',
            conversationTurns: [
                { role: 'user', content: 'How does auth work?', timestamp: new Date('2026-01-01T00:00:10Z'), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'Auth uses JWT tokens...', timestamp: new Date('2026-01-01T00:00:30Z'), turnIndex: 1, timeline: [] },
                { role: 'user', content: 'Thanks!', timestamp: new Date('2026-01-01T00:00:50Z'), turnIndex: 2, timeline: [] },
            ],
        };
        const summary = processToHistorySummary(proc);
        expect(summary.chatMeta).toBeDefined();
        expect(summary.chatMeta!.turnCount).toBe(3);
        expect(summary.chatMeta!.firstMessage).toBe('How does auth work?');
        expect(summary.chatMeta!.title).toBe('Chat about auth');
        expect(summary.chatMeta!.lastActivityAt).toBe(new Date('2026-01-01T00:00:50Z').getTime());
    });

    it('should truncate long firstMessage in chatMeta', () => {
        const longMessage = 'A'.repeat(200);
        const proc: AIProcess = {
            ...baseProcess,
            conversationTurns: [
                { role: 'user', content: longMessage, timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
        };
        const summary = processToHistorySummary(proc);
        expect(summary.chatMeta!.firstMessage!.length).toBeLessThanOrEqual(120);
        expect(summary.chatMeta!.firstMessage!.endsWith('...')).toBe(true);
    });

    it('should not include chatMeta when no conversation turns', () => {
        const summary = processToHistorySummary(baseProcess);
        expect(summary.chatMeta).toBeUndefined();
    });

    it('should extract mode from metadata into payload', () => {
        const proc = { ...baseProcess, metadata: { type: 'clarification', mode: 'autopilot' } };
        const summary = processToHistorySummary(proc);
        expect(summary.payload?.mode).toBe('autopilot');
    });

    it('should default repoId to empty string when workspaceId is absent', () => {
        const proc = { ...baseProcess, metadata: undefined };
        const summary = processToHistorySummary(proc);
        expect(summary.repoId).toBe('');
    });
});

// ============================================================================
// Unit tests for processToQueuedTask
// ============================================================================

describe('processToQueuedTask', () => {
    it('should reconstruct a minimal QueuedTask from an AIProcess', () => {
        const proc: AIProcess = {
            id: 'queue_task-456',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test prompt',
            status: 'completed',
            startTime: new Date(),
            workingDirectory: '/repo/my-project',
            metadata: { type: 'clarification', workspaceId: 'ws-xyz', mode: 'autopilot' },
            title: 'My Chat',
        };
        const task = processToQueuedTask(proc);
        expect(task.id).toBe('task-456');
        expect(task.type).toBe('chat');
        expect(task.processId).toBe('queue_task-456');
        expect(task.displayName).toBe('My Chat');
        expect((task.payload as any).prompt).toBe('test prompt');
        expect((task.payload as any).workingDirectory).toBe('/repo/my-project');
        expect((task.payload as any).workspaceId).toBe('ws-xyz');
    });

    it('should use promptPreview as displayName fallback', () => {
        const proc: AIProcess = {
            id: 'queue_task-789',
            type: 'clarification',
            promptPreview: 'preview text',
            fullPrompt: 'full prompt',
            status: 'completed',
            startTime: new Date(),
        };
        const task = processToQueuedTask(proc);
        expect(task.displayName).toBe('preview text');
    });
});

// ============================================================================
// Integration: store-backed history survives server restart
// ============================================================================

describe('Store-backed history across restart', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-store-'));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('GET /api/queue/history returns store-backed processes after restart', async () => {
        const dbPath = path.join(dataDir, 'processes.db');

        // Pre-populate the store with completed processes
        const preStore = new SqliteProcessStore({ dbPath });
        await preStore.registerWorkspace({ id: 'ws-1', name: 'test', rootPath: '/repo/test' });
        await preStore.addProcess({
            id: 'proc-1',
            type: 'clarification',
            promptPreview: 'First task',
            fullPrompt: 'First task prompt',
            status: 'completed',
            startTime: new Date('2026-01-01T00:00:00Z'),
            endTime: new Date('2026-01-01T00:01:00Z'),
            metadata: { type: 'clarification', workspaceId: 'ws-1' },
        } as any);
        await preStore.addProcess({
            id: 'proc-2',
            type: 'clarification',
            promptPreview: 'Second task',
            fullPrompt: 'Second task prompt',
            status: 'failed',
            startTime: new Date('2026-01-02T00:00:00Z'),
            endTime: new Date('2026-01-02T00:01:00Z'),
            error: 'timeout',
            metadata: { type: 'clarification', workspaceId: 'ws-1' },
        } as any);
        // Also add a running process — should NOT appear in history
        await preStore.addProcess({
            id: 'proc-running',
            type: 'clarification',
            promptPreview: 'Running task',
            fullPrompt: 'Running task prompt',
            status: 'running',
            startTime: new Date('2026-01-03T00:00:00Z'),
            metadata: { type: 'clarification', workspaceId: 'ws-1' },
        } as any);
        preStore.close();

        // Start server with the pre-populated store
        const store = new SqliteProcessStore({ dbPath });
        let server: ExecutionServer | undefined;
        try {
            server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });

            const res = await request(`${server.url}/api/queue/history`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history.length).toBeGreaterThanOrEqual(2);

            const ids = body.history.map((t: any) => t.id ?? t.processId);
            expect(ids).toContain('proc-1');
            expect(ids).toContain('proc-2');
            expect(ids).not.toContain('proc-running');

            const failedEntry = body.history.find((t: any) => (t.id ?? t.processId) === 'proc-2');
            expect(failedEntry.status).toBe('failed');
            expect(failedEntry.error).toBe('timeout');
        } finally {
            if (server) await server.close();
            store.close();
        }
    });

    it('DELETE /api/queue/history removes store-backed processes', async () => {
        const dbPath = path.join(dataDir, 'processes.db');

        const preStore = new SqliteProcessStore({ dbPath });
        await preStore.addProcess({
            id: 'proc-del-1',
            type: 'clarification',
            promptPreview: 'Delete me',
            fullPrompt: 'Delete me prompt',
            status: 'completed',
            startTime: new Date(),
            endTime: new Date(),
        } as any);
        preStore.close();

        const store = new SqliteProcessStore({ dbPath });
        let server: ExecutionServer | undefined;
        try {
            server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });

            const clearRes = await request(`${server.url}/api/queue/history`, { method: 'DELETE' });
            expect(clearRes.status).toBe(200);

            // Verify the process is gone from the store
            const proc = await store.getProcess('proc-del-1');
            expect(proc).toBeUndefined();
        } finally {
            if (server) await server.close();
            store.close();
        }
    });
});
