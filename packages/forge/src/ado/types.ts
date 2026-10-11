import type { WebApi } from 'azure-devops-node-api';

export interface AdoAccountInfo {
    upn: string;
    displayName: string;
    /** ADO identity GUID, distinct from the Microsoft account selector. */
    adoId: string | null;
}

/**
 * Discriminated union returned by `AdoConnectionFactory.connect()`.
 * Callers narrow via the `connected` discriminant.
 */
export type AdoConnectionResult =
    | { connected: true; connection: WebApi; account?: AdoAccountInfo | null }
    | { connected: false; error: string };

/** Optional overrides that let callers skip env-var lookup (useful for tests). */
export interface AdoClientOptions {
    orgUrl?: string;
    /** Host data directory identifying the shared authentication lifetime. */
    dataDir?: string;
}
