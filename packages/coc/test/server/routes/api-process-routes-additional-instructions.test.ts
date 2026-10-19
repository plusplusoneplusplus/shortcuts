/**
 * Sentinel additional-instructions routes: GET/PUT
 * /api/processes/:id/additional-instructions. Uses a real SQLite process store
 * so round-trips survive a store reopen (server restart). Covers the
 * default-off flag gate, Sentinel-only and owning-workspace validation, input
 * validation and limits, clearing, unrelated-metadata preservation, isolation
 * between chats/workspaces/forks, and protection from generic metadata writes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { SENTINEL_ADDITIONAL_INSTRUCTIONS_MAX_CHARS } from '@plusplusoneplusplus/coc-client';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import type { Route } from '../../../src/server/types';

function request(baseUrl: string, urlPath: string, options: { method?: string; body?: string } = {}) {
    return new Promise<{ status: number; body: string; json: () => any }>((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request({
            hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search,
            method: options.method || 'GET', headers: { 'Content-Type': 'application/json' },
        }, res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf-8');
                resolve({ status: res.statusCode || 0, body, json: () => JSON.parse(body) });
            });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

describe('Sentinel additional-instructions routes', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    let server: http.Server;
    let baseUrl: string;
    let enabled: boolean;

    const listen = async () => {
        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes, store, dataDir, gitOpsStore: {} as any,
            getLiveFeatureFlags: () => ({ sentinelAdditionalInstructionsEnabled: enabled } as any),
        });
        server = http.createServer(createRouter({ routes }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    };
    const close = async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        store.close();
    };
    const addChat = (id: string, workspaceId: string, mode: string, extra: Record<string, unknown> = {}) => store.addProcess({
        id, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: id,
        metadata: { type: 'chat', workspaceId, mode, ...extra },
    } as any);
    const url = (id: string, ws: string) => `/api/processes/${id}/additional-instructions?workspace=${ws}`;
    const put = (id: string, body: unknown, ws = 'ws-a') => request(baseUrl, url(id, ws), { method: 'PUT', body: JSON.stringify(body) });
    const get = (id: string, ws = 'ws-a') => request(baseUrl, url(id, ws));

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-additional-instructions-'));
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        enabled = true;
        await addChat('s1', 'ws-a', 'sentinel', { autoCompact: { enabled: true, thresholdTokens: 700000 }, pinnedNote: 'keep' });
        await addChat('s2', 'ws-a', 'sentinel');
        await addChat('s3', 'ws-b', 'sentinel');
        await addChat('plain', 'ws-a', 'ask');
        await listen();
    });

    afterEach(async () => {
        await close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('reads empty when unset and round-trips multiline plain text', async () => {
        const empty = await get('s1');
        expect(empty.status).toBe(200);
        expect(empty.json()).toEqual({ additionalInstructions: { text: '' } });

        const text = 'Prefer <b>small</b> PRs.\r\n\r\n  - cite ./path/to/file\n';
        const saved = await put('s1', { text });
        expect(saved.status).toBe(200);
        expect(saved.json().additionalInstructions.text).toBe('Prefer <b>small</b> PRs.\n\n  - cite ./path/to/file');
        expect(typeof saved.json().additionalInstructions.updatedAt).toBe('string');
        expect((await get('s1')).json().additionalInstructions.text).toBe('Prefer <b>small</b> PRs.\n\n  - cite ./path/to/file');
    });

    it('survives a server restart and preserves unrelated metadata', async () => {
        await put('s1', { text: 'Alpha rules' });
        await close();
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        await listen();

        expect((await get('s1')).json().additionalInstructions.text).toBe('Alpha rules');
        const meta = (await store.getProcess('s1'))!.metadata!;
        expect(meta).toMatchObject({ mode: 'sentinel', workspaceId: 'ws-a', pinnedNote: 'keep',
            autoCompact: { enabled: true, thresholdTokens: 700000 } });
    });

    it('clears on empty or whitespace-only text without touching other metadata', async () => {
        await put('s1', { text: 'Alpha' });
        for (const text of ['', '  \n\t ']) {
            await put('s1', { text: 'Alpha' });
            const cleared = await put('s1', { text });
            expect(cleared.status).toBe(200);
            expect(cleared.json()).toEqual({ additionalInstructions: { text: '' } });
            const meta = (await store.getProcess('s1'))!.metadata!;
            expect(meta.additionalInstructions).toBeUndefined();
            expect(meta.pinnedNote).toBe('keep');
        }
    });

    it('isolates values between chats, workspaces and forks', async () => {
        await put('s1', { text: 'One' });
        await put('s2', { text: 'Two' });
        await put('s3', { text: 'Three' }, 'ws-b');
        expect((await get('s1')).json().additionalInstructions.text).toBe('One');
        expect((await get('s2')).json().additionalInstructions.text).toBe('Two');
        expect((await get('s3', 'ws-b')).json().additionalInstructions.text).toBe('Three');
        // Wrong owner workspace never resolves the chat.
        expect((await get('s3', 'ws-a')).status).toBe(404);
        expect((await put('s3', { text: 'x' }, 'ws-a')).status).toBe(404);
        expect((await get('s3', 'ws-b')).json().additionalInstructions.text).toBe('Three');

        await addChat('fresh', 'ws-a', 'sentinel');
        expect((await get('fresh')).json().additionalInstructions.text).toBe('');
        const fork = await store.forkProcess('s1', 'forked');
        expect(fork.metadata?.additionalInstructions).toBeUndefined();
        expect((await get('forked')).json().additionalInstructions.text).toBe('');
    });

    it('rejects invalid payloads, oversize text and non-Sentinel chats', async () => {
        for (const body of [{}, { text: 1 }, { text: null }, [], { text: 'ok', extra: true }]) {
            expect((await put('s1', body)).status).toBe(400);
        }
        const malformed = await request(baseUrl, url('s1', 'ws-a'), { method: 'PUT', body: '{bad' });
        expect(malformed.status).toBe(400);
        expect((await put('s1', { text: 'x'.repeat(SENTINEL_ADDITIONAL_INSTRUCTIONS_MAX_CHARS + 1) })).status).toBe(400);
        expect((await put('s1', { text: 'x'.repeat(SENTINEL_ADDITIONAL_INSTRUCTIONS_MAX_CHARS) })).status).toBe(200);

        const plain = await put('plain', { text: 'x' });
        expect(plain.status).toBe(422);
        expect(plain.body).toContain('ADDITIONAL_INSTRUCTIONS_SENTINEL_ONLY');
        expect((await get('plain')).status).toBe(422);
        expect((await put('missing', { text: 'x' })).status).toBe(404);
        expect((await store.getProcess('plain'))!.metadata!.additionalInstructions).toBeUndefined();
    });

    it('is unavailable while the flag is off and retains saved data', async () => {
        await put('s1', { text: 'Kept' });
        enabled = false;
        const off = await get('s1');
        expect(off.status).toBe(404);
        expect(off.body).toContain('ADDITIONAL_INSTRUCTIONS_DISABLED');
        expect((await put('s1', { text: 'Changed' })).status).toBe(404);
        enabled = true;
        expect((await get('s1')).json().additionalInstructions.text).toBe('Kept');
    });

    it('keeps the value out of generic metadata writes', async () => {
        await put('s1', { text: 'Owned' });
        const patchUrl = '/api/processes/s1?workspace=ws-a';
        const patchSet = await request(baseUrl, patchUrl, { method: 'PATCH',
            body: JSON.stringify({ metadataPatch: { set: { additionalInstructions: { text: 'hijack' } } } }) });
        expect(patchSet.status).toBe(400);
        const patchUnset = await request(baseUrl, patchUrl, { method: 'PATCH',
            body: JSON.stringify({ metadataPatch: { unset: ['additionalInstructions'] } }) });
        expect(patchUnset.status).toBe(400);

        const meta = (await store.getProcess('s1'))!.metadata!;
        const replace = await request(baseUrl, patchUrl, { method: 'PATCH',
            body: JSON.stringify({ metadata: { ...meta, additionalInstructions: { text: 'hijack' }, extra: 1 } }) });
        expect(replace.status).toBe(200);
        expect((await get('s1')).json().additionalInstructions.text).toBe('Owned');

        await request(baseUrl, '/api/processes/s2?workspace=ws-a', { method: 'PATCH',
            body: JSON.stringify({ metadata: { type: 'chat', workspaceId: 'ws-a', mode: 'sentinel', additionalInstructions: { text: 'inject' } } }) });
        expect((await get('s2')).json().additionalInstructions.text).toBe('');
    });
});
