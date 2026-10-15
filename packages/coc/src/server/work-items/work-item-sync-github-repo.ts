import { getRemoteUrl } from '@plusplusoneplusplus/forge';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';

export interface WorkItemSyncGithubPreference {
    host?: string;
    login?: string;
    owner?: string;
    repo?: string;
    [key: string]: unknown;
}

export interface WorkItemSyncRepoPreferences {
    workItems?: {
        sync?: {
            github?: WorkItemSyncGithubPreference;
        };
    };
    [key: string]: unknown;
}

export interface WorkItemSyncWorkspaceInfo {
    rootPath?: string;
    remoteUrl?: string;
}

export type GitHubWorkItemSyncRepo =
    | {
        available: true;
        provider: 'github';
        owner: string;
        repo: string;
        url: string;
        source: 'preference' | 'workspaceRemote' | 'origin';
        login?: string;
    }
    | {
        available: false;
        provider: 'github';
        reason: 'incomplete-preference' | 'invalid-host' | 'missing-workspace' | 'missing-origin' | 'non-github-origin';
    };

export interface ResolveGitHubWorkItemSyncRepoOptions {
    workspace?: WorkItemSyncWorkspaceInfo;
    preferences?: WorkItemSyncRepoPreferences;
    readOriginRemote?: (rootPath: string) => string | undefined | Promise<string | undefined>;
}

export function parseGitHubRemoteUrl(remoteUrl: string, host = 'github.com'): { owner: string; repo: string; url: string } | undefined {
    const trimmed = remoteUrl.trim();
    if (!trimmed) return undefined;

    const normalized = trimmed.replace(/^git\+/, '');
    let owner: string | undefined;
    let repo: string | undefined;

    const scpLike = normalized.match(/^git@([^:]+):([^/]+)\/(.+)$/i);
    if (scpLike) {
        if (scpLike[1].toLowerCase() !== host) return undefined;
        owner = scpLike[2];
        repo = scpLike[3];
    } else {
        try {
            const parsed = new URL(normalized);
            if (parsed.hostname.toLowerCase() !== host || parsed.port) return undefined;
            const parts = parsed.pathname.replace(/^\/+/, '').split('/');
            if (parts.length >= 2) {
                owner = parts[0];
                repo = parts[1];
            }
        } catch {
            return undefined;
        }
    }

    const cleanOwner = owner?.trim();
    const cleanRepo = repo?.trim().replace(/\.git$/i, '');
    if (!cleanOwner || !cleanRepo || cleanOwner.includes('/') || cleanRepo.includes('/')) {
        return undefined;
    }

    return {
        owner: cleanOwner,
        repo: cleanRepo,
        url: `https://${host}/${cleanOwner}/${cleanRepo}`,
    };
}

/**
 * The repository's `origin` URL, or `undefined` when there is not one.
 *
 * Reading a remote is a configuration lookup, so this starts no child process
 * at all: `getRemoteUrl` opens the repository with `gix` and reads
 * `remote.origin.url` out of it. A repository with no origin, an unreadable
 * one, and a path that is not a repository all answer `undefined`, exactly as
 * the old `git remote get-url origin` did.
 *
 * A broken native addon is the one failure that does not answer `undefined`.
 * It is a broken install rather than a workspace with no remote, and silence
 * here costs a work item its GitHub binding and a native session its
 * repository filter — neither of which says anything about why.
 */
export async function readGitOriginRemote(rootPath: string): Promise<string | undefined> {
    try {
        const remote = (await getRemoteUrl(rootPath))?.trim();
        return remote ? remote : undefined;
    } catch (err: unknown) {
        if (err instanceof NativeAddonLoadError) {
            throw err;
        }
        return undefined;
    }
}

export async function resolveGitHubWorkItemSyncRepo(options: ResolveGitHubWorkItemSyncRepoOptions): Promise<GitHubWorkItemSyncRepo> {
    const pref = options.preferences?.workItems?.sync?.github;
    const host = pref?.host ?? 'github.com';
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)) {
        return { available: false, provider: 'github', reason: 'invalid-host' };
    }
    const normalizedHost = host.toLowerCase();
    const account = pref?.login !== undefined ? { login: pref.login } : {};
    const prefOwner = pref?.owner?.trim();
    const prefRepo = pref?.repo?.trim();
    if (prefOwner || prefRepo) {
        if (!prefOwner || !prefRepo) {
            return { available: false, provider: 'github', reason: 'incomplete-preference' };
        }
        return {
            available: true,
            provider: 'github',
            owner: prefOwner,
            repo: prefRepo,
            url: `https://${normalizedHost}/${prefOwner}/${prefRepo}`,
            source: 'preference',
            ...account,
        };
    }

    const workspaceRemote = options.workspace?.remoteUrl;
    if (workspaceRemote) {
        const parsed = parseGitHubRemoteUrl(workspaceRemote, normalizedHost);
        if (parsed) {
            return { available: true, provider: 'github', source: 'workspaceRemote', ...parsed, ...account };
        }
    }

    const rootPath = options.workspace?.rootPath;
    if (!rootPath) {
        return { available: false, provider: 'github', reason: 'missing-workspace' };
    }

    const originRemote = await (options.readOriginRemote ?? readGitOriginRemote)(rootPath);
    if (!originRemote) {
        return { available: false, provider: 'github', reason: 'missing-origin' };
    }

    const parsed = parseGitHubRemoteUrl(originRemote, normalizedHost);
    if (!parsed) {
        return { available: false, provider: 'github', reason: 'non-github-origin' };
    }

    return { available: true, provider: 'github', source: 'origin', ...parsed, ...account };
}
