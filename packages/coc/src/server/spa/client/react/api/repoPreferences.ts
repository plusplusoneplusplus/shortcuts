import type { CocClient, PerRepoPreferences } from '@plusplusoneplusplus/coc-client';
import { configCacheKey, getOrFetchConfig, invalidateConfig, peekConfig } from './staticConfigCache';

type PreferencesOwner = Pick<CocClient, 'preferences'> & Partial<Pick<CocClient, 'options'>>;

export const REPO_PREFERENCES_TTL_MS = 30_000;

const ownerIds = new WeakMap<object, number>();
let nextOwnerId = 0;

function preferencesKey(client: PreferencesOwner, workspaceId: string): string {
    // Include the API prefix: container agents can share an origin but own different preferences.
    let owner: string;
    if (typeof client.options?.baseUrl === 'string' && typeof client.options.apiBasePath === 'string') {
        owner = JSON.stringify([client.options.baseUrl.replace(/\/+$/, ''), client.options.apiBasePath]);
    } else {
        // Narrow client facades without transport options retain their concrete owner's identity.
        let id = ownerIds.get(client.preferences);
        if (id === undefined) {
            id = ++nextOwnerId;
            ownerIds.set(client.preferences, id);
        }
        owner = `client:${id}`;
    }
    return configCacheKey.repoPreferences(workspaceId, owner);
}

export function peekRepoPreferences(client: PreferencesOwner, workspaceId: string): PerRepoPreferences | undefined {
    return peekConfig(preferencesKey(client, workspaceId), REPO_PREFERENCES_TTL_MS);
}

export function getRepoPreferences(client: PreferencesOwner, workspaceId: string): Promise<PerRepoPreferences> {
    return getOrFetchConfig(
        preferencesKey(client, workspaceId),
        () => client.preferences.getRepo(workspaceId),
        REPO_PREFERENCES_TTL_MS,
    );
}

export async function patchRepoPreferences(
    client: PreferencesOwner,
    workspaceId: string,
    patch: PerRepoPreferences,
): Promise<PerRepoPreferences> {
    const result = await client.preferences.patchRepo(workspaceId, patch);
    invalidateRepoPreferences(client, workspaceId);
    return result;
}

export async function updateRepoPreferences(
    client: PreferencesOwner,
    workspaceId: string,
    patch: PerRepoPreferences,
): Promise<PerRepoPreferences> {
    const result = await client.preferences.updateRepo(workspaceId, patch);
    invalidateRepoPreferences(client, workspaceId);
    return result;
}

export function invalidateRepoPreferences(client: PreferencesOwner, workspaceId: string): void {
    invalidateConfig(preferencesKey(client, workspaceId));
}
