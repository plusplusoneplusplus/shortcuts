import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DELEGATED_JOBS_FILE, MAX_RESULT_SUMMARY, DelegatedJobStore,
    type DelegatedJobRegistration, type DelegatedJobResult,
} from '../../../src/server/delegation/delegated-job-store';
import { getRepoDataPath } from '../../../src/server/paths';
import { createDelegatedJobsDomain } from '../../../src/server/storage/snapshot/delegated-jobs-domain';
import type { StorageSnapshotContext } from '../../../src/server/storage/snapshot/types';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const registration: DelegatedJobRegistration = {
    id: 'delegation-1',
    parent: { workspaceId: 'parent-repo', processId: 'sentinel-1' },
    child: { workspaceId: 'child-repo', processId: 'job-1' },
    title: 'Fix login',
};
const result: DelegatedJobResult = {
    terminalEventId: 'terminal-1', outcome: 'completed', summary: 'Fixed login',
    links: ['#/process/job-1'],
};

describe('DelegatedJobStore', () => {
    let dataDir: string;
    let store: DelegatedJobStore;
    const restart = () => new DelegatedJobStore(dataDir);
    const rows = () => restart().list('parent-repo');

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegated-jobs-'));
        store = restart();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('persists cross-workspace parent/child identity in the parent workspace only', () => {
        store.register(registration);
        expect(rows()[0]).toMatchObject(registration);
        expect(fs.existsSync(getRepoDataPath(dataDir, 'parent-repo', DELEGATED_JOBS_FILE))).toBe(true);
        expect(store.list('child-repo')).toEqual([]);
        const snapshot = store.list('parent-repo');
        snapshot[0].parent.processId = 'other-chat';
        expect(rows()[0].parent.processId).toBe('sentinel-1');
    });

    it('makes registration idempotent without permitting parent/child reassignment', () => {
        const first = store.register(registration);
        expect(store.register({ ...registration, title: 'Renamed' })).toEqual(first);
        expect(() => store.register({ ...registration, parent: { ...registration.parent, processId: 'other' } })).toThrow('another parent or child');
        expect(() => store.register({ ...registration, child: { ...registration.child, workspaceId: 'other' } })).toThrow('another parent or child');
        expect(rows()).toHaveLength(1);
    });

    it.each(['completed', 'failed', 'cancelled', 'capped'] as const)('recovers pending %s results and deduplicates replay', outcome => {
        store.register(registration);
        expect(store.recordResult('parent-repo', registration.id, { ...result, outcome })).toBe(true);
        expect(restart().recordResult('parent-repo', registration.id, result)).toBe(false);
        expect(restart().recordResult('parent-repo', registration.id, { ...result, terminalEventId: 'replayed-as-another-event' })).toBe(false);
        expect(rows()[0].terminal).toEqual({ result: { ...result, outcome }, delivery: { state: 'pending' } });
    });

    it('ignores unrelated jobs and wrong workspace events', () => {
        store.register(registration);
        expect(store.recordResult('parent-repo', 'unrelated', result)).toBe(false);
        expect(store.recordResult('child-repo', registration.id, result)).toBe(false);
        expect(rows()[0].terminal).toBeUndefined();
    });

    it('bounds result data and retains remote and Ralph identities', () => {
        store.register({ ...registration, child: { ...registration.child, serverId: 'remote-server', sessionId: 'ralph-1' } });
        store.recordResult('parent-repo', registration.id, {
            ...result, summary: 'x'.repeat(MAX_RESULT_SUMMARY + 100), reason: 'r'.repeat(2_100),
            links: Array.from({ length: 25 }, (_, n) => `artifact-${n}`),
        });
        expect(rows()[0].child).toMatchObject({ serverId: 'remote-server', sessionId: 'ralph-1' });
        expect(rows()[0].terminal?.result.summary).toHaveLength(MAX_RESULT_SUMMARY);
        expect(rows()[0].terminal?.result.reason).toHaveLength(2_000);
        expect(rows()[0].terminal?.result.links).toHaveLength(20);
    });

    it('persists queue admission and delivery without reopening settled outcomes', () => {
        store.register(registration);
        store.recordResult('parent-repo', registration.id, result);
        expect(store.updateDelivery('parent-repo', registration.id, 'pending', { state: 'queued', receiptId: 'review-1' })).toBe(true);
        expect(rows()[0].terminal?.delivery).toEqual({ state: 'queued', receiptId: 'review-1' });
        expect(restart().updateDelivery('parent-repo', registration.id, 'pending', { state: 'failed', reason: 'stale attempt' })).toBe(false);
        expect(() => restart().updateDelivery('parent-repo', registration.id, 'queued', { state: 'delivered', receiptId: 'other' })).toThrow('receipt');
        expect(restart().updateDelivery('parent-repo', registration.id, 'queued', { state: 'delivered', receiptId: 'review-1' })).toBe(true);
        expect(() => store.updateDelivery('parent-repo', registration.id, 'delivered', { state: 'pending' })).toThrow('Invalid');
        expect(store.recordResult('parent-repo', registration.id, result)).toBe(false);
        expect(rows()[0].terminal?.delivery.state).toBe('delivered');
    });

    it('keeps a diagnosable failure for unavailable parents without reopening delivery', () => {
        store.register(registration);
        store.recordResult('parent-repo', registration.id, result);
        store.updateDelivery('parent-repo', registration.id, 'pending', { state: 'failed', reason: 'parent-deleted' });
        expect(rows()[0].terminal?.delivery).toEqual({ state: 'failed', reason: 'parent-deleted' });
        expect(() => restart().updateDelivery('parent-repo', registration.id, 'failed', { state: 'pending' })).toThrow('Invalid');
    });

    it('does not advance state on failed atomic writes and allows a clean retry', () => {
        store.register(registration);
        const rename = vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('disk failure'); });
        expect(() => store.recordResult('parent-repo', registration.id, result)).toThrow('disk failure');
        rename.mockClear();
        expect(rows()[0].terminal).toBeUndefined();
        expect(fs.readdirSync(path.dirname(getRepoDataPath(dataDir, 'parent-repo', DELEGATED_JOBS_FILE)))).toEqual([DELEGATED_JOBS_FILE]);
        expect(store.recordResult('parent-repo', registration.id, result)).toBe(true);
    });

    it('rejects corrupt, duplicate, or mis-scoped stored rows without overwriting them', () => {
        const job = store.register(registration);
        const file = getRepoDataPath(dataDir, 'parent-repo', DELEGATED_JOBS_FILE);
        for (const raw of ['invalid JSON', JSON.stringify([job, job]), JSON.stringify([{ ...job, parent: { ...job.parent, workspaceId: 'wrong' } }])]) {
            fs.writeFileSync(file, raw);
            expect(() => restart().register(registration)).toThrow();
            expect(fs.readFileSync(file, 'utf8')).toBe(raw);
        }
    });

    it('registers operational receipts for wipe without exporting or importing them', async () => {
        store.register(registration);
        const domain = createDelegatedJobsDomain();
        const context = { dataDir } as StorageSnapshotContext;
        expect(await domain.collect(context)).toEqual({ data: {}, metadata: {}, warnings: [] });
        const wipe = await domain.planWipe({ ...context, includeWikis: false });
        expect(wipe.plan).toEqual([getRepoDataPath(dataDir, 'parent-repo', DELEGATED_JOBS_FILE)]);
        expect(rows()).toHaveLength(1);
        const errors = { errors: [] as string[] };
        await domain.executeWipe({ ...context, includeWikis: false }, wipe.plan, errors);
        expect(errors.errors).toEqual([]);
        expect(rows()).toEqual([]);
    });
});
