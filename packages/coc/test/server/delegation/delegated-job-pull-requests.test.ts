import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DELEGATED_JOBS_FILE, DelegatedJobStore, type DelegatedJobRegistration,
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
    parent: { workspaceId: 'owner-repo', processId: 'sentinel-1' },
    child: { workspaceId: 'child-repo', processId: 'job-1' },
    title: 'Implement feature',
};
const prUrl = 'https://github.com/example/project/pull/42';

describe('Delegated job pull request receipts', () => {
    let dataDir: string;
    let store: DelegatedJobStore;
    const restart = () => new DelegatedJobStore(dataDir);
    const job = () => restart().list(registration.parent.workspaceId)[0];
    const file = () => getRepoDataPath(dataDir, registration.parent.workspaceId, DELEGATED_JOBS_FILE);
    const record = (url = prUrl, itemId = 'todo-1') =>
        store.recordPullRequest(registration.parent.workspaceId, registration.id, itemId, url);

    beforeEach(() => {
        dataDir = path.join(process.cwd(), 'test', '.delegated-pr-receipts', randomUUID());
        fs.mkdirSync(dataDir, { recursive: true });
        store = restart();
        store.register(registration);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(dataDir, { recursive: true, force: true });
        try { fs.rmdirSync(path.dirname(dataDir)); } catch { /* Another test may still own a receipt fixture. */ }
    });

    it('persists exact parent, child, job, item and canonical PR identity in the owner workspace', () => {
        const receipt = record(`${prUrl}/files?view=changed#diff`);
        expect(receipt).toMatchObject({
            itemId: 'todo-1',
            pr: { provider: 'github', host: 'github.com', repoPath: 'example/project', number: 42, url: prUrl },
        });
        expect(receipt.id).toBeTruthy();
        expect(Number.isNaN(Date.parse(receipt.recordedAt))).toBe(false);
        expect(job()).toMatchObject({ ...registration, pullRequests: [receipt] });
        expect(store.list('child-repo')).toEqual([]);
        expect(fs.existsSync(file())).toBe(true);
        receipt.pr.number = 99;
        const snapshot = job();
        snapshot.pullRequests![0].itemId = 'other-item';
        expect(job().pullRequests![0]).toMatchObject({ itemId: 'todo-1', pr: { number: 42 } });
    });

    it('replays the same exact PR receipt across restart and URL case variations', () => {
        const first = record();
        store = restart();
        expect(record('https://www.github.com/EXAMPLE/PROJECT/pull/042?tab=checks')).toEqual(first);
        expect(job().pullRequests).toEqual([first]);
        expect(store.register({ ...registration, title: 'Renamed' }).pullRequests).toEqual([first]);
        expect(() => record(prUrl, 'other-item')).toThrow('another to-do item');
        expect(job().pullRequests).toEqual([first]);
    });

    it('tracks every PR separately rather than selecting a newest completion PR', () => {
        const urls = [
            prUrl, 'https://github.com/example/project/pull/43',
            'https://github.com/example/other-project/pull/42',
            'https://dev.azure.com/example/project/_git/repository/pullrequest/42',
        ];
        const receipts = urls.map(url => record(url));
        expect(job().pullRequests).toEqual(receipts);
        expect(new Set(receipts.map(receipt => receipt.id)).size).toBe(urls.length);
        expect(receipts.map(receipt => receipt.pr.url)).toEqual(urls);
    });

    it('persists native watch intent idempotently without backfilling earlier PRs', () => {
        const earlier = record();
        const requested = record(prUrl.replace('/42', '/43'));
        store.requestPullRequestOutcomeWatch('owner-repo', registration.id, requested.id);
        const once = job().pullRequests!;
        expect(once.find(receipt => receipt.id === earlier.id)?.outcomeWatchRequestedAt).toBeUndefined();
        expect(once.find(receipt => receipt.id === requested.id)?.outcomeWatchRequestedAt).toBeTruthy();
        restart().requestPullRequestOutcomeWatch('owner-repo', registration.id, requested.id);
        expect(job().pullRequests).toEqual(once);
        expect(() => store.requestPullRequestOutcomeWatch('owner-repo', registration.id, 'missing')).toThrow('receipt not found');
    });

    it('atomically commits an exact submission and its requested watch intent together', () => {
        vi.mocked(fs.renameSync).mockClear();
        const receipt = store.recordPullRequest('owner-repo', registration.id, 'todo-1', prUrl, true);
        expect(fs.renameSync).toHaveBeenCalledTimes(1);
        expect(receipt.outcomeWatchRequestedAt).toBeTruthy();
        expect(job().pullRequests).toEqual([receipt]);
        expect(restart().recordPullRequest('owner-repo', registration.id, 'todo-1', prUrl, true)).toEqual(receipt);
    });

    it('adds explicit submission intent only to the selected exact existing receipt', () => {
        const earlier = record(prUrl.replace('/42', '/41'));
        const selected = record();
        const requested = store.recordPullRequest('owner-repo', registration.id, 'todo-1', prUrl, true);
        expect(requested.id).toBe(selected.id);
        expect(job().pullRequests).toEqual([earlier, requested]);
        expect(requested.outcomeWatchRequestedAt).toBeTruthy();
    });

    it('durably bounds registration failures and clears them without changing receipt identity or intent', () => {
        const receipt = store.recordPullRequest('owner-repo', registration.id, 'todo-1', prUrl, true);
        store.recordPullRequestOutcomeWatchError('owner-repo', registration.id, receipt.id, { message: 'x'.repeat(600), permanent: true });
        expect(job().pullRequests![0].outcomeWatchError).toEqual({ message: 'x'.repeat(500), permanent: true });
        restart().recordPullRequestOutcomeWatchError('owner-repo', registration.id, receipt.id);
        expect(job().pullRequests).toEqual([receipt]);
        expect(() => store.recordPullRequestOutcomeWatchError('owner-repo', registration.id, 'missing')).toThrow('receipt not found');
    });

    it('keeps PR receipts independent of execution and grilling result receipts', () => {
        const result = { terminalEventId: 'terminal-1', outcome: 'completed' as const, summary: 'Submitted', links: [] };
        store.recordResult('owner-repo', registration.id, result);
        store.recordResult('owner-repo', registration.id, { ...result, terminalEventId: 'grill-1' }, undefined, 'grill');
        store.updateDelivery('owner-repo', registration.id, 'pending', { state: 'failed', reason: 'Parent unavailable' });
        const before = job();
        const receipt = record();
        expect(job()).toEqual({ ...before, pullRequests: [receipt] });
    });

    it('does not infer or backfill PRs from a delegated result summary or links', () => {
        store.recordResult('owner-repo', registration.id, {
            terminalEventId: 'terminal-1', outcome: 'completed', summary: `Submitted ${prUrl}`, links: [prUrl],
        });
        expect(job().pullRequests).toBeUndefined();
    });

    it('rejects unregistered jobs and wrong workspace identities without creating data', () => {
        const before = fs.readFileSync(file(), 'utf8');
        expect(() => store.recordPullRequest('owner-repo', 'missing', 'todo-1', prUrl)).toThrow('not registered');
        expect(() => store.recordPullRequest('child-repo', registration.id, 'todo-1', prUrl)).toThrow('not registered');
        expect(fs.readFileSync(file(), 'utf8')).toBe(before);
        expect(store.list('child-repo')).toEqual([]);
    });

    it.each([
        'https://example.invalid/example/project/pull/42',
        'http://github.com/example/project/pull/42',
        'https://github.com/example/project/issues/42',
        'https://github.com/example/project/pull/9007199254740992',
        `PR: ${prUrl}`,
    ])('rejects unsupported or invalid submission URL %s', url => {
        expect(() => record(url)).toThrow('supported');
        expect(job().pullRequests).toBeUndefined();
    });

    it.each(['', 'x'.repeat(201)])('rejects invalid item identity without a receipt', itemId => {
        expect(() => record(prUrl, itemId)).toThrow();
        expect(job().pullRequests).toBeUndefined();
    });

    it('does not advance PR registration on a failed atomic write and permits retry', () => {
        vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('disk failure'); });
        expect(() => record()).toThrow('disk failure');
        expect(job().pullRequests).toBeUndefined();
        expect(fs.readdirSync(path.dirname(file()))).toEqual([DELEGATED_JOBS_FILE]);
        expect(record()).toEqual(job().pullRequests![0]);
    });

    it('rejects duplicate receipt/PR identities and inconsistent provider identity on reads', () => {
        const receipt = record();
        const original = job();
        const invalid = [
            [receipt, receipt],
            [receipt, { ...receipt, id: 'different-receipt' }],
            [receipt, { ...receipt, pr: { ...receipt.pr, number: 43, url: prUrl.replace('/42', '/43') } }],
            [{ ...receipt, pr: { ...receipt.pr, provider: 'ado' } }],
            [{ ...receipt, pr: { ...receipt.pr, repoPath: 'other/project' } }],
        ];
        for (const pullRequests of invalid) {
            const raw = JSON.stringify([{ ...original, pullRequests }]);
            fs.writeFileSync(file(), raw);
            expect(() => restart().list('owner-repo')).toThrow();
            expect(() => record()).toThrow();
            expect(fs.readFileSync(file(), 'utf8')).toBe(raw);
        }
    });

    it('retains distinct receipts for different jobs or originating workspaces', () => {
        const first = record();
        store.register({ ...registration, id: 'delegation-2', child: { ...registration.child, processId: 'job-2' } });
        const second = store.recordPullRequest('owner-repo', 'delegation-2', 'todo-2', prUrl);
        store.register({ ...registration, parent: { ...registration.parent, workspaceId: 'other-owner' } });
        const third = store.recordPullRequest('other-owner', registration.id, 'todo-1', prUrl);
        expect(new Set([first.id, second.id, third.id]).size).toBe(3);
        expect(restart().list('owner-repo').map(row => row.pullRequests)).toEqual([[first], [second]]);
        expect(restart().list('other-owner')[0].pullRequests).toEqual([third]);
    });

    it('rejects a receipt reused by another job in the same owner workspace', () => {
        const receipt = record();
        const original = job();
        fs.writeFileSync(file(), JSON.stringify([
            original, { ...original, id: 'delegation-2', pullRequests: [receipt] },
        ]));
        expect(() => restart().list('owner-repo')).toThrow('Duplicate delegated pull request receipt');
    });

    it('keeps local and remote job identity without inventing a return transport', () => {
        store.register({ ...registration, id: 'remote-job', child: { ...registration.child, serverId: 'remote-server' } });
        const receipt = store.recordPullRequest('owner-repo', 'remote-job', 'todo-1', prUrl);
        expect(job().terminal).toBeUndefined();
        expect(restart().list('owner-repo')[1]).toMatchObject({
            child: { serverId: 'remote-server' }, pullRequests: [receipt],
        });
    });

    it('keeps submission receipts machine-local and covered by the existing wipe domain', async () => {
        record();
        const domain = createDelegatedJobsDomain();
        const context = { dataDir } as StorageSnapshotContext;
        expect(await domain.collect(context)).toEqual({ data: {}, metadata: {}, warnings: [] });
        const wipe = await domain.planWipe({ ...context });
        expect(wipe.plan).toEqual([file()]);
        const result = { errors: [] as string[] };
        await domain.executeWipe({ ...context }, wipe.plan, result);
        expect(result.errors).toEqual([]);
        expect(restart().list('owner-repo')).toEqual([]);
    });
});
