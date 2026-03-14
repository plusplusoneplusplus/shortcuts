import type { WebApi } from 'azure-devops-node-api';

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
}
