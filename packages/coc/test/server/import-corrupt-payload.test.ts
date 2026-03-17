/**
 * Import Corrupt / Malformed Payload Tests
 *
 * Section 3: Sends raw HTTP requests to POST /api/admin/import with various
 * corrupt or malformed bodies and verifies appropriate error responses.
 *
 * Endpoint: POST /api/admin/import?confirm=<token>
 * Token source: GET /api/admin/import-token (fresh token per test)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { FileProcessStore } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: {
        method?: string;
        body?: string | Buffer;
        headers?: Record<string, string>;
    } = {},
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

// ============================================================================
// Tests
// ============================================================================

describe('Import Corrupt / Malformed Payload (HTTP) — Section 3', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let baseUrl: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-corrupt-test-'));
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        baseUrl = server.url;
    });

    afterEach(async () => {
        if (server) { await server.close(); server = undefined; }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    /** Get a fresh import confirmation token. Each test needs its own token (one-time use). */
    async function getImportToken(): Promise<string> {
        const res = await request(`${baseUrl}/api/admin/import-token`);
        return JSON.parse(res.body).token;
    }

    it('truncated JSON body → 400 INVALID_JSON', async () => {
        const token = await getImportToken();
        const res = await request(`${baseUrl}/api/admin/import?confirm=${token}`, {
            method: 'POST',
            body: '{"version": 1, "exportedAt":',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.code).toBe('INVALID_JSON');
    });

    it('binary data body → 400', async () => {
        const token = await getImportToken();
        const res = await request(`${baseUrl}/api/admin/import?confirm=${token}`, {
            method: 'POST',
            body: Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]),
            headers: { 'Content-Type': 'application/octet-stream' },
        });
        expect(res.status).toBe(400);
    });

    it('root type is array [] → 400 (object required)', async () => {
        const token = await getImportToken();
        const res = await request(`${baseUrl}/api/admin/import?confirm=${token}`, {
            method: 'POST',
            body: JSON.stringify([{ id: 'p1' }]),
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('empty object {} → 400 (missing required fields)', async () => {
        const token = await getImportToken();
        const res = await request(`${baseUrl}/api/admin/import?confirm=${token}`, {
            method: 'POST',
            body: '{}',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        // Error message should indicate a required field is missing
        expect(body.error).toBeDefined();
        expect(typeof body.error).toBe('string');
    });

    it('JSON string root "just a string" → 400', async () => {
        const token = await getImportToken();
        const res = await request(`${baseUrl}/api/admin/import?confirm=${token}`, {
            method: 'POST',
            body: '"just a string"',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('JSON number root 42 → 400', async () => {
        const token = await getImportToken();
        const res = await request(`${baseUrl}/api/admin/import?confirm=${token}`, {
            method: 'POST',
            body: '42',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('JSON null root → 400', async () => {
        const token = await getImportToken();
        const res = await request(`${baseUrl}/api/admin/import?confirm=${token}`, {
            method: 'POST',
            body: 'null',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('very deeply nested object (1000 levels) → handled without stack overflow', async () => {
        const token = await getImportToken();
        // Build a deeply nested object to check for stack overflow / crash
        let nested: any = { value: 'leaf' };
        for (let i = 0; i < 1000; i++) {
            nested = { child: nested };
        }
        const res = await request(`${baseUrl}/api/admin/import?confirm=${token}`, {
            method: 'POST',
            body: JSON.stringify(nested),
            headers: { 'Content-Type': 'application/json' },
        });
        // Should not crash — expected 400 for invalid (non-payload) structure
        expect(res.status).toBe(400);
    });
});
