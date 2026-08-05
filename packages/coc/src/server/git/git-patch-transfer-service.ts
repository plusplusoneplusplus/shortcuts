/**
 * Git Patch Transfer Service
 *
 * Owns the domain policy behind `POST /git/patch/export` and `POST /git/patch/apply`:
 * hash validation, source remote-URL resolution, provenance metadata, target
 * repo-state preflight, and the success/dirty/conflict result taxonomy.
 *
 * Methods throw `APIError` for the plain error responses and return an explicit
 * `{ status, payload }` for the 409 bodies that carry operation detail, so the
 * route module stays a thin adapter.
 *
 * Pure Node.js. Cross-platform compatible.
 */

import { detectRemoteUrl, normalizeRemoteUrl } from '@plusplusoneplusplus/forge';
import type {
    BranchStatus,
    GitPatchApplyResult,
    GitPatchExportResult,
    GitPatchMultiExportResult,
    ProcessStore,
    RepoState,
    WorkspaceInfo,
} from '@plusplusoneplusplus/forge';
import { badRequest, notFound } from '../errors';
import type { GitOperationRunner } from './git-operation-runner';
import { buildPatchTransferMetadata, toGitOpCommitMetadata } from './git-patch-transfer-metadata';
import { conflictResponseFor, requireHash, requireHashList } from './git-request-validators';

/** The `BranchService` surface this service needs. Narrow so tests can pass a fake. */
export interface PatchTransferBranchService {
    exportCommitPatch(repoRoot: string, hash: string): Promise<GitPatchExportResult>;
    exportCommitPatches(repoRoot: string, hashes: string[]): Promise<GitPatchMultiExportResult>;
    applyCommitPatch(
        repoRoot: string,
        patchBody: string,
        options?: { stashAndContinue?: boolean; stashMessage?: string },
    ): Promise<GitPatchApplyResult>;
    getRepoState(repoRoot: string): RepoState;
    hasUncommittedChanges(repoRoot: string): Promise<boolean>;
    getBranchStatus(repoRoot: string, hasUncommittedChanges: boolean): Promise<BranchStatus | null>;
}

export interface GitPatchTransferServiceDeps {
    branchService: PatchTransferBranchService;
    store: ProcessStore;
    runner: GitOperationRunner;
}

/** A response the route should emit verbatim via `sendJSON`. */
export interface PatchTransferResponse {
    status: number;
    payload: Record<string, unknown>;
}

const STASH_MESSAGE = 'CoC patch-transfer cherry-pick';

export class GitPatchTransferService {
    constructor(private readonly deps: GitPatchTransferServiceDeps) {}

    /**
     * Export one commit, or a `hashes` range (oldest-first) as a single
     * concatenated format-patch mailbox.
     */
    async exportPatch(ws: WorkspaceInfo, body: any): Promise<Record<string, unknown>> {
        const sourceWorkspace = { id: ws.id, name: ws.name };

        if (Array.isArray(body?.hashes)) {
            const hashes = requireHashList(body.hashes, 'hashes');
            const result = await this.deps.branchService.exportCommitPatches(ws.rootPath, hashes);
            if (!result.success) throw notFound('Commit');

            const sourceCommits = result.commits.map(toGitOpCommitMetadata);
            return {
                sourceWorkspace,
                sourceCommit: sourceCommits[0],
                sourceCommits,
                normalizedSourceRemoteUrl: await this.resolveNormalizedRemoteUrl(ws),
                patch: { format: 'format-patch', body: result.patch },
            };
        }

        const hash = requireHash(body, 'hash');
        const result = await this.deps.branchService.exportCommitPatch(ws.rootPath, hash);
        if (!result.success) throw notFound('Commit');

        return {
            sourceWorkspace,
            sourceCommit: toGitOpCommitMetadata(result),
            normalizedSourceRemoteUrl: await this.resolveNormalizedRemoteUrl(ws),
            patch: { format: 'format-patch', body: result.patch },
        };
    }

