/**
 * Per-Repo WebSocket Tests
 *
 * Verifies that queue-updated WS messages are scoped per repo (carrying repoId),
 * and that a secondary global broadcast (no repoId) is also emitted.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WebSocket } from 'ws';
import { createExecutionServer } from '../../src/server/index';
import { computeRepoId } from '../../src/server/queue-persistence';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function postJSON(
    url: string,
    data: unknown
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const body = JSON.stringify(data);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () =>
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') })
                );
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function makeTask(workingDirectory: string, displayName: string) {
    return {
        type: 'custom',
        priority: 'normal',
        displayName,
        payload: { data: { prompt: 'test' }, workingDirectory },
        config: {},
    };
}

/**
 * Connect a WebSocket and collect parsed JSON messages.
 * Returns an open WS plus a mutable messages array.
 */
function connectWS(port: number): Promise<{ ws: WebSocket; messages: any[] }> {
    return new Promise((resolve, reject) => {
        const messages: any[] = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        ws.on('open', () => resolve({ ws, messages }));
        ws.on('message', (data: Buffer | string) => {
            try {
                const text = typeof data === 'string' ? data : data.toString('utf-8');
                messages.push(JSON.parse(text));
            } catch { /* ignore */ }
        });
        ws.on('error', reject);
    });
}

/** Wait for `messages` array to reach `count` entries, or timeout. */
function waitForMessages(messages: any[], count: number, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
        if (messages.length >= count) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error(`Timeout: only ${messages.length}/${count} messages`)), timeoutMs);
        const interval = setInterval(() => {
            if (messages.length >= count) {
                clearInterval(interval);
                clearTimeout(timer);
                resolve();
            }
        }, 50);
    });
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Per-Repo WebSocket Events', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;

    beforeAll(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'per-repo-ws-'));
        const store = new FileProcessStore({ dataDir: tmpDir });
        server = await createExecutionServer({
            port: 0,
            host: '127.0.0.1',
            dataDir: tmpDir,
            store,
        });
        baseUrl = server.url;
    });

    afterAll(async () => {
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }, 10_000);

    it('should emit queue-updated with correct repoId when a task is enqueued for repo A', async () => {
        const repoA = path.resolve('/tmp/test-repo-ws-a');
        const expectedRepoId = computeRepoId(repoA);

        // Connect WS first (before pause, to capture all events)
        const parsed = new URL(baseUrl);
        const { ws, messages } = await connectWS(Number(parsed.port));

        // Wait for welcome message
        await waitForMessages(messages, 1);
        expect(messages[0].type).toBe('welcome');

        // Pause queue to prevent auto-execution (keeps tasks in queued state)
        await postJSON(`${baseUrl}/api/queue/pause`, {});

        // Enqueue task for repoA
        const res = await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, 'WS Test A'));
        expect(res.status).toBe(201);

        // Wait for queue-updated messages (pause events + enqueue events)
        // welcome + pause events + enqueue events
        await waitForMessages(messages, 5, 5000);

        const queueMessages = messages.filter((m: any) => m.type === 'queue-updated');

        // Per-repo message with non-empty queued: has repoId matching repoA
        const perRepoMsg = queueMessages.find(
            (m: any) => m.queue?.repoId === expectedRepoId && m.queue?.queued?.length > 0
        );
        expect(perRepoMsg).toBeDefined();
        expect(perRepoMsg.queue.queued.length).toBeGreaterThanOrEqual(1);

        // Global message: no repoId
        const globalMsg = queueMessages.find((m: any) => !m.queue?.repoId);
        expect(globalMsg).toBeDefined();
        expect(globalMsg.queue.stats).toBeDefined();

        ws.close();

        // Resume queue for cleanup
        await postJSON(`${baseUrl}/api/queue/resume`, {});
    });

    it('should NOT emit queue-updated with repoId matching repo B when task is enqueued for repo A', async () => {
        const repoA = path.resolve('/tmp/test-repo-ws-a2');
        const repoB = path.resolve('/tmp/test-repo-ws-b2');
        const repoBId = computeRepoId(repoB);

        await postJSON(`${baseUrl}/api/queue/pause`, {});

        const parsed = new URL(baseUrl);
        const { ws, messages } = await connectWS(Number(parsed.port));
        await waitForMessages(messages, 1); // welcome

        // Enqueue task for repoA only
        await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, 'WS Test A2'));

        // Wait for queue-updated messages
        await waitForMessages(messages, 3, 5000);

        const queueMessages = messages.filter((m: any) => m.type === 'queue-updated');

        // No message should have repoB's repoId
        const repoBMsg = queueMessages.find((m: any) => m.queue?.repoId === repoBId);
        expect(repoBMsg).toBeUndefined();

        ws.close();
        await postJSON(`${baseUrl}/api/queue/resume`, {});
    });

    it('should emit global queue-updated (no repoId) with aggregate stats', async () => {
        const repoA = path.resolve('/tmp/test-repo-ws-a3');
        const repoB = path.resolve('/tmp/test-repo-ws-b3');

        await postJSON(`${baseUrl}/api/queue/pause`, {});

        const parsed = new URL(baseUrl);
        const { ws, messages } = await connectWS(Number(parsed.port));
        await waitForMessages(messages, 1); // welcome

        // Enqueue tasks for two different repos
        await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, 'Agg Test A'));
        await waitForMessages(messages, 3, 5000);

        await postJSON(`${baseUrl}/api/queue`, makeTask(repoB, 'Agg Test B'));
        // welcome + 2 from first enqueue + 2 from second enqueue = 5
        await waitForMessages(messages, 5, 5000);

        // Get the last global message (no repoId) — it should have aggregate stats
        const globalMessages = messages.filter((m: any) => m.type === 'queue-updated' && !m.queue?.repoId);
        const lastGlobal = globalMessages[globalMessages.length - 1];
        expect(lastGlobal).toBeDefined();
        expect(lastGlobal.queue.stats.queued).toBeGreaterThanOrEqual(2);

        ws.close();
        await postJSON(`${baseUrl}/api/queue/resume`, {});
    });

    it('per-repo and global queue-updated both broadcast on each queue change', async () => {
        const repo = path.resolve('/tmp/test-repo-ws-dual');

        await postJSON(`${baseUrl}/api/queue/pause`, {});

        const parsed = new URL(baseUrl);
        const { ws, messages } = await connectWS(Number(parsed.port));
        await waitForMessages(messages, 1); // welcome

        await postJSON(`${baseUrl}/api/queue`, makeTask(repo, 'Dual Test'));
        await waitForMessages(messages, 3, 5000);

        const queueMessages = messages.filter((m: any) => m.type === 'queue-updated');

        // Should have at least one per-repo (with repoId) and one global (without repoId)
        const withRepoId = queueMessages.filter((m: any) => m.queue?.repoId);
        const withoutRepoId = queueMessages.filter((m: any) => !m.queue?.repoId);

        expect(withRepoId.length).toBeGreaterThanOrEqual(1);
        expect(withoutRepoId.length).toBeGreaterThanOrEqual(1);

        ws.close();
        await postJSON(`${baseUrl}/api/queue/resume`, {});
    });
});
