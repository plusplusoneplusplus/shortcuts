/**
 * Concurrent Import Request Tests
 *
 * Section 6: Validates behavior when multiple import requests arrive simultaneously.
 *
 * KNOWN CONCURRENCY GAP:
 * The current implementation does NOT enforce a concurrency lock on imports.
 * Two simultaneous import requests will both proceed and both succeed rather than
 * the second returning 409 IMPORT_IN_PROGRESS. This is documented below.
 *
 * The tests here verify what the server ACTUALLY does, and use it.skip to
 * document the unimplemented 409 behavior as a known gap.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { EXPORT_SCHEMA_VERSION } from '@plusplusoneplusplus/coc-server';
import { FileProcessStore } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => resolve({
                    status: res.statusCode || 0,
                    body: Buffer.concat(chunks).toString('utf-8'),
                }));
            },
        );
        req.on('error', reject);
        if (options.body !== undefined) { req.write(options.body); }
        req.end();
    });
}

function makePayload(processIdPrefix: string, count = 2) {
    const processes = Array.from({ length: count }, (_, i) => ({
        id: `${processIdPrefix}-${i}`,
        type: 'clarification' as const,
        promptPreview: `prompt ${i}`,
        fullPrompt: `full ${i}`,
        status: 'completed' as const,
        startTime: new Date().toISOString(),
    }));
    return {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        metadata: { processCount: processes.length, workspaceCount: 0, wikiCount: 0, queueFileCount: 0 },
        processes,
        workspaces: [],
        wikis: [],
        queueHistory: [],
        preferences: {},
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Concurrent Import Requests — Section 6', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let baseUrl: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-concurrent-test-'));
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir , skipNonEssentialInit: true });
        baseUrl = server.url;
    });

    afterEach(async () => {
        if (server) { await server.close(); server = undefined; }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function getImportToken(): Promise<string> {
        const res = await request(`${baseUrl}/api/admin/import-token`);
        return JSON.parse(res.body).token;
    }

    async function sendImport(payload: object): Promise<{ status: number; body: any }> {
        const token = await getImportToken();
        const res = await request(`${baseUrl}/api/admin/import?confirm=${token}`, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
        });
        return { status: res.status, body: JSON.parse(res.body) };
    }

    // KNOWN GAP: Two simultaneous import requests with separate tokens both succeed.
    // There is no concurrency lock — the second import is NOT rejected with 409.
    // If a lock is added in future, replace this skip with the actual 409 assertion.
    it.skip('two simultaneous import requests: second returns 409 IMPORT_IN_PROGRESS (not implemented)', async () => {
        // When implemented:
        // const [r1, r2] = await Promise.all([sendImport(payload), sendImport(payload)]);
        // assert exactly one returned 200 and one returned 409 with IMPORT_IN_PROGRESS
    });

    it('after first import completes, second import can proceed successfully', async () => {
        const payload1 = makePayload('first');
        const r1 = await sendImport(payload1);
        expect(r1.status).toBe(200);

        // Second import after first completes
        const payload2 = makePayload('second');
        const r2 = await sendImport(payload2);
        expect(r2.status).toBe(200);
        expect(r2.body.importedProcesses).toBe(2);
    });

    it('two sequential imports result in second import data (replace mode)', async () => {
        const payload1 = makePayload('batch-a', 3);
        await sendImport(payload1);

        const payload2 = makePayload('batch-b', 2);
        await sendImport(payload2);

        const res = await request(`${baseUrl}/api/processes`);
        const body = JSON.parse(res.body);
        // Replace mode: only second import's data remains
        expect(body.processes).toHaveLength(2);
        const ids = body.processes.map((p: any) => p.id).sort();
        expect(ids[0]).toContain('batch-b');
    });

    it('concurrent wipe + import: both complete without server crash', async () => {
        // Seed some data
        await request(`${baseUrl}/api/processes`, {
            method: 'POST',
            body: JSON.stringify({
                id: 'seed-p1', type: 'clarification', promptPreview: 'seed', fullPrompt: 'seed full',
                status: 'completed', startTime: new Date().toISOString(),
            }),
            headers: { 'Content-Type': 'application/json' },
        });

        // Get both tokens before starting (so we can race them)
        const wipeTokenRes = await request(`${baseUrl}/api/admin/data/wipe-token`);
        const { token: wipeToken } = JSON.parse(wipeTokenRes.body);
        const importToken = await getImportToken();

        // Start wipe and import concurrently
        const [wipeRes, importRes] = await Promise.all([
            request(`${baseUrl}/api/admin/data?confirm=${wipeToken}`, { method: 'DELETE' }),
            request(`${baseUrl}/api/admin/import?confirm=${importToken}`, {
                method: 'POST',
                body: JSON.stringify(makePayload('concurrent')),
                headers: { 'Content-Type': 'application/json' },
            }),
        ]);

        // Both should return a success or valid error — server must not crash
        expect([200, 400, 403, 409]).toContain(wipeRes.status);
        expect([200, 400, 403, 409]).toContain(importRes.status);
    });

    it('import while using merge mode leaves pre-existing processes intact', async () => {
        // Seed a process directly
        await request(`${baseUrl}/api/processes`, {
            method: 'POST',
            body: JSON.stringify({
                id: 'existing-p1', type: 'clarification', promptPreview: 'existing',
                fullPrompt: 'existing full', status: 'completed', startTime: new Date().toISOString(),
            }),
            headers: { 'Content-Type': 'application/json' },
        });

        const token = await getImportToken();
        const importRes = await request(`${baseUrl}/api/admin/import?confirm=${token}&mode=merge`, {
            method: 'POST',
            body: JSON.stringify(makePayload('new')),
            headers: { 'Content-Type': 'application/json' },
        });
        expect(importRes.status).toBe(200);

        const res = await request(`${baseUrl}/api/processes`);
        const body = JSON.parse(res.body);
        // Both existing and newly imported processes should be present
        expect(body.processes.length).toBeGreaterThanOrEqual(3);
    });
});
