/**
 * Recursive subtree cascade-delete tests (AC-02).
 *
 * Covers:
 *  - collectDescendantProcessIds() — the BFS subtree-collection helper
 *    (recursion + cycle guard).
 *  - DELETE /api/queue/history/:taskId — the queue-control cascade path must
 *    remove the *entire* spawned subtree, not just direct children.
 *
 * The companion api-workspace path is covered in workspace-history-delete.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import { collectDescendantProcessIds } from '../../src/server/routes/process-subtree';

function request(
    url: string,
    options: { method?: string; body?: string } = {}
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
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
        if (options.body) req.write(options.body);
        req.end();
    });
}

describe('Recursive subtree cascade-delete (AC-02)', () => {
    let server: ExecutionServer;
    let store: SqliteProcessStore;
    let tmpDir: string;
    let baseUrl: string;

    const wsId = 'ws-cascade-1';

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-cascade-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
        await store.registerWorkspace({ id: wsId, name: 'WS', rootPath: '/tmp/test-repo' });
        server = await createExecutionServer({ port: 0, dataDir: tmpDir, store });
        baseUrl = server.url;
    });

    afterEach(async () => {
        await server.close();
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function addProcess(id: string, parentProcessId?: string) {
        await store.addProcess({
            id,
            type: 'pipeline-execution' as any,
            promptPreview: `preview-${id}`,
            fullPrompt: `full-${id}`,
            status: 'completed' as any,
            startTime: new Date('2024-06-01T10:00:00Z'),
            endTime: new Date('2024-06-01T10:05:00Z'),
            parentProcessId,
            metadata: { type: 'pipeline-execution' as any, workspaceId: wsId },
        });
    }

    // ------------------------------------------------------------------
    // Helper unit tests
    // ------------------------------------------------------------------

    it('collectDescendantProcessIds returns all descendants depth-first across levels', async () => {
        await addProcess('root');
        await addProcess('c1', 'root');
        await addProcess('c2', 'root');
        await addProcess('g1', 'c1'); // grandchild
        await addProcess('gg1', 'g1'); // great-grandchild

        const ids = await collectDescendantProcessIds(store, 'root');
        expect(ids.sort()).toEqual(['c1', 'c2', 'g1', 'gg1']);
        // The root itself is never included.
        expect(ids).not.toContain('root');
    });

    it('collectDescendantProcessIds terminates on a cycle', async () => {
        // Malformed chain: a ↔ b point at each other.
        await addProcess('a');
        await addProcess('b', 'a');
        // Re-parent 'a' under 'b' to create a cycle.
        await store.updateProcess('a', { parentProcessId: 'b' } as any);

        const ids = await collectDescendantProcessIds(store, 'a');
        // 'b' is reachable; 'a' is the root and must not loop back in.
        expect(ids).toContain('b');
        expect(ids).not.toContain('a');
    });

    // ------------------------------------------------------------------
    // queue-control DELETE /api/queue/history/:taskId
    // ------------------------------------------------------------------

    it('DELETE /api/queue/history/:id recursively removes the whole subtree', async () => {
        // 3-level chain: root → child → grandchild (+ sibling child).
        await addProcess('q_root');
        await addProcess('q_child', 'q_root');
        await addProcess('q_child_sib', 'q_root');
        await addProcess('q_grand', 'q_child');

        const res = await request(`${baseUrl}/api/queue/history/q_root`, { method: 'DELETE' });
        expect(res.status).toBe(200);

        expect(await store.getProcess('q_root')).toBeUndefined();
        expect(await store.getProcess('q_child')).toBeUndefined();
        expect(await store.getProcess('q_child_sib')).toBeUndefined();
        expect(await store.getProcess('q_grand')).toBeUndefined();
    });
});
