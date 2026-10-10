/**
 * Pull-request diff providers: PR (latest) and PR iteration.
 *
 * Both providers work by fetching the full unified diff from the remote
 * provider (via `IPullRequestsService.getDiff()` or a caller-supplied
 * callback) and processing it through the Rust patch backend.
 *
 * This keeps the diff module decoupled from provider-specific APIs (ADO, GitHub).
 */

import { loadNativeGit, type NativeGitPatchStore } from '@plusplusoneplusplus/coc-native';
import type { IPullRequestsService } from '../providers/interfaces';
import { resolveWorkspaceExecutionContext } from '../utils/workspace-execution';
import type {
    GetFileDiffOptions,
    IDiffProvider,
    PullRequestDiffSource,
    PullRequestIterationDiffSource,
} from './types';
import { createPatchDiffProvider, nativePatchToDiff } from './diff-utils';

/** Authenticated transport identity, independent of provider routing aliases. */
export interface RemoteDiffContext {
    workspaceId: string;
    host: string;
    /** Provider-qualified organization/project/repository identity. */
    repository: string;
}

export interface RemoteDiffProvider extends IDiffProvider {
    refresh(): void;
    dispose(): void;
}

// ── Core remote provider builder ─────────────────────────────
function createRemoteDiffProvider(
    source: PullRequestDiffSource | PullRequestIterationDiffSource,
    fetchFullDiff: () => Promise<string>,
    context: RemoteDiffContext,
): RemoteDiffProvider {
    const identity = { ...context };
    const descriptor = Object.freeze({ ...source });
    let store: NativeGitPatchStore | undefined;
    function getStore() {
        if (!store) {
            const addon = loadNativeGit();
            const execution = resolveWorkspaceExecutionContext(descriptor.repositoryRoot);
            if (execution.kind === 'wsl' && !execution.distro) {
                throw new Error('Remote patch processing requires a resolved WSL distro identity');
            }
            store = addon.openRemoteGitPatchStore(identity.workspaceId,
                execution.kind === 'wsl' ? execution.linuxWorkingDirectory : descriptor.repositoryRoot, {
                    provider: descriptor.provider,
                    host: identity.host,
                    repository: identity.repository,
                    sourceId: String(descriptor.pullRequestId),
                    iteration: descriptor.kind === 'pr-iteration' ? String(descriptor.iterationId) : undefined,
                    baseIteration: descriptor.kind === 'pr-iteration' && descriptor.baseIterationId != null
                        ? String(descriptor.baseIterationId) : undefined,
                }, execution.kind === 'wsl' ? execution.distro : undefined);
        }
        return store;
    }
    async function load(filePath?: string, options?: GetFileDiffOptions) {
        const request = getStore().beginTransport();
        let result;
        try {
            result = await request.process(await fetchFullDiff());
        } finally {
            request.cancel();
        }
        const content = filePath === undefined ? result.content
            : (await loadNativeGit().processGitPatch(result.files.find(file => file.path === filePath)?.raw ?? '',
                options?.maxLines == null ? undefined : Math.floor(options.maxLines))).content;
        return { ...nativePatchToDiff(result.files), content, summary: result.summary };
    }

    return {
        ...createPatchDiffProvider(descriptor, load),
        refresh() { getStore().refresh(); },
        dispose() { getStore().dispose(); },
    };
}

// ── PR diff provider ─────────────────────────────────────────

/**
 * Create a diff provider for a pull request (latest state).
 *
 * Uses `IPullRequestsService.getDiff()` to fetch the unified diff from
 * the remote provider (GitHub or ADO).
 *
 * @throws if the service does not implement `getDiff()`.
 */
export function createPullRequestDiffProvider(
    source: PullRequestDiffSource,
    prService: IPullRequestsService,
    context: RemoteDiffContext,
): RemoteDiffProvider {
    if (!prService.getDiff) {
        throw new Error(
            `Pull request diff not supported: the ${source.provider} provider does not implement getDiff()`,
        );
    }

    const getDiff = prService.getDiff.bind(prService);

    const { remoteRepositoryId, pullRequestId } = source;
    return createRemoteDiffProvider(source, () => getDiff(remoteRepositoryId, pullRequestId), context);
}

/**
 * Convenience factory that constructs the `PullRequestDiffSource` inline.
 */
export function createPullRequestDiffProviderFromParams(
    provider: 'ado' | 'github',
    repositoryRoot: string,
    remoteRepositoryId: string,
    pullRequestId: number | string,
    prService: IPullRequestsService,
    context: RemoteDiffContext,
): RemoteDiffProvider {
    const source: PullRequestDiffSource = {
        kind: 'pr',
        provider,
        repositoryRoot,
        remoteRepositoryId,
        pullRequestId,
    };
    return createPullRequestDiffProvider(source, prService, context);
}

// ── PR iteration diff provider ───────────────────────────────

/**
 * Create a diff provider for a specific pull request iteration.
 *
 * The caller supplies a `fetchDiff` callback that returns the unified diff
 * for the given iteration. This keeps the diff module decoupled from
 * provider-specific iteration APIs.
 *
 * The callback supplies existing iteration data; this factory does not fetch
 * provider iterations or implement inter-iteration comparisons.
 */
export function createPullRequestIterationDiffProvider(
    source: PullRequestIterationDiffSource,
    fetchDiff: () => Promise<string>,
    context: RemoteDiffContext,
): RemoteDiffProvider {
    return createRemoteDiffProvider(source, fetchDiff, context);
}

/**
 * Convenience factory that constructs the `PullRequestIterationDiffSource` inline.
 */
export function createPullRequestIterationDiffProviderFromParams(
    provider: 'ado' | 'github',
    repositoryRoot: string,
    remoteRepositoryId: string,
    pullRequestId: number | string,
    iterationId: number,
    fetchDiff: () => Promise<string>,
    context: RemoteDiffContext,
    baseIterationId?: number,
): RemoteDiffProvider {
    const source: PullRequestIterationDiffSource = {
        kind: 'pr-iteration',
        provider,
        repositoryRoot,
        remoteRepositoryId,
        pullRequestId,
        iterationId,
        baseIterationId,
    };
    return createPullRequestIterationDiffProvider(source, fetchDiff, context);
}
