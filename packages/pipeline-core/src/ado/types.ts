import type { WebApi } from 'azure-devops-node-api';

/** Resolved connection credentials (org URL + PAT). */
export interface AdoConnectionConfig {
    orgUrl: string;
    token: string;
}

/**
 * Discriminated union returned by `AdoConnectionFactory.connect()`.
 * Callers narrow via the `connected` discriminant.
 */
export type AdoConnectionResult =
    | { connected: true; connection: WebApi }
    | { connected: false; error: string };

/** Optional overrides that let callers skip env-var lookup (useful for tests). */
export interface AdoClientOptions {
    orgUrl?: string;
    token?: string;
}
