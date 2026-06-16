/**
 * Tests for Team PR auto-classification enqueue behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addPullRequestCoworkerToRoster } from '../../src/server/repos/pr-coworker-roster-store';
import { readPending, writeClassification, writePending } from '../../src/server/repos/classification-store';
import {
    autoClassifyTeamPullRequests,
    TEAM_PR_AUTO_CLASSIFICATION_ENQUEUE_LIMIT,
    type TeamAutoClassifiablePullRequest,
} from '../../src/server/repos/pr-team-auto-classification';
import type { DiffClassificationResult } from '../../src/server/spa/client/react/features/pull-requests/classification-types';

const WORKSPACE_ID = 'ws-1';
const REPO_ID = 'repo-1';
const ORIGIN_ID = 'gh_org_repo';
const validResult: DiffClassificationResult = {
    classifications: [
        {
            file: 'src/a.ts',
            hunkIndex: 0,
            category: 'logic',
            intensity: 'high',
            reason: 'new behavior',
            summaryComment: 'Adds a behavior path that reviewers should inspect.',
        },
    ],
};

let tmpDir: string;
let dataDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-team-auto-classification-test-'));
    dataDir = path.join(tmpDir, 'data');
    addPullRequestCoworkerToRoster(dataDir, WORKSPACE_ID, REPO_ID, {
        id: 'coworker-1',
        displayName: 'Coworker One',
    });
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function pr(overrides: Partial<TeamAutoClassifiablePullRequest> = {}): TeamAutoClassifiablePullRequest {
    return {
        number: 1,
        status: 'open',
        headSha: 'head-1',
        author: { id: 'coworker-1', displayName: 'Coworker One' },
        ...overrides,
    };
}

function makeBridge() {
    let nextId = 1;
    const tasks = new Map<string, any>();
    const queue = {
        enqueue: vi.fn((task: any) => {
            const id = `task-${nextId++}`;
            tasks.set(id, { ...task, id, status: 'queued' });
            return id;
        }),
    };
    const bridge = {
        getOrCreateBridge: vi.fn(),
        getRepoIdForPath: vi.fn(() => 'resolved-repo'),
        getTask: vi.fn((id: string) => tasks.get(id)),
        registry: {
            getQueueForRepo: vi.fn(() => queue),
        },
    } as any;
    return { bridge, queue, tasks };
}

function makeService() {
    return {
        resolveRepo: vi.fn().mockResolvedValue({ localPath: path.join(tmpDir, 'repo') }),
    } as any;
}

describe('autoClassifyTeamPullRequests', () => {
    it('enqueues at most 10 missing Team PR classifications and skips ready/running/missing-head entries', async () => {
        const { bridge, queue, tasks } = makeBridge();
        const service = makeService();
        writeClassification(dataDir, WORKSPACE_ID, REPO_ID, '1', 'ready-head', validResult);
        writePending(dataDir, WORKSPACE_ID, REPO_ID, '2', 'running-head', 'running-task');
        tasks.set('running-task', { id: 'running-task', status: 'running' });

        const missingPrs = Array.from({ length: TEAM_PR_AUTO_CLASSIFICATION_ENQUEUE_LIMIT + 2 }, (_, index) =>
            pr({ number: 10 + index, headSha: `missing-head-${index}` }));
        const result = await autoClassifyTeamPullRequests({
            dataDir,
            store: {} as any,
            bridge,
            repoTreeService: service,
            workspaceId: WORKSPACE_ID,
            repoId: REPO_ID,
            pullRequests: [
                pr({ number: 1, headSha: 'ready-head' }),
                pr({ number: 2, headSha: 'running-head' }),
                pr({ number: 3, headSha: '' }),
                pr({ number: undefined, headSha: 'no-number-head' }),
                ...missingPrs,
            ],
        });

        expect(result).toMatchObject({
            eligible: 16,
            considered: 12,
            skippedMissingHeadSha: 1,
            skippedMissingNumber: 1,
            ready: 1,
            running: 1,
            started: TEAM_PR_AUTO_CLASSIFICATION_ENQUEUE_LIMIT,
        });
        expect(queue.enqueue).toHaveBeenCalledTimes(TEAM_PR_AUTO_CLASSIFICATION_ENQUEUE_LIMIT);
        expect(queue.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({
            priority: 'low',
            type: 'pr-classification',
            repoId: 'resolved-repo',
            payload: expect.objectContaining({
                workspaceId: WORKSPACE_ID,
                repoId: REPO_ID,
                classificationStorageOriginId: `local_${WORKSPACE_ID}`,
                classificationType: 'pr',
                classificationIdentifier: '10:missing-head-0',
                prId: '10',
                headSha: 'missing-head-0',
                skills: ['classify-diff'],
            }),
        }));
    });

    it('does not enqueue duplicates on repeated triggers after the pending marker is written', async () => {
        const { bridge, queue } = makeBridge();
        const service = makeService();
        const options = {
            dataDir,
            store: {} as any,
            bridge,
            repoTreeService: service,
            workspaceId: WORKSPACE_ID,
            repoId: REPO_ID,
            pullRequests: [pr({ number: 42, headSha: 'same-head' })],
        };

        const first = await autoClassifyTeamPullRequests(options);
        const second = await autoClassifyTeamPullRequests(options);

        expect(first.started).toBe(1);
        expect(second).toMatchObject({ running: 1, started: 0 });
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('clears stale pending markers and re-enqueues missing classifications', async () => {
        const { bridge, queue } = makeBridge();
        const service = makeService();
        writePending(dataDir, WORKSPACE_ID, REPO_ID, '42', 'stale-head', 'stale-task');

        const result = await autoClassifyTeamPullRequests({
            dataDir,
            store: {} as any,
            bridge,
            repoTreeService: service,
            workspaceId: WORKSPACE_ID,
            repoId: REPO_ID,
            pullRequests: [pr({ number: 42, headSha: 'stale-head' })],
        });

        expect(result).toMatchObject({ started: 1, running: 0 });
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        expect(readPending(dataDir, WORKSPACE_ID, REPO_ID, '42', 'stale-head', `local_${WORKSPACE_ID}`)?.processId).toBe('task-1');
    });

    it('uses workspace and repo scoped classification state', async () => {
        const { bridge, queue } = makeBridge();
        const service = makeService();
        writeClassification(dataDir, 'other-ws', REPO_ID, '42', 'same-head', validResult);
        writeClassification(dataDir, WORKSPACE_ID, 'other-repo', '43', 'same-head', validResult);

        const result = await autoClassifyTeamPullRequests({
            dataDir,
            store: {} as any,
            bridge,
            repoTreeService: service,
            workspaceId: WORKSPACE_ID,
            repoId: REPO_ID,
            pullRequests: [
                pr({ number: 42, headSha: 'same-head' }),
                pr({ number: 43, headSha: 'same-head' }),
            ],
        });

        expect(result.started).toBe(2);
        expect(result.ready).toBe(0);
        expect(queue.enqueue).toHaveBeenCalledTimes(2);
    });

    it('shares ready classification state across workspaces with the same origin scope', async () => {
        const cloneWorkspaceId = 'ws-clone';
        const { bridge, queue } = makeBridge();
        const service = makeService();
        writeClassification(dataDir, WORKSPACE_ID, REPO_ID, '42', 'same-head', validResult, {
            processId: 'legacy-ready',
        });

        const result = await autoClassifyTeamPullRequests({
            dataDir,
            store: {} as any,
            bridge,
            repoTreeService: service,
            workspaceId: cloneWorkspaceId,
            repoId: REPO_ID,
            storageScope: {
                storageOriginId: ORIGIN_ID,
                legacyScopes: [
                    { workspaceId: WORKSPACE_ID, repoId: REPO_ID },
                    { workspaceId: cloneWorkspaceId, repoId: REPO_ID },
                ],
            },
            pullRequests: [
                pr({ number: 42, headSha: 'same-head' }),
                pr({ number: 43, headSha: 'missing-head' }),
            ],
        });

        expect(result.ready).toBe(1);
        expect(result.started).toBe(1);
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({
                workspaceId: cloneWorkspaceId,
                repoId: REPO_ID,
                classificationStorageOriginId: ORIGIN_ID,
                classificationIdentifier: '43:missing-head',
            }),
        }));
    });
});
