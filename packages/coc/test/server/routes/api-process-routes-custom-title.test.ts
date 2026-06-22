/**
 * REST PATCH /api/processes/:id customTitle Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../../src/server/index';
import type { ExecutionServer } from '../../../src/server/types';

function request(url: string, options: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method: options.method || 'GET',
            headers: options.headers,
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function patchJSON(url: string, data: unknown) {
    return request(url, { method: 'PATCH', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
}

describe('PATCH /api/processes/:id — customTitle', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;
    let store: SqliteProcessStore;
    const wsId = 'ws-rename-test';

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
        await store.registerWorkspace({ id: wsId, name: 'Test', rootPath: '/tmp/x' });
        server = await createExecutionServer({ port: 0, dataDir: tmpDir, store });
        baseUrl = server.url;
    });

    afterEach(async () => {
        await server.close();
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function addProcess(id: string, extras?: Record<string, unknown>) {
        await store.addProcess({
            id,
            type: 'ai',
            promptPreview: 'hello',
            fullPrompt: 'hello full',
            status: 'completed',
            startTime: new Date('2024-01-01T00:00:00Z'),
            endTime: new Date('2024-01-01T00:01:00Z'),
            metadata: { type: 'ai', workspaceId: wsId },
            ...extras,
        });
    }

    it('persists customTitle and returns the updated process', async () => {
        await addProcess('p-rename-1');
        const res = await patchJSON(`${baseUrl}/api/processes/p-rename-1`, { customTitle: 'My Renamed Chat' });
        expect(res.status).toBe(200);
        const loaded = await store.getProcess('p-rename-1');
        expect(loaded?.customTitle).toBe('My Renamed Chat');
    });

    it('rejects customTitle longer than 80 chars with 400', async () => {
        await addProcess('p-rename-2');
        const tooLong = 'x'.repeat(81);
        const res = await patchJSON(`${baseUrl}/api/processes/p-rename-2`, { customTitle: tooLong });
        expect(res.status).toBe(400);
    });

    it('rejects non-string customTitle (non-null) with 400', async () => {
        await addProcess('p-rename-3');
        const res = await patchJSON(`${baseUrl}/api/processes/p-rename-3`, { customTitle: 123 });
        expect(res.status).toBe(400);
    });

    it('clears customTitle when given null', async () => {
        await addProcess('p-rename-4');
        await patchJSON(`${baseUrl}/api/processes/p-rename-4`, { customTitle: 'Will be cleared' });
        const res = await patchJSON(`${baseUrl}/api/processes/p-rename-4`, { customTitle: null });
        expect(res.status).toBe(200);
        const loaded = await store.getProcess('p-rename-4');
        expect(loaded?.customTitle).toBeFalsy();
    });

    it('does not change the AI-generated title column', async () => {
        await addProcess('p-rename-5', { title: 'AI Generated Title' });
        await patchJSON(`${baseUrl}/api/processes/p-rename-5`, { customTitle: 'User Pick' });
        const loaded = await store.getProcess('p-rename-5');
        expect(loaded?.title).toBe('AI Generated Title');
        expect(loaded?.customTitle).toBe('User Pick');
    });

    it('merges metadataPatch into existing metadata without dropping mode or workspaceId', async () => {
        await addProcess('p-metadata-patch-1', {
            metadata: {
                type: 'chat',
                workspaceId: wsId,
                mode: 'ask',
                provider: 'claude',
                staleField: 'remove-me',
            },
        });

        const res = await patchJSON(`${baseUrl}/api/processes/p-metadata-patch-1`, {
            metadataPatch: {
                set: {
                    planFilePath: '/tmp/new.plan.md',
                },
                unset: ['staleField'],
            },
        });

        expect(res.status).toBe(200);
        const loaded = await store.getProcess('p-metadata-patch-1');
        expect(loaded?.metadata).toMatchObject({
            type: 'chat',
            workspaceId: wsId,
            mode: 'ask',
            provider: 'claude',
            planFilePath: '/tmp/new.plan.md',
        });
        expect(loaded?.metadata?.staleField).toBeUndefined();
    });

    it('rejects requests that mix full metadata replacement with metadataPatch', async () => {
        await addProcess('p-metadata-patch-2');

        const res = await patchJSON(`${baseUrl}/api/processes/p-metadata-patch-2`, {
            metadata: { planFilePath: '/tmp/full-overwrite.plan.md' },
            metadataPatch: { set: { goalFilePath: '/tmp/goal.goal.md' } },
        });

        expect(res.status).toBe(400);
        const loaded = await store.getProcess('p-metadata-patch-2');
        expect(loaded?.metadata).toMatchObject({ type: 'ai', workspaceId: wsId });
        expect(loaded?.metadata?.planFilePath).toBeUndefined();
        expect(loaded?.metadata?.goalFilePath).toBeUndefined();
    });

    it('rejects malformed metadataPatch without mutating metadata', async () => {
        await addProcess('p-metadata-patch-3', {
            metadata: {
                type: 'chat',
                workspaceId: wsId,
                mode: 'ask',
            },
        });

        const res = await patchJSON(`${baseUrl}/api/processes/p-metadata-patch-3`, {
            metadataPatch: {
                set: ['not-an-object'],
            },
        });

        expect(res.status).toBe(400);
        const loaded = await store.getProcess('p-metadata-patch-3');
        expect(loaded?.metadata).toMatchObject({
            type: 'chat',
            workspaceId: wsId,
            mode: 'ask',
        });
        expect(loaded?.metadata?.planFilePath).toBeUndefined();
    });
});
