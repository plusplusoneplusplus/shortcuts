/**
 * Provider Factory
 *
 * Maps a git remote URL to the correct IPullRequestsService adapter (GitHub or ADO),
 * backed by credentials from ProvidersFileConfig.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { IPullRequestsService } from '@plusplusoneplusplus/pipeline-core';
import {
    ProviderType,
    createGitHubPullRequestsAdapter,
    createAdoPullRequestsAdapter,
} from '@plusplusoneplusplus/pipeline-core';
import type { ProvidersFileConfig } from './providers-config';

export { ProviderType };

export class ProviderFactory {
    /**
     * Detect the provider type from a git remote URL.
     * Pure/static — safe to call with no credentials.
     * Returns null for unknown hosts.
     */
    static detectProviderType(remoteUrl: string): ProviderType | null {
        if (/github\.com/i.test(remoteUrl)) {
            return ProviderType.GitHub;
        }
        if (/dev\.azure\.com|visualstudio\.com/i.test(remoteUrl)) {
            return ProviderType.ADO;
        }
        return null;
    }

    /**
     * Parse owner and repo from a GitHub remote URL.
     * Handles both HTTPS (https://github.com/owner/repo.git)
     * and SSH (git@github.com:owner/repo.git) forms.
     * Returns null if the URL cannot be parsed.
     */
    static parseGitHubRemote(url: string): { owner: string; repo: string } | null {
        // HTTPS: https://github.com/owner/repo or https://github.com/owner/repo.git
        const httpsMatch = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\s*$/);
        if (httpsMatch) {
            return { owner: httpsMatch[1], repo: httpsMatch[2] };
        }
        // SSH: git@github.com:owner/repo.git
        const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?\s*$/);
        if (sshMatch) {
            return { owner: sshMatch[1], repo: sshMatch[2] };
        }
        return null;
    }

    /**
     * Parse orgUrl, project, and repo from an Azure DevOps remote URL.
     * Handles both dev.azure.com and visualstudio.com forms.
     * Returns null if the URL cannot be parsed.
     */
    static parseAdoRemote(
        url: string,
    ): { orgUrl: string; project: string; repo: string } | null {
        // https://dev.azure.com/org/project/_git/repo
        const devAzureMatch = url.match(
            /https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/,
        );
        if (devAzureMatch) {
            return {
                orgUrl: `https://dev.azure.com/${devAzureMatch[1]}`,
                project: devAzureMatch[2],
                repo: devAzureMatch[3],
            };
        }
        // https://org.visualstudio.com/project/_git/repo
        const vsMatch = url.match(
            /https:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)/,
        );
        if (vsMatch) {
            return {
                orgUrl: `https://${vsMatch[1]}.visualstudio.com`,
                project: vsMatch[2],
                repo: vsMatch[3],
            };
        }
        return null;
    }

    /**
     * Instantiate an IPullRequestsService for the given remote URL and config.
     * Returns null (does not throw) when credentials are absent or the URL is unrecognized.
     */
    static createPullRequestsService(
        remoteUrl: string,
        config: ProvidersFileConfig,
    ): IPullRequestsService | null {
        const providerType = ProviderFactory.detectProviderType(remoteUrl);

        if (providerType === ProviderType.GitHub) {
            const token = config.providers.github?.token;
            if (!token) {
                return null;
            }
            const parsed = ProviderFactory.parseGitHubRemote(remoteUrl);
            if (!parsed) {
                return null;
            }
            return createGitHubPullRequestsAdapter({ token, owner: parsed.owner, repo: parsed.repo });
        }

        if (providerType === ProviderType.ADO) {
            const adoConfig = config.providers.ado;
            if (!adoConfig?.token) {
                return null;
            }
            const parsed = ProviderFactory.parseAdoRemote(remoteUrl);
            const orgUrl = adoConfig.orgUrl ?? parsed?.orgUrl;
            if (!orgUrl) {
                return null;
            }
            return createAdoPullRequestsAdapter({
                orgUrl,
                token: adoConfig.token,
                project: parsed?.project,
            });
        }

        return null;
    }
}
