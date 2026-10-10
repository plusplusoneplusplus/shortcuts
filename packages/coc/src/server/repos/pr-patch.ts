import { loadNativeGit, type NativeGitPatchStore, type NativeGitRemotePatchSource } from '@plusplusoneplusplus/coc-native';
import { loadSuppliedPatch, openRemotePatchStore, resolveWorkspaceExecutionContext } from '@plusplusoneplusplus/forge';
import { ProviderFactory } from '../providers/provider-factory';
import type { ProvidersFileConfig } from '../providers/providers-config';
import type { RepoInfo } from './types';

/** Request-owned scopes need no registry, retained transport or patch-result cache. */
export async function loadPullRequestPatch(
    repo: RepoInfo,
    workspaceId: string,
    prId: number | string,
    config: ProvidersFileConfig,
    fetchDiff: () => Promise<string>,
    signal?: AbortSignal,
) {
    signal?.throwIfAborted();
    loadNativeGit();
    let store: NativeGitPatchStore | undefined;
    // A remote-only selection still supports hunks without inventing a checkout root.
    if (repo.localPath) {
        const remote = repo.remoteUrl ?? '';
        const github = ProviderFactory.parseGitHubRemote(remote);
        const ado = github ? null : ProviderFactory.parseAdoRemote(remote);
        let source: NativeGitRemotePatchSource;
        if (github) {
            source = {
                provider: 'github', host: 'github.com',
                repository: `github:${github.owner}/${github.repo}`, sourceId: String(prId),
            };
        } else if (ado) {
            const org = new URL(config.providers.ado?.orgUrl ?? ado.orgUrl);
            source = {
                provider: 'ado', host: org.host,
                repository: `ado:${org.pathname.replace(/\/+$/, '')}/${ado.project}/${ado.repo}`,
                sourceId: String(prId),
            };
        } else {
            throw new Error('Cannot resolve pull request patch provider identity');
        }

        const execution = resolveWorkspaceExecutionContext(repo.localPath);
        store = openRemotePatchStore(workspaceId, execution, source);
    }
    try {
        return await loadSuppliedPatch(fetchDiff, store, signal);
    } finally {
        store?.dispose();
    }
}
