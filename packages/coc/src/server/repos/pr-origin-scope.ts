import {
    type ProcessStore,
    type WorkspaceInfo,
} from '@plusplusoneplusplus/forge';
import {
    detectRemoteUrl,
    resolveCanonicalOriginId,
} from '@plusplusoneplusplus/forge/git';

export interface PullRequestLegacyStorageScope {
    workspaceId: string;
    repoId: string;
}

export interface PullRequestStorageScope {
    /** Directory key under <dataDir>/repos/ used for persistent PR state. */
    storageOriginId: string;
    /** Legacy workspace/repo tuples to migrate into the origin directory. */
    legacyScopes?: readonly PullRequestLegacyStorageScope[];
}

export type PullRequestStorageScopeInput = PullRequestStorageScope | string | undefined;

type PullRequestScopeProcessStore = Pick<ProcessStore, 'getWorkspaces' | 'updateWorkspace'>;

export interface ResolvePullRequestStorageScopeOptions {
    workspaceId: string;
    repoId: string;
    remoteUrl?: string | null;
    rootPath?: string | null;
    processStore?: PullRequestScopeProcessStore;
}

export interface ResolvePullRequestOriginStorageScopeOptions {
    originId: string;
    processStore?: PullRequestScopeProcessStore;
}

function isCanonicalOriginId(value: string): boolean {
    return /^(gh|ado|git|local)_/.test(value);
}

function trimNonEmpty(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed || undefined;
}

function dedupeLegacyScopes(scopes: readonly PullRequestLegacyStorageScope[]): PullRequestLegacyStorageScope[] {
    const seen = new Set<string>();
    const out: PullRequestLegacyStorageScope[] = [];
    for (const scope of scopes) {
        const workspaceId = trimNonEmpty(scope.workspaceId);
        const repoId = trimNonEmpty(scope.repoId);
        if (!workspaceId || !repoId) continue;
        const key = `${workspaceId}\u0000${repoId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ workspaceId, repoId });
    }
    return out;
}

async function resolveRemoteUrl(
    workspaceId: string,
    remoteUrl: string | null | undefined,
    rootPath: string | null | undefined,
    processStore?: Pick<ProcessStore, 'updateWorkspace'>,
): Promise<string | undefined> {
    const provided = trimNonEmpty(remoteUrl);
    if (provided) return provided;
    const root = trimNonEmpty(rootPath);
    if (!root) return undefined;
    const detected = await detectRemoteUrl(root);
    if (detected && typeof processStore?.updateWorkspace === 'function') {
        await processStore.updateWorkspace(workspaceId, { remoteUrl: detected });
    }
    return detected;
}

async function resolveWorkspaceOriginId(
    workspace: WorkspaceInfo,
    processStore: PullRequestScopeProcessStore,
): Promise<string> {
    const remoteUrl = await resolveRemoteUrl(
        workspace.id,
        workspace.remoteUrl,
        workspace.rootPath,
        processStore,
    );
    return resolveCanonicalOriginId({ remoteUrl, workspaceId: workspace.id });
}

export function resolvePullRequestStorageId(
    workspaceId: string,
    scope?: PullRequestStorageScopeInput,
): string {
    if (typeof scope === 'string') return scope.trim() || workspaceId;
    return scope?.storageOriginId?.trim() || workspaceId;
}

export function resolvePullRequestLegacyScopes(
    workspaceId: string,
    repoId: string,
    scope?: PullRequestStorageScopeInput,
): PullRequestLegacyStorageScope[] {
    const currentScopes: PullRequestLegacyStorageScope[] = [
        { workspaceId, repoId },
    ];
    if (workspaceId !== repoId) {
        currentScopes.push({ workspaceId, repoId: workspaceId });
        currentScopes.push({ workspaceId: repoId, repoId });
        currentScopes.push({ workspaceId: repoId, repoId: workspaceId });
    }
    const configuredScopes = typeof scope === 'object' ? scope.legacyScopes ?? [] : [];
    return dedupeLegacyScopes([...currentScopes, ...configuredScopes]);
}

export function isPullRequestOriginScoped(
    workspaceId: string,
    scope?: PullRequestStorageScopeInput,
): boolean {
    if (!scope) return false;
    if (typeof scope === 'string') return true;
    return Boolean(scope.storageOriginId?.trim());
}

export async function resolvePullRequestStorageScope(
    options: ResolvePullRequestStorageScopeOptions,
): Promise<PullRequestStorageScope> {
    const workspaceId = trimNonEmpty(options.workspaceId);
    const repoId = trimNonEmpty(options.repoId);
    if (!workspaceId || !repoId) {
        throw new Error('workspaceId and repoId are required to resolve pull-request storage scope');
    }

    const remoteUrl = await resolveRemoteUrl(
        workspaceId,
        options.remoteUrl,
        options.rootPath,
        options.processStore,
    );
    const storageOriginId = resolveCanonicalOriginId({ remoteUrl, workspaceId });
    const legacyScopes: PullRequestLegacyStorageScope[] = [
        { workspaceId, repoId },
    ];

    const processStore = options.processStore;
    if (
        processStore &&
        typeof processStore.getWorkspaces === 'function' &&
        typeof processStore.updateWorkspace === 'function' &&
        !isCanonicalOriginId(repoId)
    ) {
        const workspaces = await processStore.getWorkspaces();
        for (const workspace of workspaces) {
            const originId = await resolveWorkspaceOriginId(workspace, processStore);
            if (originId !== storageOriginId) continue;
            legacyScopes.push({ workspaceId: workspace.id, repoId: workspace.id });
            legacyScopes.push({ workspaceId: workspace.id, repoId });
        }
    }

    return {
        storageOriginId,
        legacyScopes: dedupeLegacyScopes(legacyScopes),
    };
}

export async function resolvePullRequestOriginStorageScope(
    options: ResolvePullRequestOriginStorageScopeOptions,
): Promise<PullRequestStorageScope> {
    const storageOriginId = trimNonEmpty(options.originId);
    if (!storageOriginId) {
        throw new Error('originId is required to resolve pull-request storage scope');
    }

    const legacyScopes: PullRequestLegacyStorageScope[] = [];
    const processStore = options.processStore;
    if (
        processStore &&
        typeof processStore.getWorkspaces === 'function' &&
        typeof processStore.updateWorkspace === 'function'
    ) {
        const workspaces = await processStore.getWorkspaces();
        for (const workspace of workspaces) {
            const originId = await resolveWorkspaceOriginId(workspace, processStore);
            if (originId !== storageOriginId) continue;
            legacyScopes.push({ workspaceId: workspace.id, repoId: workspace.id });
        }
    }

    return {
        storageOriginId,
        legacyScopes: dedupeLegacyScopes(legacyScopes),
    };
}