    /**
     * Apply a format-patch payload to `ws`, recording a `cherry-pick-transfer`
     * job with the sanitized source provenance on success.
     */
    async applyPatch(ws: WorkspaceInfo, body: any): Promise<PatchTransferResponse> {
        const patchBody = typeof body?.patch?.body === 'string' ? body.patch.body : undefined;
        if (body?.patch?.format !== 'format-patch' || !patchBody || !patchBody.trim()) {
            throw badRequest('Missing or invalid format-patch payload');
        }

        const preflight = await this.preflight(ws);
        if ('status' in preflight) return preflight;
        const branchStatus = preflight.branchStatus;

        const startedAt = new Date().toISOString();
        const result = await this.deps.branchService.applyCommitPatch(ws.rootPath, patchBody, {
            stashAndContinue: body.stashAndContinue === true,
            stashMessage: STASH_MESSAGE,
        });

        if (result.success) {
            const operation = await this.deps.runner.recordCompleted({
                workspaceId: ws.id,
                op: 'cherry-pick-transfer',
                startedAt,
                metadata: buildPatchTransferMetadata(
                    body,
                    ws,
                    branchStatus.name,
                    result.headHash,
                    result.stashed === true,
                ),
            });
            this.deps.runner.invalidateCache(ws.id);
            this.deps.runner.broadcast(ws.id, 'patch-apply');
            return {
                status: 200,
                payload: {
                    success: true,
                    targetWorkspace: { id: ws.id, name: ws.name },
                    targetBranch: branchStatus.name,
                    targetHead: result.headHash,
                    newCommitHash: result.headHash,
                    stashed: result.stashed === true,
                    ...(result.appliedCount !== undefined ? { appliedCount: result.appliedCount } : {}),
                    operation,
                },
            };
        }

        const conflictResponse = conflictResponseFor(result, {
            dirty: { stashed: result.stashed === true },
            conflicts: {
                stashed: result.stashed === true,
                gitState: result.gitState,
                ...(result.appliedCount !== undefined ? { appliedCount: result.appliedCount } : {}),
            },
        });
        if (conflictResponse) return conflictResponse;
        throw badRequest('Patch apply failed: ' + result.message);
    }

    /**
     * Reject targets that cannot safely take a patch: an in-progress git
     * operation, a non-repo, or detached HEAD.
     */
    private async preflight(ws: WorkspaceInfo): Promise<PatchTransferResponse | { branchStatus: BranchStatus }> {
        const repoState = this.deps.branchService.getRepoState(ws.rootPath);
        if (repoState.operation !== 'none') {
            return {
                status: 409,
                payload: {
                    error: `Target workspace already has a ${repoState.gitOperation ?? repoState.operation} operation in progress`,
                    operation: repoState.operation,
                    gitOperation: repoState.gitOperation,
                    conflictFiles: repoState.conflictFiles,
                },
            };
        }

        const hasUncommittedChanges = await this.deps.branchService.hasUncommittedChanges(ws.rootPath);
        const branchStatus = await this.deps.branchService.getBranchStatus(ws.rootPath, hasUncommittedChanges);
        if (!branchStatus) throw badRequest('Target workspace is not a usable git repository');
        if (branchStatus.isDetached) {
            return {
                status: 409,
                payload: {
                    error: 'Target workspace is in detached HEAD state',
                    targetBranch: null,
                    detachedHash: branchStatus.detachedHash,
                },
            };
        }
        return { branchStatus };
    }

    /**
     * The source workspace's remote in normalized form, so the target can tell
     * whether both sides are clones of the same repository.
     * Backfills `workspace.remoteUrl` when it was previously unknown.
     */
    private async resolveNormalizedRemoteUrl(ws: WorkspaceInfo): Promise<string | null> {
        const remoteUrl = await this.resolveRemoteUrl(ws);
        return remoteUrl ? normalizeRemoteUrl(remoteUrl) || null : null;
    }

    private async resolveRemoteUrl(ws: WorkspaceInfo): Promise<string | undefined> {
        if (ws.remoteUrl?.trim()) return ws.remoteUrl;
        const remoteUrl = await detectRemoteUrl(ws.rootPath);
        if (remoteUrl && remoteUrl !== ws.remoteUrl) {
            await this.deps.store.updateWorkspace(ws.id, { remoteUrl });
        }
        return remoteUrl;
    }
}
