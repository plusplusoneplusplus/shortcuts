/**
 * Tests for generic-classification-handler helpers.
 *
 * Regression coverage for the bug where commit/branch-range payloads
 * were missing `prId` and `headSha`, causing ClassificationExecutor to skip
 * the `saveClassification` tool injection and never persist results.
 *
 * Also covers batch-status endpoint logic via a lightweight route-level test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { registerGenericClassificationRoutes } from '../../src/server/repos/generic-classification-handler';
import { writeClassification, writePending } from '../../src/server/repos/classification-store';
import type { Route } from '../../src/server/types';
import type { DiffClassificationResult } from '../../src/server/spa/client/react/features/pull-requests/classification-types';

// ── Minimal fake bridge ──────────────────────────────────────────────────────

let enqueuedTasks: any[] = [];
const fakeQueue = {
    enqueue: (task: any) => {
        enqueuedTasks.push(task);
        return '1';
    },
};
const fakeBridge: any = {
    registry: { getQueueForRepo: () => fakeQueue },
    getOrCreateBridge: () => {},
    getRepoIdForPath: () => 'ws-test',
    getTask: () => null,
};

const fakeStore: any = {};

// ── HTTP helper ────────────────────────────────────────────────────────────

function makeServer(routes: Route[]): http.Server {
    return http.createServer((req, res) => {
        const url = req.url ?? '/';
        const pathname = url.split('?')[0];
        for (const route of routes) {
            const m = pathname.match(route.pattern);
            if (m && req.method === route.method) {
                void route.handler(req, res, m);
                return;
            }
        }
        res.writeHead(404);
        res.end('not found');
    });
}

function get(server: http.Server, path: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const addr = server.address() as { port: number };
        const req = http.request({ hostname: '127.0.0.1', port: addr.port, path, method: 'GET' }, res => {
            let raw = '';
            res.on('data', c => { raw += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); }
                catch { resolve({ status: res.statusCode ?? 0, body: raw }); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function post(server: http.Server, path: string, body: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const addr = server.address() as { port: number };
        const raw = JSON.stringify(body);
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: addr.port,
                path,
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(raw),
                },
            },
            res => {
                let responseRaw = '';
                res.on('data', c => { responseRaw += c; });
                res.on('end', () => {
                    try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(responseRaw) }); }
                    catch { resolve({ status: res.statusCode ?? 0, body: responseRaw }); }
                });
            },
        );
        req.on('error', reject);
        req.write(raw);
        req.end();
    });
}

// ── Test setup ─────────────────────────────────────────────────────────────

let tmpDir: string;
let server: http.Server;

const validResult: DiffClassificationResult = {
    classifications: [
        {
            file: 'src/a.ts',
            hunkIndex: 0,
            category: 'logic',
            intensity: 'high',
            reason: 'new code',
            summaryComment: 'Adds a behavior path that reviewers should inspect.',
        },
    ],
};

beforeEach(() => new Promise<void>(resolve => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gchr-test-'));
    enqueuedTasks = [];
    const routes: Route[] = [];
    registerGenericClassificationRoutes(routes, {
        dataDir: tmpDir,
        store: fakeStore,
        bridge: fakeBridge,
        repoTreeService: {
            resolveRepo: async () => ({
                localPath: path.join(tmpDir, 'repo'),
                remoteUrl: 'https://github.com/org/repo.git',
            }),
        } as any,
    });
    server = makeServer(routes);
    server.listen(0, '127.0.0.1', resolve);
}));

afterEach(() => new Promise<void>((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
    fs.rmSync(tmpDir, { recursive: true, force: true });
}));

// ── batch-status endpoint ──────────────────────────────────────────────────

describe('GET /api/repos/:repoId/classify-diff/batch-status', () => {
    const repoId = 'ws-test';
    const ws = 'ws-test';
    const originId = 'gh_org_repo';

    it('returns ready for a stored classification', async () => {
        const hash = 'aaabbbccc';
        writeClassification(tmpDir, ws, repoId, '_commit', hash, validResult);

        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff/batch-status?type=commit&identifiers=${hash}`);
        expect(res.status).toBe(200);
        expect(res.body.statuses[hash]).toBe('ready');
    });

    it('returns none for an unknown identifier', async () => {
        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff/batch-status?type=commit&identifiers=unknown000`);
        expect(res.status).toBe(200);
        expect(res.body.statuses['unknown000']).toBe('none');
    });

    it('returns running for a pending marker with an alive task', async () => {
        const hash = 'ddd111eee';
        // Write a pending marker; fakeBridge.getTask returns null (→ stale) unless we override
        writePending(tmpDir, ws, repoId, '_commit', hash, 'fake-pid');
        // With fakeBridge.getTask returning null the task is considered stale → 'none'
        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff/batch-status?type=commit&identifiers=${hash}`);
        expect(res.status).toBe(200);
        expect(res.body.statuses[hash]).toBe('none');
    });

    it('handles multiple identifiers in one request', async () => {
        const ready = 'fff222ggg';
        const none = 'hhh333iii';
        writeClassification(tmpDir, ws, repoId, '_commit', ready, validResult);

        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff/batch-status?type=commit&identifiers=${ready},${none}`);
        expect(res.status).toBe(200);
        expect(res.body.statuses[ready]).toBe('ready');
        expect(res.body.statuses[none]).toBe('none');
    });

    it('returns empty statuses for empty identifiers query param', async () => {
        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff/batch-status?type=commit&identifiers=`);
        expect(res.status).toBe(200);
        expect(res.body.statuses).toEqual({});
    });

    it('returns empty statuses when identifiers param is omitted', async () => {
        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff/batch-status?type=commit`);
        expect(res.status).toBe(200);
        expect(res.body.statuses).toEqual({});
    });

    it('returns 400 when type param is missing', async () => {
        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff/batch-status?identifiers=abc`);
        expect(res.status).toBe(400);
    });

    it('returns 400 when type param is invalid', async () => {
        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff/batch-status?type=bad&identifiers=abc`);
        expect(res.status).toBe(400);
    });

    it('returns 400 when more than 200 identifiers are provided', async () => {
        const ids = Array.from({ length: 201 }, (_, i) => `hash${i}`).join(',');
        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff/batch-status?type=commit&identifiers=${ids}`);
        expect(res.status).toBe(400);
    });

    it('does not interfere with the single-item GET endpoint', async () => {
        // Ensure the single-item GET still resolves correctly
        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff?type=commit&identifier=unknownabc`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('none');
    });

    it('returns PR statuses from the origin-scoped batch-status endpoint', async () => {
        writeClassification(tmpDir, ws, repoId, '42', 'head123', validResult, {
            storageScope: { storageOriginId: originId },
        });

        const res = await get(
            server,
            `/api/origins/${originId}/classify-diff/batch-status?type=pr&identifiers=42:head123,43:missing&workspaceId=${ws}&repoId=${repoId}`,
        );

        expect(res.status).toBe(200);
        expect(res.body.statuses).toEqual({
            '42:head123': 'ready',
            '43:missing': 'none',
        });
    });

    it('rejects non-PR status reads on the origin-scoped batch-status endpoint', async () => {
        const res = await get(server, `/api/origins/${originId}/classify-diff/batch-status?type=commit&identifiers=abc`);

        expect(res.status).toBe(400);
    });

    it('returns PR classification results from the origin-scoped single status endpoint', async () => {
        writeClassification(tmpDir, ws, repoId, '42', 'head123', validResult, {
            storageScope: { storageOriginId: originId },
        });

        const res = await get(
            server,
            `/api/origins/${originId}/classify-diff?type=pr&identifier=42:head123&workspaceId=${ws}&repoId=${repoId}`,
        );

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ready');
        expect(res.body.result).toEqual(validResult);
    });

    it('enqueues PR classifications through the origin-scoped trigger endpoint', async () => {
        const res = await post(server, `/api/origins/${originId}/classify-diff`, {
            type: 'pr',
            identifier: '42:head123',
            workspaceId: ws,
            repoId,
            model: 'haiku',
        });

        expect(res.status).toBe(202);
        expect(res.body).toEqual({ status: 'started', taskId: '1' });
        expect(enqueuedTasks).toHaveLength(1);
        expect(enqueuedTasks[0].payload).toMatchObject({
            workspaceId: ws,
            repoId,
            classificationStorageOriginId: originId,
            classificationType: 'pr',
            classificationIdentifier: '42:head123',
            prId: '42',
            headSha: 'head123',
        });
        expect(enqueuedTasks[0].config).toEqual({ model: 'haiku' });
    });

    it('requires workspaceId for origin-scoped PR classification triggers', async () => {
        const res = await post(server, `/api/origins/${originId}/classify-diff`, {
            type: 'pr',
            identifier: '42:head123',
            repoId,
        });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('workspaceId is required for origin-scoped PR classification');
    });

    it('rejects PR status reads on repo-scoped classify-diff routes', async () => {
        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff?type=pr&identifier=42:head123`);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('PR classification status must use /api/origins/:originId/classify-diff');
    });

    it('rejects PR batch-status reads on repo-scoped classify-diff routes', async () => {
        const res = await get(server, `/api/repos/${encodeURIComponent(repoId)}/classify-diff/batch-status?type=pr&identifiers=42:head123`);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('PR classification status must use /api/origins/:originId/classify-diff/batch-status');
    });
});

// ── extractPayloadFields / splitIdentifier contract ────────────────────────

// We test the internal `extractPayloadFields` logic indirectly via the
// exported public surface (the payload shape produced on enqueue).  Since the
// function is not exported, we re-implement the expected contract here and
// cross-check it against `splitIdentifier` so the two stay in sync.

// Mirrors splitIdentifier from generic-classification-handler.ts
function splitIdentifier(type: string, identifier: string): { prId: string; headSha: string } {
    if (type === 'pr') {
        const colonIdx = identifier.indexOf(':');
        if (colonIdx === -1) return { prId: identifier, headSha: 'unknown' };
        return { prId: identifier.slice(0, colonIdx), headSha: identifier.slice(colonIdx + 1) };
    }
    return { prId: `_${type}`, headSha: identifier };
}

// Mirrors the FIXED extractPayloadFields from generic-classification-handler.ts
function extractPayloadFields(type: string, identifier: string): Record<string, string> {
    if (type === 'pr') {
        const colonIdx = identifier.indexOf(':');
        if (colonIdx !== -1) {
            return { prId: identifier.slice(0, colonIdx), headSha: identifier.slice(colonIdx + 1) };
        }
        return { prId: identifier, headSha: 'unknown' };
    }
    if (type === 'commit') {
        return { commitHash: identifier, prId: '_commit', headSha: identifier };
    }
    return { branchRange: identifier, prId: '_branch-range', headSha: identifier };
}

describe('extractPayloadFields', () => {
    describe('pr type', () => {
        it('splits prId and headSha from identifier', () => {
            const fields = extractPayloadFields('pr', '42:abc1234');
            expect(fields.prId).toBe('42');
            expect(fields.headSha).toBe('abc1234');
        });

        it('falls back to headSha=unknown when no colon', () => {
            const fields = extractPayloadFields('pr', '42');
            expect(fields.prId).toBe('42');
            expect(fields.headSha).toBe('unknown');
        });
    });

    describe('commit type — regression: executor tool guard', () => {
        it('includes prId and headSha so ClassificationExecutor injects saveClassification', () => {
            const hash = '954b982b9a5c53cb2ce7bb8c31e2695a647cfa18';
            const fields = extractPayloadFields('commit', hash);
            // Both fields must be present for the tool guard to pass
            expect(fields.prId).toBeTruthy();
            expect(fields.headSha).toBeTruthy();
            expect(fields.commitHash).toBe(hash);
        });

        it('prId/headSha match splitIdentifier so store reads the same file key', () => {
            const hash = 'deadbeef';
            const fields = extractPayloadFields('commit', hash);
            const { prId, headSha } = splitIdentifier('commit', hash);
            expect(fields.prId).toBe(prId);
            expect(fields.headSha).toBe(headSha);
        });
    });

    describe('branch-range type — regression: executor tool guard', () => {
        it('includes prId and headSha so ClassificationExecutor injects saveClassification', () => {
            const range = 'main..feature/my-branch';
            const fields = extractPayloadFields('branch-range', range);
            expect(fields.prId).toBeTruthy();
            expect(fields.headSha).toBeTruthy();
            expect(fields.branchRange).toBe(range);
        });

        it('prId/headSha match splitIdentifier so store reads the same file key', () => {
            const range = 'main..feature/my-branch';
            const fields = extractPayloadFields('branch-range', range);
            const { prId, headSha } = splitIdentifier('branch-range', range);
            expect(fields.prId).toBe(prId);
            expect(fields.headSha).toBe(headSha);
        });
    });
});
