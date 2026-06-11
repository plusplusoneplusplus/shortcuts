import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../src/server/types';
import { FileDreamStore } from '../../src/server/dreams/dream-store';
import { registerDreamRoutes } from '../../src/server/dreams/dream-routes';
import type { DreamCard } from '../../src/server/dreams/types';

const WORKSPACE_ID = 'ws-dream-routes';
const OTHER_WORKSPACE_ID = 'ws-dream-routes-other';

interface FakeRes {
    statusCode: number;
    body: any;
    headers: Record<string, string>;
}

function createFakeRes(): FakeRes & {
    writeHead: (status: number, headers?: Record<string, string>) => void;
    end: (data?: string) => void;
    setHeader: (name: string, value: string) => void;
} {
    const res: any = {
        statusCode: 200,
        body: null,
        headers: {},
        writeHead(status: number, headers?: Record<string, string>) {
            res.statusCode = status;
            if (headers) Object.assign(res.headers, headers);
        },
        end(data?: string) {
            if (data) {
                try { res.body = JSON.parse(data); } catch { res.body = data; }
            }
        },
        setHeader(name: string, value: string) {
            res.headers[name.toLowerCase()] = value;
        },
    };
    return res;
}

function createFakeReq(method: string, urlPath: string, body?: Record<string, unknown>) {
    const chunks: Buffer[] = [];
    if (body !== undefined) {
        chunks.push(Buffer.from(JSON.stringify(body)));
    }
    return {
        method,
        url: urlPath,
        headers: { 'content-type': 'application/json' },
        on(event: string, cb: (data?: Buffer) => void) {
            if (event === 'data') {
                for (const chunk of chunks) cb(chunk);
            }
            if (event === 'end') cb();
            return this;
        },
    } as any;
}

async function dispatch(
    routes: Route[],
    method: string,
    urlPath: string,
    body?: Record<string, unknown>,
): Promise<FakeRes> {
    const pathname = urlPath.split('?')[0];
    const route = routes.find(r => r.method === method && r.pattern instanceof RegExp && r.pattern.test(pathname));
    if (!route) throw new Error(`No route matched ${method} ${urlPath}`);
    const match = pathname.match(route.pattern as RegExp);
    const res = createFakeRes();
    const req = createFakeReq(method, urlPath, body);
    await route.handler(req, res as any, match);
    return res;
}

let candidateSequence = 0;

function candidateInput(workspaceId = WORKSPACE_ID) {
    candidateSequence += 1;
    return {
        workspaceId,
        category: 'product-improvement' as const,
        sourceRanges: [{ processId: `process-${workspaceId}-${candidateSequence}`, startTurnIndex: 0, endTurnIndex: 1 }],
        observedPattern: `The user repeatedly asks to review generated improvement suggestions ${candidateSequence}.`,
        whyItMatters: 'Reviewable suggestions reduce accidental product churn while preserving user control.',
        recommendation: `Add a dedicated review surface for generated improvement suggestions ${candidateSequence}.`,
        expectedImpact: 'Users can approve or dismiss suggestions with less context switching.',
        confidence: 0.91,
        notAlreadyCoveredRationale: 'The existing work item flow tracks committed work, not speculative suggestions.',
    };
}

async function createVisibleCard(store: FileDreamStore, workspaceId = WORKSPACE_ID): Promise<DreamCard> {
    const candidate = await store.createCandidate(candidateInput(workspaceId));
    return store.promoteCandidate(workspaceId, candidate.id, {
        criticRationale: 'Evidence is concrete and actionable.',
    });
}

