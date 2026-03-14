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
    execAsync,
} from '@plusplusoneplusplus/pipeline-core';
import type { ProvidersFileConfig } from './providers-config';

export { ProviderType };

/** Azure DevOps resource ID for OAuth token requests via `az account get-access-token`. */
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

/** Sentinel returned when an ADO remote is detected but no credentials are available. */
export interface AdoNoCredentialsSentinel {
    error: 'no-ado-credentials';
}

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
     *
     * For ADO remotes, uses `az account get-access-token` bearer token (requires `az login`).
     * Returns `{ error: 'no-ado-credentials' }` sentinel when the Azure CLI call fails.
     *
     * For other providers: returns `null` when credentials are absent or the URL
     * is unrecognized (does not throw).
     */
    static async createPullRequestsService(
        remoteUrl: string,
        config: ProvidersFileConfig,
    ): Promise<IPullRequestsService | AdoNoCredentialsSentinel | null> {
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
            const parsed = ProviderFactory.parseAdoRemote(remoteUrl);
            const orgUrl = adoConfig?.orgUrl ?? parsed?.orgUrl;
            if (!orgUrl) {
                return { error: 'no-ado-credentials' };
            }

            // Azure CLI bearer token
            try {
                const { stdout } = await execAsync(
                    `az account get-access-token --resource ${ADO_RESOURCE_ID} --query accessToken -o tsv`,
                );
                const bearerToken = stdout.trim();
                if (bearerToken) {
                    return createAdoPullRequestsAdapter({
                        orgUrl,
                        token: bearerToken,
                        project: parsed?.project,
                    });
                }
            } catch {
                // az not available or not logged in — fall through to sentinel
            }

            return { error: 'no-ado-credentials' };
        }

        return null;
    }
}
