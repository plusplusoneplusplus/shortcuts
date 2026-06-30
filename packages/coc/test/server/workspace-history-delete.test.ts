/**
 * Workspace History Delete API Tests
 *
 * Covers the unified DELETE endpoints:
 *   DELETE /api/workspaces/:id/history/:processId — single delete
 *   DELETE /api/workspaces/:id/history            — bulk delete
 *
 * Uses a real SqliteProcessStore + createExecutionServer for integration-level
 * coverage matching the pattern in process-history-handler.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';

// ============================================================================
// HTTP helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...options.headers };
        if (options.body) {
            reqHeaders['Content-Length'] = String(Buffer.byteLength(options.body));
        }
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: reqHeaders,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function post(url: string, data: unknown) {
    return request(url, { method: 'POST', body: JSON.stringify(data) });
}

// ============================================================================
// Tests
// ============================================================================

describe('Workspace History Delete API', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;
    let store: SqliteProcessStore;

    const wsId = 'ws-del-1';

    function deleteUrl(processId: string) {
        return `${baseUrl}/api/workspaces/${encodeURIComponent(wsId)}/history/${encodeURIComponent(processId)}`;
    }

    function bulkDeleteUrl() {
        return `${baseUrl}/api/workspaces/${encodeURIComponent(wsId)}/history`;
    }

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-hist-del-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });

        await store.registerWorkspace({
            id: wsId,
            name: 'Test Workspace',
            rootPath: '/tmp/test-repo',
        });

        server = await createExecutionServer({ port: 0, dataDir: tmpDir, store });
        baseUrl = server.url;
    });

    afterEach(async () => {
        await server.close();
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function addProcess(
        id: string,
        opts: {
            status?: string;
            type?: string;
            parentProcessId?: string;
            workspaceId?: string;
        } = {}
    ) {
        await store.addProcess({
            id,
            type: (opts.type ?? 'pipeline-execution') as any,
            promptPreview: `preview-${id}`,
            fullPrompt: `full-${id}`,
            status: (opts.status ?? 'completed') as any,
            startTime: new Date('2024-06-01T10:00:00Z'),
            endTime: new Date('2024-06-01T10:05:00Z'),
            parentProcessId: opts.parentProcessId,
            metadata: {
                type: (opts.type ?? 'pipeline-execution') as any,
                workspaceId: opts.workspaceId ?? wsId,
            },
        });
    }

    // ========================================================================
    // Single delete — non-queue process
    // ========================================================================

    it('DELETE single — non-queue process removed from store, returns 204', async () => {
        await addProcess('proc_xyz', { status: 'completed' });

        const res = await request(deleteUrl('proc_xyz'), { method: 'DELETE' });
        expect(res.status).toBe(204);

        // Verify it's gone from the store
        const proc = await store.getProcess('proc_xyz');
        expect(proc).toBeUndefined();
    });

    it('DELETE single — not found returns 404', async () => {
        const res = await request(deleteUrl('no-such-id'), { method: 'DELETE' });
        expect(res.status).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('not found');
    });

    it('DELETE single — children cleaned up before parent', async () => {
        await addProcess('parent_1', { status: 'completed' });
        await addProcess('child_1a', { status: 'completed', parentProcessId: 'parent_1' });
        await addProcess('child_1b', { status: 'completed', parentProcessId: 'parent_1' });

        const res = await request(deleteUrl('parent_1'), { method: 'DELETE' });
        expect(res.status).toBe(204);

        // Parent and both children should be gone
        expect(await store.getProcess('parent_1')).toBeUndefined();
        expect(await store.getProcess('child_1a')).toBeUndefined();
        expect(await store.getProcess('child_1b')).toBeUndefined();
    });

    it('DELETE single — recursively cascades the entire spawned subtree', async () => {
        // Build a 3-level tree: root → child → grandchild (+ a sibling child).
        await addProcess('tree_root', { status: 'completed' });
        await addProcess('tree_child', { status: 'completed', parentProcessId: 'tree_root' });
        await addProcess('tree_child_sib', { status: 'completed', parentProcessId: 'tree_root' });
        await addProcess('tree_grandchild', { status: 'completed', parentProcessId: 'tree_child' });

        const res = await request(deleteUrl('tree_root'), { method: 'DELETE' });
        expect(res.status).toBe(204);

        // Every node in the subtree must be gone — no orphaned grandchild.
        expect(await store.getProcess('tree_root')).toBeUndefined();
        expect(await store.getProcess('tree_child')).toBeUndefined();
        expect(await store.getProcess('tree_child_sib')).toBeUndefined();
        expect(await store.getProcess('tree_grandchild')).toBeUndefined();
    });

    // ========================================================================
    // Single delete — queue process (via enqueue/cancel flow)
    // ========================================================================

    it('DELETE single — queue process cleans both in-memory queue and store', async () => {
        // Pause the queue so enqueued tasks don't start executing
        await post(`${baseUrl}/api/queue/pause`, {});

        // Enqueue and cancel a task to get it into history
        const enqRes = await post(`${baseUrl}/api/queue`, {
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
            config: {},
            displayName: 'del-me',
        });
        const taskId = JSON.parse(enqRes.body).task.id;
        await request(`${baseUrl}/api/queue/${taskId}`, { method: 'DELETE' });

        // Verify it exists in history
        const histBefore = await request(`${baseUrl}/api/queue/history`);
        const historyBefore = JSON.parse(histBefore.body).history;
        expect(historyBefore.some((t: any) => t.id === taskId)).toBe(true);

        // Now delete via the new unified route (processId = queue_<taskId>)
        const processId = `queue_${taskId}`;
        const res = await request(deleteUrl(processId), { method: 'DELETE' });
        expect(res.status).toBe(204);

        // Verify removed from in-memory queue history
        const histAfter = await request(`${baseUrl}/api/queue/history`);
        const historyAfter = JSON.parse(histAfter.body).history;
        expect(historyAfter.some((t: any) => t.id === taskId)).toBe(false);
    });

    it('DELETE single — still running queue task returns 409', async () => {
        // We need a task that's in 'running' state. Enqueue with queue active.
        // Since there's no real AI service, the task will sit in pending/queued state.
        await post(`${baseUrl}/api/queue/pause`, {});

        const enqRes = await post(`${baseUrl}/api/queue`, {
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
            config: {},
            displayName: 'running-task',
        });
        const taskId = JSON.parse(enqRes.body).task.id;
        // Task is in 'queued' state (not terminal) — should be rejected
        const processId = `queue_${taskId}`;
        const res = await request(deleteUrl(processId), { method: 'DELETE' });
        expect(res.status).toBe(409);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('still running');
    });

    // ========================================================================
    // Bulk delete
    // ========================================================================

    it('DELETE bulk — mixed outcomes', async () => {
        await addProcess('bulk_ok', { status: 'completed' });
        // 'bulk_missing' does not exist in the store

        const res = await request(bulkDeleteUrl(), {
            method: 'DELETE',
            body: JSON.stringify({ processIds: ['bulk_ok', 'bulk_missing'] }),
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.results).toHaveLength(2);

        const okResult = body.results.find((r: any) => r.processId === 'bulk_ok');
        const missingResult = body.results.find((r: any) => r.processId === 'bulk_missing');
        expect(okResult.status).toBe('deleted');
        expect(missingResult.status).toBe('notFound');

        // Verify the deleted one is gone
        expect(await store.getProcess('bulk_ok')).toBeUndefined();
    });

    it('DELETE bulk — missing body returns 400', async () => {
        const res = await request(bulkDeleteUrl(), { method: 'DELETE' });
        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('processIds');
    });

    it('DELETE bulk — empty array returns 400', async () => {
        const res = await request(bulkDeleteUrl(), {
            method: 'DELETE',
            body: JSON.stringify({ processIds: [] }),
        });
        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('processIds');
    });

    it('DELETE bulk — all deleted successfully', async () => {
        await addProcess('b1', { status: 'completed' });
        await addProcess('b2', { status: 'failed' });
        await addProcess('b3', { status: 'cancelled' });

        const res = await request(bulkDeleteUrl(), {
            method: 'DELETE',
            body: JSON.stringify({ processIds: ['b1', 'b2', 'b3'] }),
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.results).toHaveLength(3);
        expect(body.results.every((r: any) => r.status === 'deleted')).toBe(true);

        // All gone from store
        for (const id of ['b1', 'b2', 'b3']) {
            expect(await store.getProcess(id)).toBeUndefined();
        }
    });

    it('DELETE bulk — children cleaned up for each entry', async () => {
        await addProcess('bp1', { status: 'completed' });
        await addProcess('bp1_child', { status: 'completed', parentProcessId: 'bp1' });

        const res = await request(bulkDeleteUrl(), {
            method: 'DELETE',
            body: JSON.stringify({ processIds: ['bp1'] }),
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.results[0].status).toBe('deleted');

        expect(await store.getProcess('bp1')).toBeUndefined();
        expect(await store.getProcess('bp1_child')).toBeUndefined();
    });

    // ========================================================================
    // Old routes still work (no regression)
    // ========================================================================

    it('old DELETE /api/queue/history/:taskId still works', async () => {
        await post(`${baseUrl}/api/queue/pause`, {});

        const enqRes = await post(`${baseUrl}/api/queue`, {
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
            config: {},
            displayName: 'old-route-test',
        });
        const taskId = JSON.parse(enqRes.body).task.id;
        await request(`${baseUrl}/api/queue/${taskId}`, { method: 'DELETE' });

        const delRes = await request(`${baseUrl}/api/queue/history/${taskId}`, { method: 'DELETE' });
        expect(delRes.status).toBe(200);
        expect(JSON.parse(delRes.body).deleted).toBe(true);
    });

    it('old DELETE /api/processes/:id still works', async () => {
        await addProcess('old_proc', { status: 'completed' });

        const res = await request(`${baseUrl}/api/processes/old_proc`, { method: 'DELETE' });
        expect(res.status).toBe(204);
        expect(await store.getProcess('old_proc')).toBeUndefined();
    });

    // ========================================================================
    // Route registration
    // ========================================================================

    it('route patterns match correctly for single DELETE', async () => {
        // URL-encoded processId should be decoded
        await addProcess('proc/special', { status: 'completed' });

        const res = await request(deleteUrl('proc/special'), { method: 'DELETE' });
        expect(res.status).toBe(204);
        expect(await store.getProcess('proc/special')).toBeUndefined();
    });
});
