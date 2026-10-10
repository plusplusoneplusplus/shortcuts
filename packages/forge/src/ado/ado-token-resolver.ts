import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuthError, MicrosoftTokenProvider } from '@plusplusoneplusplus/coc-native';
import type { AdoAccountInfo } from './types';

/** Azure DevOps resource ID for OAuth token requests. */
export const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

export interface ResolveAdoAccessTokenOptions {
    /** Host data directory identifying the shared authentication lifetime. */
    dataDir?: string;
}

export interface ResolvedAdoAccessToken {
    token: string;
    expiresAt: number;
    account: AdoAccountInfo;
}

const providers = new Map<string, MicrosoftTokenProvider>();

function resolveScope(dataDir?: string): string {
    return path.resolve(dataDir ?? process.env.COC_DATA_DIR ?? path.join(os.homedir(), '.coc'));
}

/**
 * All workspaces on a host share one source-pinned provider. Native auth owns
 * account discovery, token validation, caching, single-flight and renewal.
 */
export async function resolveAdoAccessToken(
    options?: ResolveAdoAccessTokenOptions,
): Promise<ResolvedAdoAccessToken> {
    const scope = resolveScope(options?.dataDir);
    let provider = providers.get(scope);
    if (!provider) {
        provider = new MicrosoftTokenProvider({
            source: 'azure-cli',
            refresh: 'auto',
            expiryMarginSeconds: 300,
            azureCli: {
                selection: 'active-account',
                namespace: `coc-ado-${randomUUID()}`,
                resource: ADO_RESOURCE_ID,
            },
        });
        providers.set(scope, provider);
    }
    const result = await provider.getToken();
    // Disposal revokes even a token acquisition that completes late.
    if (providers.get(scope) !== provider) {
        throw new AuthError('Disposed');
    }
    return {
        token: result.accessToken,
        expiresAt: result.expiresAt,
        account: { upn: result.account.id, displayName: result.account.id, adoId: null },
    };
}

export async function resolveAdoAccessTokenValue(
    options?: ResolveAdoAccessTokenOptions,
): Promise<string> {
    return (await resolveAdoAccessToken(options)).token;
}

/** End the host authentication lifetime; a subsequent call selects an account afresh. */
export function disposeAdoTokenResolver(dataDir?: string): void {
    const scope = resolveScope(dataDir);
    const provider = providers.get(scope);
    providers.delete(scope);
    provider?.dispose();
}

export function resetAdoTokenResolverForTests(): void {
    for (const scope of providers.keys()) {
        disposeAdoTokenResolver(scope);
    }
}
