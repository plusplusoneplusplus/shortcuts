import type { WebApi } from 'azure-devops-node-api';
import type { AdoAccountInfo } from './ado-session-cache';

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
    /** Directory where `~/.coc/ado-session.json` is written. Defaults to `~/.coc`. */
    dataDir?: string;
}
