import { loadNativeGit, type NativeGitRemotePatchSource } from '@plusplusoneplusplus/coc-native';
import { resolveWorkspaceExecutionContext } from '@plusplusoneplusplus/forge';
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
) {
    const addon = loadNativeGit();
    // A remote-only selection still supports hunks without inventing a checkout root.
    if (!repo.localPath) return addon.processGitPatch(await fetchDiff());

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
    if (execution.kind === 'wsl' && !execution.distro) {
        throw new Error('Remote patch processing requires a resolved WSL distro identity');
    }
    const store = addon.openRemoteGitPatchStore(workspaceId,
        execution.kind === 'wsl' ? execution.linuxWorkingDirectory : repo.localPath,
        source, execution.kind === 'wsl' ? execution.distro : undefined);
    try {
        const request = store.beginTransport();
        try {
            return await request.process(await fetchDiff());
        } finally {
            request.cancel();
        }
    } finally {
        store.dispose();
    }
}
