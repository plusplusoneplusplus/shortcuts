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
import { processToHistorySummary, processToQueuedTask, processToTaskDetail } from '../../src/server/shared/process-history-mapper';
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
        expect(summary.id).toBe('test-123');
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

    it('should strip queue_ prefix from id but preserve it in processId', () => {
        const proc = { ...baseProcess, id: 'queue_1775917275950-9vyf2fm' };
        const summary = processToHistorySummary(proc);
        expect(summary.id).toBe('1775917275950-9vyf2fm');
        expect(summary.processId).toBe('queue_1775917275950-9vyf2fm');
    });

    it('should not alter id when no queue_ prefix exists', () => {
        const proc = { ...baseProcess, id: 'proc-no-prefix' };
        const summary = processToHistorySummary(proc);
        expect(summary.id).toBe('proc-no-prefix');
        expect(summary.processId).toBe('proc-no-prefix');
    });

    it('defaults provider to "copilot" when metadata.provider is absent', () => {
        const summary = processToHistorySummary(baseProcess);
        expect(summary.provider).toBe('copilot');
    });

    it('returns "copilot" when metadata.provider is "copilot"', () => {
        const proc = { ...baseProcess, metadata: { ...baseProcess.metadata, provider: 'copilot' } };
        const summary = processToHistorySummary(proc as AIProcess);
        expect(summary.provider).toBe('copilot');
    });

    it('returns "codex" when metadata.provider is "codex"', () => {
        const proc = { ...baseProcess, metadata: { ...baseProcess.metadata, provider: 'codex' } };
        const summary = processToHistorySummary(proc as AIProcess);
        expect(summary.provider).toBe('codex');
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
// Unit tests for processToTaskDetail
// ============================================================================

describe('processToTaskDetail', () => {
    const baseProcess: AIProcess = {
        id: 'queue_detail-001',
        type: 'clarification',
        promptPreview: 'Summarize this',
        fullPrompt: 'Summarize this document for me',
        status: 'completed',
        startTime: new Date('2026-03-01T10:00:00Z'),
        endTime: new Date('2026-03-01T10:05:00Z'),
        workingDirectory: '/repo/my-project',
        metadata: {
            type: 'clarification',
            workspaceId: 'ws-detail',
            mode: 'autopilot',
            model: 'gpt-4',
            pipelineName: 'my-pipeline',
        },
        title: 'Summarize Doc',
    };

    it('should preserve completed status instead of hardcoding queued', () => {
        const task = processToTaskDetail(baseProcess);
        expect(task.status).toBe('completed');
    });

    it('should preserve failed status', () => {
        const proc = { ...baseProcess, status: 'failed' as const, error: 'timeout' };
        const task = processToTaskDetail(proc);
        expect(task.status).toBe('failed');
        expect(task.error).toBe('timeout');
    });

    it('should map cancelling status to cancelled', () => {
        const proc = { ...baseProcess, status: 'cancelling' as any };
        const task = processToTaskDetail(proc);
        expect(task.status).toBe('cancelled');
    });

    it('should preserve cancelled status', () => {
        const proc = { ...baseProcess, status: 'cancelled' as const };
        const task = processToTaskDetail(proc);
        expect(task.status).toBe('cancelled');
    });

    it('should preserve timestamps from process startTime/endTime', () => {
        const task = processToTaskDetail(baseProcess);
        expect(task.createdAt).toBe(new Date('2026-03-01T10:00:00Z').getTime());
        expect(task.startedAt).toBe(new Date('2026-03-01T10:00:00Z').getTime());
        expect(task.completedAt).toBe(new Date('2026-03-01T10:05:00Z').getTime());
    });

    it('should leave completedAt undefined when endTime is absent', () => {
        const proc = { ...baseProcess, endTime: undefined };
        const task = processToTaskDetail(proc);
        expect(task.completedAt).toBeUndefined();
    });

    it('should strip queue_ prefix from id', () => {
        const task = processToTaskDetail(baseProcess);
        expect(task.id).toBe('detail-001');
    });

    it('should set processId to full process id', () => {
        const task = processToTaskDetail(baseProcess);
        expect(task.processId).toBe('queue_detail-001');
    });

    it('should map clarification type to chat', () => {
        const task = processToTaskDetail(baseProcess);
        expect(task.type).toBe('chat');
    });

    it('should pass through non-clarification types', () => {
        const proc = { ...baseProcess, type: 'code-review' };
        const task = processToTaskDetail(proc);
        expect(task.type).toBe('code-review');
    });

    it('should extract metadata fields into payload and config', () => {
        const task = processToTaskDetail(baseProcess);
        const payload = task.payload as any;
        expect(payload.mode).toBe('autopilot');
        expect(payload.pipelineName).toBe('my-pipeline');
        expect(payload.workspaceId).toBe('ws-detail');
        expect(payload.workingDirectory).toBe('/repo/my-project');
        expect(payload.processId).toBe('queue_detail-001');
        expect((task.config as any).model).toBe('gpt-4');
    });

    it('should preserve dream-run provider, model, and timeout attribution', () => {
        const proc: AIProcess = {
            ...baseProcess,
            type: 'dream-run',
            metadata: {
                type: 'dream-run',
                workspaceId: 'ws-dream',
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
                dream: {
                    workspaceId: 'ws-dream',
                    trigger: 'manual',
                    timeoutMs: 3_600_000,
                },
            },
        } as AIProcess;

        const task = processToTaskDetail(proc);

        expect(task.type).toBe('dream-run');
        expect((task as any).provider).toBe('claude');
        expect((task as any).model).toBe('claude-sonnet-4.6');
        expect((task as any).timeoutMs).toBe(3_600_000);
        expect((task.payload as any)).toMatchObject({
            kind: 'dream-run',
            provider: 'claude',
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            trigger: 'manual',
            timeoutMs: 3_600_000,
        });
        expect((task.config as any)).toMatchObject({
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            timeoutMs: 3_600_000,
        });
    });

    it('should use title as displayName', () => {
        const task = processToTaskDetail(baseProcess);
        expect(task.displayName).toBe('Summarize Doc');
    });

    it('should fall back to promptPreview for displayName', () => {
        const proc = { ...baseProcess, title: undefined };
        const task = processToTaskDetail(proc);
        expect(task.displayName).toBe('Summarize this');
    });

    it('should fall back to id for displayName when no title or preview', () => {
        const proc = { ...baseProcess, title: undefined, promptPreview: '' };
        const task = processToTaskDetail(proc);
        expect(task.displayName).toBe('queue_detail-001');
    });

    it('should set repoId from metadata workspaceId', () => {
        const task = processToTaskDetail(baseProcess);
        expect(task.repoId).toBe('ws-detail');
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
            // proc-running was orphaned by the previous (simulated) crash; the
            // startup sweep finalizes it as 'failed' so it now appears in
            // history with an explanatory error, rather than silently
            // remaining stuck in 'running'.
            expect(ids).toContain('proc-running');
            const orphanEntry = body.history.find((t: any) => (t.id ?? t.processId) === 'proc-running');
            expect(orphanEntry.status).toBe('failed');
            expect(typeof orphanEntry.error).toBe('string');

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

    // ------------------------------------------------------------------
    // GET /api/queue/:id — process-store fallback
    // ------------------------------------------------------------------

    it('GET /api/queue/:id returns store-backed task when not in memory', async () => {
        const dbPath = path.join(dataDir, 'processes.db');

        const preStore = new SqliteProcessStore({ dbPath });
        await preStore.addProcess({
            id: 'queue_fallback-task-1',
            type: 'clarification',
            promptPreview: 'Fallback task',
            fullPrompt: 'Fallback task full prompt',
            status: 'completed',
            startTime: new Date('2026-02-01T00:00:00Z'),
            endTime: new Date('2026-02-01T00:05:00Z'),
            workingDirectory: '/repo/test',
            title: 'My Completed Task',
            metadata: { type: 'clarification', workspaceId: 'ws-fb', mode: 'autopilot', model: 'gpt-4' },
        } as any);
        preStore.close();

        const store = new SqliteProcessStore({ dbPath });
        let server: ExecutionServer | undefined;
        try {
            server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });

            const res = await request(`${server.url}/api/queue/fallback-task-1`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.task).toBeDefined();
            expect(body.task.id).toBe('fallback-task-1');
            expect(body.task.status).toBe('completed');
            expect(body.task.displayName).toBe('My Completed Task');
            expect(body.task.processId).toBe('queue_fallback-task-1');
            expect(body.task.payload?.mode).toBe('autopilot');
            expect(body.task.completedAt).toBe(new Date('2026-02-01T00:05:00Z').getTime());
            expect(body.task.config?.model).toBe('gpt-4');
        } finally {
            if (server) await server.close();
            store.close();
        }
    });

    it('GET /api/queue/:id returns 404 when task not in memory or store', async () => {
        const dbPath = path.join(dataDir, 'processes.db');
        const store = new SqliteProcessStore({ dbPath });
        let server: ExecutionServer | undefined;
        try {
            server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });

            const res = await request(`${server.url}/api/queue/nonexistent-task`);
            expect(res.status).toBe(404);
        } finally {
            if (server) await server.close();
            store.close();
        }
    });

    it('GET /api/queue/:id reconstructed task has correct failed status', async () => {
        const dbPath = path.join(dataDir, 'processes.db');

        const preStore = new SqliteProcessStore({ dbPath });
        await preStore.addProcess({
            id: 'queue_failed-task-1',
            type: 'code-review',
            promptPreview: 'Failed task',
            fullPrompt: 'Failed task prompt',
            status: 'failed',
            startTime: new Date('2026-02-02T00:00:00Z'),
            endTime: new Date('2026-02-02T00:01:00Z'),
            error: 'Model unavailable',
            metadata: { type: 'code-review', workspaceId: 'ws-fb' },
        } as any);
        preStore.close();

        const store = new SqliteProcessStore({ dbPath });
        let server: ExecutionServer | undefined;
        try {
            server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });

            const res = await request(`${server.url}/api/queue/failed-task-1`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.task.status).toBe('failed');
            expect(body.task.error).toBe('Model unavailable');
            expect(body.task.type).toBe('code-review');
        } finally {
            if (server) await server.close();
            store.close();
        }
    });

    it('GET /api/queue/:id finds task by bare id without queue_ prefix', async () => {
        const dbPath = path.join(dataDir, 'processes.db');

        const preStore = new SqliteProcessStore({ dbPath });
        await preStore.addProcess({
            id: 'bare-id-task',
            type: 'clarification',
            promptPreview: 'Bare ID',
            fullPrompt: 'Bare ID prompt',
            status: 'completed',
            startTime: new Date('2026-02-03T00:00:00Z'),
            endTime: new Date('2026-02-03T00:01:00Z'),
            metadata: { type: 'clarification' },
        } as any);
        preStore.close();

        const store = new SqliteProcessStore({ dbPath });
        let server: ExecutionServer | undefined;
        try {
            server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });

            const res = await request(`${server.url}/api/queue/bare-id-task`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.task).toBeDefined();
            expect(body.task.id).toBe('bare-id-task');
        } finally {
            if (server) await server.close();
            store.close();
        }
    });
});
