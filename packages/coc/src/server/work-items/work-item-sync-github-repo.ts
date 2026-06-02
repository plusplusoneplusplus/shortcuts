import { execFileSync } from 'child_process';

export interface WorkItemSyncGithubPreference {
    owner?: string;
    repo?: string;
}

export interface WorkItemSyncRepoPreferences {
    workItems?: {
        sync?: {
            github?: WorkItemSyncGithubPreference;
        };
    };
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
    }
    | {
        available: false;
        provider: 'github';
        reason: 'incomplete-preference' | 'missing-workspace' | 'missing-origin' | 'non-github-origin';
    };

export interface ResolveGitHubWorkItemSyncRepoOptions {
    workspace?: WorkItemSyncWorkspaceInfo;
    preferences?: WorkItemSyncRepoPreferences;
    readOriginRemote?: (rootPath: string) => string | undefined;
}

export function parseGitHubRemoteUrl(remoteUrl: string): { owner: string; repo: string; url: string } | undefined {
    const trimmed = remoteUrl.trim();
    if (!trimmed) return undefined;

    const normalized = trimmed.replace(/^git\+/, '');
    let owner: string | undefined;
    let repo: string | undefined;

    const scpLike = normalized.match(/^git@github\.com:([^/]+)\/(.+)$/i);
    if (scpLike) {
        owner = scpLike[1];
        repo = scpLike[2];
    } else {
        try {
            const parsed = new URL(normalized);
            if (parsed.hostname.toLowerCase() !== 'github.com') return undefined;
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
        url: `https://github.com/${cleanOwner}/${cleanRepo}`,
    };
}

export function readGitOriginRemote(rootPath: string): string | undefined {
    try {
        const output = execFileSync('git', ['remote', 'get-url', 'origin'], {
            cwd: rootPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const remote = output.trim();
        return remote.length > 0 ? remote : undefined;
    } catch {
        return undefined;
    }
}

export function resolveGitHubWorkItemSyncRepo(options: ResolveGitHubWorkItemSyncRepoOptions): GitHubWorkItemSyncRepo {
    const pref = options.preferences?.workItems?.sync?.github;
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
            url: `https://github.com/${prefOwner}/${prefRepo}`,
            source: 'preference',
        };
    }

    const workspaceRemote = options.workspace?.remoteUrl;
    if (workspaceRemote) {
        const parsed = parseGitHubRemoteUrl(workspaceRemote);
        if (parsed) {
            return { available: true, provider: 'github', source: 'workspaceRemote', ...parsed };
        }
    }

    const rootPath = options.workspace?.rootPath;
    if (!rootPath) {
        return { available: false, provider: 'github', reason: 'missing-workspace' };
    }

    const originRemote = (options.readOriginRemote ?? readGitOriginRemote)(rootPath);
    if (!originRemote) {
        return { available: false, provider: 'github', reason: 'missing-origin' };
    }

    const parsed = parseGitHubRemoteUrl(originRemote);
    if (!parsed) {
        return { available: false, provider: 'github', reason: 'non-github-origin' };
    }

    return { available: true, provider: 'github', source: 'origin', ...parsed };
}
