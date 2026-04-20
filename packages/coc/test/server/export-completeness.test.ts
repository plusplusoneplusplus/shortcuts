/**
 * Export Completeness Tests
 *
 * Section 7: Populates the server with one of each entity type, then calls
 * GET /api/admin/export and verifies that all entities are present in the
 * response, along with the correct HTTP headers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { validateExportPayload, EXPORT_SCHEMA_VERSION } from '@plusplusoneplusplus/coc-server';
import { FileProcessStore } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
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
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString('utf-8'),
                }));
            },
        );
        req.on('error', reject);
        if (options.body !== undefined) { req.write(options.body); }
        req.end();
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Export Completeness — Section 7', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let baseUrl: string;
    let store: FileProcessStore;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-completeness-test-'));
        store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir , skipNonEssentialInit: true });
        baseUrl = server.url;
    });

    afterEach(async () => {
        if (server) { await server.close(); server = undefined; }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ========================================================================
    // HTTP Headers
    // ========================================================================

    describe('HTTP response headers', () => {
        it('GET /api/admin/export has Content-Disposition: attachment with .json filename', async () => {
            const res = await request(`${baseUrl}/api/admin/export`);
            expect(res.status).toBe(200);
            const disposition = res.headers['content-disposition'];
            expect(disposition).toBeDefined();
            expect(disposition).toContain('attachment');
            expect(disposition).toMatch(/filename="coc-export-.*\.json"/);
        });

        it('GET /api/admin/export has Content-Type: application/json', async () => {
            const res = await request(`${baseUrl}/api/admin/export`);
            expect(res.status).toBe(200);
            const ct = res.headers['content-type'];
            expect(ct).toBeDefined();
            expect(ct).toContain('application/json');
        });

        it('export response body is valid JSON (parse without error)', async () => {
            const res = await request(`${baseUrl}/api/admin/export`);
            expect(res.status).toBe(200);
            expect(() => JSON.parse(res.body)).not.toThrow();
        });

        it('export schemaVersion field matches current expected version', async () => {
            const res = await request(`${baseUrl}/api/admin/export`);
            const body = JSON.parse(res.body);
            expect(body.version).toBe(EXPORT_SCHEMA_VERSION);
        });
    });

    // ========================================================================
    // Process completeness
    // ========================================================================

    describe('process completeness', () => {
        it('export includes all seeded processes (count matches what was inserted)', async () => {
            // Seed 3 processes
            for (const id of ['ep1', 'ep2', 'ep3']) {
                await request(`${baseUrl}/api/processes`, {
                    method: 'POST',
                    body: JSON.stringify({
                        id, type: 'clarification', promptPreview: `prompt ${id}`,
                        fullPrompt: `full ${id}`, status: 'completed',
                        startTime: new Date().toISOString(),
                    }),
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            const res = await request(`${baseUrl}/api/admin/export`);
            const body = JSON.parse(res.body);
            expect(body.metadata.processCount).toBe(3);
            expect(body.processes).toHaveLength(3);
            const ids = body.processes.map((p: any) => p.id).sort();
            expect(ids).toEqual(['ep1', 'ep2', 'ep3']);
        });
    });

    // ========================================================================
    // Queue completeness
    // ========================================================================

    describe('queue completeness', () => {
        it('export includes queue file when repo queue file is present on disk', async () => {
            const repoDir = path.join(dataDir, 'repos', 'abc123');
            fs.mkdirSync(repoDir, { recursive: true });
            fs.writeFileSync(
                path.join(repoDir, 'queues.json'),
                JSON.stringify({
                    version: 3,
                    repoRootPath: '/projects/repo',
                    repoId: 'abc123',
                    pending: [{ id: 'q1', status: 'queued' }],
                    history: [{ id: 'q0', status: 'completed' }],
                    isPaused: false,
                }),
                'utf-8',
            );

            const res = await request(`${baseUrl}/api/admin/export`);
            const body = JSON.parse(res.body);
            expect(body.metadata.queueFileCount).toBe(1);
            expect(body.queueHistory).toHaveLength(1);
            const snap = body.queueHistory[0];
            expect(snap.repoId).toBe('abc123');
            expect(snap.pending).toHaveLength(1);
            expect(snap.history).toHaveLength(1);
        });
    });

    // ========================================================================
    // Preferences completeness
    // ========================================================================

    describe('preferences completeness', () => {
        it('export includes preferences when preferences.json exists', async () => {
            fs.writeFileSync(
                path.join(dataDir, 'preferences.json'),
                JSON.stringify({ global: { lastModel: 'gpt-4', lastDepth: 'deep' } }),
                'utf-8',
            );

            const res = await request(`${baseUrl}/api/admin/export`);
            const body = JSON.parse(res.body);
            expect(body.preferences).toBeDefined();
            expect(body.preferences.global.lastModel).toBe('gpt-4');
            expect(body.preferences.global.lastDepth).toBe('deep');
        });

        it('export includes empty preferences object when no preferences.json', async () => {
            const res = await request(`${baseUrl}/api/admin/export`);
            const body = JSON.parse(res.body);
            expect(body.preferences).toBeDefined();
            expect(typeof body.preferences).toBe('object');
        });
    });

    // ========================================================================
    // Wiki completeness
    // ========================================================================

    describe('wiki completeness', () => {
        it('export includes wiki registrations (metadata only, not file content)', async () => {
            // Register a wiki directly via the store (there is no POST /api/wikis HTTP endpoint)
            await store.registerWiki({
                id: 'wiki-1',
                name: 'Test Wiki',
                wikiDir: path.join(dataDir, 'wiki-output'),
                aiEnabled: false,
                registeredAt: new Date().toISOString(),
            });

            const res = await request(`${baseUrl}/api/admin/export`);
            const body = JSON.parse(res.body);
            expect(body.metadata.wikiCount).toBe(1);
            expect(body.wikis).toHaveLength(1);
            expect(body.wikis[0].id).toBe('wiki-1');
            expect(body.wikis[0].name).toBe('Test Wiki');
            // Export should NOT include wiki file content (only metadata)
            expect(body.wikis[0].fileContent).toBeUndefined();
        });
    });

    // ========================================================================
    // Payload validity
    // ========================================================================

    describe('payload validity', () => {
        it('export payload passes validateExportPayload()', async () => {
            const res = await request(`${baseUrl}/api/admin/export`);
            const body = JSON.parse(res.body);
            const result = validateExportPayload(body);
            expect(result.valid).toBe(true);
        });
    });
});