describe('Dream routes', () => {
    let tmpDir: string;
    let store: FileDreamStore;
    let routes: Route[];
    let dreamsEnabled: boolean;
    let enqueueRun: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        candidateSequence = 0;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-dream-routes-'));
        store = new FileDreamStore({ dataDir: tmpDir });
        routes = [];
        dreamsEnabled = true;
        enqueueRun = vi.fn();
        registerDreamRoutes({
            routes,
            store,
            enqueueRun,
            getDreamsEnabled: () => dreamsEnabled,
        });
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('returns not found while the global Dreams feature gate is disabled', async () => {
        dreamsEnabled = false;

        const res = await dispatch(routes, 'GET', `/api/workspaces/${WORKSPACE_ID}/dreams/cards`);

        expect(res.statusCode).toBe(404);
        expect(enqueueRun).not.toHaveBeenCalled();
    });

    it('lists only visible cards by default and preserves workspace isolation', async () => {
        const visible = await createVisibleCard(store);
        const dismissed = await store.dismissCard(WORKSPACE_ID, visible.id);
        await createVisibleCard(store, OTHER_WORKSPACE_ID);
        const nextVisible = await createVisibleCard(store);

        const res = await dispatch(routes, 'GET', `/api/workspaces/${WORKSPACE_ID}/dreams/cards`);

        expect(res.statusCode).toBe(200);
        expect(res.body.cards.map((card: DreamCard) => card.id)).toEqual([nextVisible.id]);
        expect(res.body.cards.some((card: DreamCard) => card.id === dismissed.id)).toBe(false);
        expect(res.body.cards.every((card: DreamCard) => card.workspaceId === WORKSPACE_ID)).toBe(true);
    });

    it('supports hidden status filters for history review', async () => {
        const visible = await createVisibleCard(store);
        const approved = await store.approveCard(WORKSPACE_ID, visible.id);
        await createVisibleCard(store);

        const res = await dispatch(routes, 'GET', `/api/workspaces/${WORKSPACE_ID}/dreams/cards?includeHidden=true&status=approved`);

        expect(res.statusCode).toBe(200);
        expect(res.body.cards).toHaveLength(1);
        expect(res.body.cards[0].id).toBe(approved.id);
        expect(res.body.cards[0].status).toBe('approved');
    });

    it('reads card detail by ID', async () => {
        const card = await createVisibleCard(store);

        const res = await dispatch(routes, 'GET', `/api/workspaces/${WORKSPACE_ID}/dreams/cards/${card.id}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.card).toMatchObject({
            id: card.id,
            workspaceId: WORKSPACE_ID,
            dedupFingerprint: card.dedupFingerprint,
        });
    });

    it('runs a manual dream pass with validated run options', async () => {
        enqueueRun.mockResolvedValueOnce({
            id: 'dream-task-1',
            type: 'dream-run',
            status: 'queued',
            displayName: 'Dream Run: Manual',
            payload: { kind: 'dream-run', workspaceId: WORKSPACE_ID, trigger: 'manual' },
        });

        const res = await dispatch(routes, 'POST', `/api/workspaces/${WORKSPACE_ID}/dreams/run`, {
            provider: 'claude',
            config: { model: 'claude-sonnet-4.6', reasoningEffort: 'high' },
            confidenceThreshold: 0.9,
            maxCandidates: 3,
            conversationLimit: 5,
            timeoutMs: 30_000,
        });

        expect(res.statusCode).toBe(202);
        expect(enqueueRun).toHaveBeenCalledWith(WORKSPACE_ID, {
            provider: 'claude',
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            confidenceThreshold: 0.9,
            maxCandidates: 3,
            conversationLimit: 5,
            timeoutMs: 30_000,
        });
        expect(res.body.task).toMatchObject({
            id: 'dream-task-1',
            type: 'dream-run',
            status: 'queued',
            displayName: 'Dream Run: Manual',
        });
    });

    it('approves, dismisses, converts, and supersedes cards through explicit lifecycle routes', async () => {
        const approveTarget = await createVisibleCard(store);
        const approveRes = await dispatch(routes, 'POST', `/api/workspaces/${WORKSPACE_ID}/dreams/cards/${approveTarget.id}/approve`);
        expect(approveRes.statusCode).toBe(200);
        expect(approveRes.body.card.status).toBe('approved');

        const dismissTarget = await createVisibleCard(store);
        const dismissRes = await dispatch(routes, 'POST', `/api/workspaces/${WORKSPACE_ID}/dreams/cards/${dismissTarget.id}/dismiss`, {
            dedupRationale: 'Already captured elsewhere.',
        });
        expect(dismissRes.statusCode).toBe(200);
        expect(dismissRes.body.card).toMatchObject({
            status: 'dismissed',
            dedupRationale: 'Already captured elsewhere.',
        });

        const convertTarget = await createVisibleCard(store);
        const convertRes = await dispatch(routes, 'POST', `/api/workspaces/${WORKSPACE_ID}/dreams/cards/${convertTarget.id}/convert`, {
            artifactType: 'work-item',
            artifactId: 'WI-42',
            artifactUrl: '/work-items/WI-42',
        });
        expect(convertRes.statusCode).toBe(200);
        expect(convertRes.body.card).toMatchObject({
            status: 'converted',
            conversion: {
                artifactType: 'work-item',
                artifactId: 'WI-42',
                artifactUrl: '/work-items/WI-42',
            },
        });

        const supersedeTarget = await createVisibleCard(store);
        const supersedeRes = await dispatch(routes, 'POST', `/api/workspaces/${WORKSPACE_ID}/dreams/cards/${supersedeTarget.id}/supersede`, {
            supersededByCardId: convertTarget.id,
            dedupRationale: 'Covered by the converted card.',
        });
        expect(supersedeRes.statusCode).toBe(200);
        expect(supersedeRes.body.card).toMatchObject({
            status: 'superseded',
            supersededByCardId: convertTarget.id,
            dedupRationale: 'Covered by the converted card.',
        });
    });

    it('rejects invalid lifecycle requests without mutating the card', async () => {
        const card = await createVisibleCard(store);

        const res = await dispatch(routes, 'POST', `/api/workspaces/${WORKSPACE_ID}/dreams/cards/${card.id}/convert`, {
            artifactType: 'invalid',
            artifactId: 'WI-1',
        });

        expect(res.statusCode).toBe(400);
        await expect(store.getCard(WORKSPACE_ID, card.id)).resolves.toMatchObject({ status: 'visible' });
    });
});
