/**
 * GET /api/processes/:id — opt-in children + gzip tests.
 *
 * Verifies the perf changes:
 *   - children are NOT embedded unless `?include=children` is passed
 *   - large responses are gzipped when the client advertises gzip support
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';

vi.mock('../../../src/server/streaming/sse-handler', () => ({
    handleProcessStream: vi.fn(),
    emitMessageQueued: vi.fn(),
    emitPendingMessageAdded: vi.fn(),
    emitMessageSteering: vi.fn(),
}));

vi.mock('../../../src/server/core/attachment-utils', () => ({
    processMessageAttachments: vi.fn().mockReturnValue({
        sdkAttachments: [], validatedImages: undefined, fileAttachmentMeta: undefined, textContext: undefined,
    }),
    hasAttachments: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/server/core/image-utils', () => ({
    saveImagesToTempFiles: vi.fn(),
    cleanupTempDir: vi.fn(),
    isImageDataUrl: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/server/memory/conversation-recorder', () => ({
    recordUserMessage: vi.fn(),
}));

function fetchRaw(
    baseUrl: string,
    urlPath: string,
    options: { headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'GET',
                headers: options.headers ?? {},
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks),
                    });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

describe('GET /api/processes/:id perf behaviour', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();
        const parent = {
            id: 'parent-1',
            type: 'chat' as const,
            status: 'completed' as const,
            startTime: new Date(),
            endTime: new Date(),
            promptPreview: 'parent',
            metadata: {},
            workingDirectory: '/tmp',
            conversationTurns: [],
        };
        const child = {
            id: 'child-1',
            type: 'chat' as const,
            status: 'completed' as const,
            startTime: new Date(),
            endTime: new Date(),
            promptPreview: 'child',
            parentProcessId: 'parent-1',
            metadata: {},
            workingDirectory: '/tmp',
            conversationTurns: [],
        };
        store.processes.set('parent-1', parent as any);
        store.processes.set('child-1', child as any);

        // Inflate a third process with a chunky `result` so we can verify gzip kicks in.
        const big = {
            id: 'big-1',
            type: 'chat' as const,
            status: 'completed' as const,
            startTime: new Date(),
            endTime: new Date(),
            promptPreview: 'big',
            result: 'x'.repeat(50_000),
            metadata: { description: 'y'.repeat(20_000) },
            workingDirectory: '/tmp',
            conversationTurns: [],
        };
        store.processes.set('big-1', big as any);

        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes,
            store,
            dataDir: '/tmp/test-coc-perf',
            gitOpsStore: {} as any,
        });
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('omits children from the response by default', async () => {
        const res = await fetchRaw(baseUrl, '/api/processes/parent-1');
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body.toString('utf-8'));
        expect(data.process?.id).toBe('parent-1');
        expect(Array.isArray(data.children)).toBe(true);
        expect(data.children).toHaveLength(0);
        expect(data.total).toBe(0);
    });

    it('embeds children when ?include=children is set', async () => {
        const res = await fetchRaw(baseUrl, '/api/processes/parent-1?include=children');
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body.toString('utf-8'));
        expect(data.children).toHaveLength(1);
        expect(data.children[0].id).toBe('child-1');
        expect(data.total).toBe(1);
    });

    it('returns raw JSON when Accept-Encoding does not include gzip', async () => {
        const res = await fetchRaw(baseUrl, '/api/processes/big-1');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        // Plain JSON body should parse and contain the big result.
        const data = JSON.parse(res.body.toString('utf-8'));
        expect(data.process?.result?.length).toBeGreaterThan(40_000);
    });

    it('gzips large JSON responses when Accept-Encoding: gzip is present', async () => {
        const res = await fetchRaw(baseUrl, '/api/processes/big-1', {
            headers: { 'Accept-Encoding': 'gzip' },
        });
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        // Compressed body should be much smaller than the raw JSON (70K+ uncompressed).
        expect(res.body.length).toBeLessThan(10_000);
        // And decompress back to the original payload.
        const zlib = await import('zlib');
        const decoded = zlib.gunzipSync(res.body).toString('utf-8');
        const data = JSON.parse(decoded);
        expect(data.process?.id).toBe('big-1');
        expect(data.process?.result?.length).toBeGreaterThan(40_000);
    });
});
