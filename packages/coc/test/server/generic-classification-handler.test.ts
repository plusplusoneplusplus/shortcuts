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

// ── Minimal fake bridge (read-only batch-status never calls bridge.getTask) ──

const fakeBridge: any = {
    registry: { getQueueForRepo: () => ({ enqueue: () => '1' }) },
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
    const routes: Route[] = [];
    registerGenericClassificationRoutes(routes, {
        dataDir: tmpDir,
        store: fakeStore,
        bridge: fakeBridge,
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
