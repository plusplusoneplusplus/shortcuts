/**
 * GitPatchTransferService Tests
 *
 * Covers the export/apply policy without going through HTTP: hash validation,
 * source remote resolution and backfill, target preflight (in-progress
 * operation, non-repo, detached HEAD), the success job record, and the
 * dirty/conflict result taxonomy.
 *
 * Cross-platform compatible — no git, no filesystem.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GitOpJob, GitOpType, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { GitOperationRunner } from '../../src/server/git/git-operation-runner';
import { GitPatchTransferService } from '../../src/server/git/git-patch-transfer-service';

const detectRemoteUrl = vi.hoisted(() => vi.fn());

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, detectRemoteUrl };
});

const SOURCE_WS = {
    id: 'ws-source',
    name: 'Source Repo',
    rootPath: '/repos/source',
} as WorkspaceInfo;

const TARGET_WS = {
    id: 'ws-target',
    name: 'Target Repo',
    rootPath: '/repos/target',
} as WorkspaceInfo;

const CLEAN_STATE = { operation: 'none' as const };
const MAIN_BRANCH = { name: 'main', isDetached: false };
const PATCH_BODY = { patch: { format: 'format-patch', body: 'From abc123 Mon Sep 17\n' } };

function createHarness() {
    const jobs: GitOpJob[] = [];
    const store = {
        jobs,
        create: vi.fn(async (job: GitOpJob) => { jobs.push({ ...job }); return job; }),
        update: vi.fn(async () => undefined),
        getRunning: vi.fn(async (_ws: string, _op?: GitOpType) => []),
        getById: vi.fn(), getLatest: vi.fn(), markStaleRunningJobs: vi.fn(),
    };
    const branchService = {
        exportCommitPatch: vi.fn(),
        exportCommitPatches: vi.fn(),
        applyCommitPatch: vi.fn(),
        getRepoState: vi.fn(() => CLEAN_STATE),
        hasUncommittedChanges: vi.fn(async () => false),
        getBranchStatus: vi.fn(async () => MAIN_BRANCH),
    };
    const processStore = { updateWorkspace: vi.fn(async () => undefined) };
    const broadcastGitChanged = vi.fn();
    const invalidateMutable = vi.fn();
    const runner = new GitOperationRunner({
        gitOpsStore: store as never,
        getWsServer: () => ({ broadcastGitChanged }),
        cache: { invalidateMutable },
    });
    const service = new GitPatchTransferService({
        branchService: branchService as never,
        store: processStore as never,
        runner,
    });
    return { service, store, branchService, processStore, broadcastGitChanged, invalidateMutable };
}

describe('GitPatchTransferService.exportPatch', () => {
    let h: ReturnType<typeof createHarness>;

    beforeEach(() => {
        detectRemoteUrl.mockReset();
        detectRemoteUrl.mockResolvedValue(undefined);
        h = createHarness();
    });

    it('exports a single commit with provenance and the format-patch body', async () => {
        h.branchService.exportCommitPatch.mockResolvedValue({
            success: true,
            patch: 'PATCH-BODY',
            commitHash: 'abc1234',
            subject: 'feat: thing',
            authorName: 'Alice',
            authorEmail: 'alice@example.com',
            authorDate: '2026-01-01T00:00:00Z',
        });

        const payload = await h.service.exportPatch(SOURCE_WS, { hash: '  abc1234  ' });

        expect(h.branchService.exportCommitPatch).toHaveBeenCalledWith('/repos/source', 'abc1234');
        expect(payload).toEqual({
            sourceWorkspace: { id: 'ws-source', name: 'Source Repo' },
            sourceCommit: {
                hash: 'abc1234',
                subject: 'feat: thing',
                author: { name: 'Alice', email: 'alice@example.com', date: '2026-01-01T00:00:00Z' },
            },
            normalizedSourceRemoteUrl: null,
            patch: { format: 'format-patch', body: 'PATCH-BODY' },
        });
    });

    it('exports a hash range as one mailbox, with the oldest commit as sourceCommit', async () => {
        h.branchService.exportCommitPatches.mockResolvedValue({
            success: true,
            patch: 'MAILBOX',
            commits: [
                { commitHash: 'aaaa', subject: 'first', authorName: 'A', authorEmail: 'a@x', authorDate: 'd1' },
                { commitHash: 'bbbb', subject: 'second', authorName: 'B', authorEmail: 'b@x', authorDate: 'd2' },
            ],
        });

        const payload: any = await h.service.exportPatch(SOURCE_WS, { hashes: ['aaaa', 'bbbb'] });

        expect(h.branchService.exportCommitPatches).toHaveBeenCalledWith('/repos/source', ['aaaa', 'bbbb']);
        expect(payload.sourceCommits).toHaveLength(2);
        expect(payload.sourceCommit).toEqual(payload.sourceCommits[0]);
        expect(payload.patch).toEqual({ format: 'format-patch', body: 'MAILBOX' });
    });

    it('normalizes the workspace remote URL when one is already known', async () => {
        h.branchService.exportCommitPatch.mockResolvedValue({
            success: true, patch: 'p', commitHash: 'abcd', subject: 's',
            authorName: 'A', authorEmail: 'a@x', authorDate: 'd',
        });

        const payload: any = await h.service.exportPatch(
            { ...SOURCE_WS, remoteUrl: 'git@github.com:org/repo.git' } as WorkspaceInfo,
            { hash: 'abcd' },
        );

        expect(payload.normalizedSourceRemoteUrl).toBeTruthy();
        expect(payload.normalizedSourceRemoteUrl).not.toContain('git@');
        expect(detectRemoteUrl).not.toHaveBeenCalled();
    });

    it('detects and backfills the remote URL when the workspace has none', async () => {
        detectRemoteUrl.mockResolvedValue('https://github.com/org/repo.git');
        h.branchService.exportCommitPatch.mockResolvedValue({
            success: true, patch: 'p', commitHash: 'abcd', subject: 's',
            authorName: 'A', authorEmail: 'a@x', authorDate: 'd',
        });

        const payload: any = await h.service.exportPatch(SOURCE_WS, { hash: 'abcd' });

        expect(h.processStore.updateWorkspace).toHaveBeenCalledWith('ws-source', {
            remoteUrl: 'https://github.com/org/repo.git',
        });
        expect(payload.normalizedSourceRemoteUrl).toBeTruthy();
    });

    it('rejects a missing hash with MISSING_FIELDS and a malformed one with 400', async () => {
        await expect(h.service.exportPatch(SOURCE_WS, {})).rejects.toMatchObject({ code: 'MISSING_FIELDS' });
        await expect(h.service.exportPatch(SOURCE_WS, { hash: 'nope!' }))
            .rejects.toMatchObject({ statusCode: 400, message: 'Missing or invalid hash' });
        await expect(h.service.exportPatch(SOURCE_WS, { hashes: [] }))
            .rejects.toMatchObject({ code: 'MISSING_FIELDS' });
        await expect(h.service.exportPatch(SOURCE_WS, { hashes: ['aaaa', 'zz'] }))
            .rejects.toMatchObject({ statusCode: 400, message: 'Missing or invalid hash' });
        expect(h.branchService.exportCommitPatch).not.toHaveBeenCalled();
        expect(h.branchService.exportCommitPatches).not.toHaveBeenCalled();
    });

    it('404s when the commit cannot be exported', async () => {
        h.branchService.exportCommitPatch.mockResolvedValue({ success: false });
        await expect(h.service.exportPatch(SOURCE_WS, { hash: 'abcd' }))
            .rejects.toMatchObject({ statusCode: 404 });

        h.branchService.exportCommitPatches.mockResolvedValue({ success: false });
        await expect(h.service.exportPatch(SOURCE_WS, { hashes: ['abcd'] }))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('GitPatchTransferService.applyPatch', () => {
    let h: ReturnType<typeof createHarness>;

    beforeEach(() => {
        detectRemoteUrl.mockReset();
        detectRemoteUrl.mockResolvedValue(undefined);
        h = createHarness();
    });

    it('applies the patch, records a cherry-pick-transfer job, and invalidates the cache', async () => {
        h.branchService.applyCommitPatch.mockResolvedValue({ success: true, headHash: 'dddd', stashed: false });

        const { status, payload } = await h.service.applyPatch(TARGET_WS, {
            ...PATCH_BODY,
            sourceWorkspace: { id: 'ws-source', name: 'Source Repo' },
            sourceCommit: { hash: 'aaaa', subject: 'feat: thing' },
            normalizedSourceRemoteUrl: 'github.com/org/repo',
        });

        expect(status).toBe(200);
        expect(payload).toMatchObject({
            success: true,
            targetWorkspace: { id: 'ws-target', name: 'Target Repo' },
            targetBranch: 'main',
            targetHead: 'dddd',
            newCommitHash: 'dddd',
            stashed: false,
        });
        expect(payload.appliedCount).toBeUndefined();

        expect(h.store.jobs).toHaveLength(1);
        expect(h.store.jobs[0]).toMatchObject({ op: 'cherry-pick-transfer', status: 'success', workspaceId: 'ws-target' });
        expect(h.store.jobs[0].metadata).toMatchObject({
            kind: 'patch-transfer',
            sourceWorkspace: { id: 'ws-source', name: 'Source Repo' },
            sourceCommit: { hash: 'aaaa', subject: 'feat: thing' },
            targetWorkspace: { id: 'ws-target', name: 'Target Repo' },
            targetBranch: 'main',
        });
        expect(h.invalidateMutable).toHaveBeenCalledWith('ws-target');
        expect(h.broadcastGitChanged).toHaveBeenCalledWith('ws-target', 'patch-apply');
    });

    it('passes the stash option through and reports appliedCount for multi-commit patches', async () => {
        h.branchService.applyCommitPatch.mockResolvedValue({
            success: true, headHash: 'eeee', stashed: true, appliedCount: 3,
        });

        const { payload } = await h.service.applyPatch(TARGET_WS, { ...PATCH_BODY, stashAndContinue: true });

        expect(h.branchService.applyCommitPatch).toHaveBeenCalledWith(
            '/repos/target',
            PATCH_BODY.patch.body,
            { stashAndContinue: true, stashMessage: 'CoC patch-transfer cherry-pick' },
        );
        expect(payload).toMatchObject({ stashed: true, appliedCount: 3 });
    });

    it('rejects a payload that is not a non-empty format-patch', async () => {
        for (const body of [{}, { patch: { format: 'diff', body: 'x' } }, { patch: { format: 'format-patch', body: '   ' } }]) {
            await expect(h.service.applyPatch(TARGET_WS, body))
                .rejects.toMatchObject({ statusCode: 400, message: 'Missing or invalid format-patch payload' });
        }
        expect(h.branchService.applyCommitPatch).not.toHaveBeenCalled();
    });

    it('409s when the target already has a git operation in progress', async () => {
        h.branchService.getRepoState.mockReturnValue({
            operation: 'rebase', gitOperation: 'rebase-merge', conflictFiles: ['a.ts'],
        } as never);

        const { status, payload } = await h.service.applyPatch(TARGET_WS, PATCH_BODY);

        expect(status).toBe(409);
        expect(payload).toEqual({
            error: 'Target workspace already has a rebase-merge operation in progress',
            operation: 'rebase',
            gitOperation: 'rebase-merge',
            conflictFiles: ['a.ts'],
        });
        expect(h.branchService.applyCommitPatch).not.toHaveBeenCalled();
    });

    it('409s on detached HEAD, reporting the detached hash', async () => {
        h.branchService.getBranchStatus.mockResolvedValue({ name: '', isDetached: true, detachedHash: 'ffff' } as never);

        const { status, payload } = await h.service.applyPatch(TARGET_WS, PATCH_BODY);

        expect(status).toBe(409);
        expect(payload).toEqual({
            error: 'Target workspace is in detached HEAD state',
            targetBranch: null,
            detachedHash: 'ffff',
        });
    });

    it('400s when the target is not a usable git repository', async () => {
        h.branchService.getBranchStatus.mockResolvedValue(null as never);
        await expect(h.service.applyPatch(TARGET_WS, PATCH_BODY))
            .rejects.toMatchObject({ statusCode: 400, message: 'Target workspace is not a usable git repository' });
    });

    it('409s with dirty: true when the working tree blocks the apply', async () => {
        h.branchService.applyCommitPatch.mockResolvedValue({
            success: false, dirty: true, stashed: false, message: 'uncommitted changes',
        });

        const { status, payload } = await h.service.applyPatch(TARGET_WS, PATCH_BODY);

        expect(status).toBe(409);
        expect(payload).toEqual({ error: 'uncommitted changes', dirty: true, stashed: false });
        expect(h.store.jobs).toHaveLength(0);
        expect(h.broadcastGitChanged).not.toHaveBeenCalled();
    });

    it('409s with conflict detail, including git state and applied count', async () => {
        h.branchService.applyCommitPatch.mockResolvedValue({
            success: false,
            conflicts: true,
            stashed: true,
            appliedCount: 1,
            gitState: { operation: 'cherry-pick' },
            message: 'conflict in a.ts',
        });

        const { status, payload } = await h.service.applyPatch(TARGET_WS, PATCH_BODY);

        expect(status).toBe(409);
        expect(payload).toEqual({
            error: 'conflict in a.ts',
            conflicts: true,
            stashed: true,
            appliedCount: 1,
            gitState: { operation: 'cherry-pick' },
        });
    });

    it('400s for a failure that is neither dirty nor conflicted', async () => {
        h.branchService.applyCommitPatch.mockResolvedValue({ success: false, message: 'corrupt patch' });
        await expect(h.service.applyPatch(TARGET_WS, PATCH_BODY))
            .rejects.toMatchObject({ statusCode: 400, message: 'Patch apply failed: corrupt patch' });
    });
});
