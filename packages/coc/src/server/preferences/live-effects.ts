import { DEFAULT_SYNC_INTERVAL_MINUTES } from '../sync/sync-constants';
import type { SyncEngine } from '../sync/sync-engine';
import type { PerRepoPreferences } from './schema';

export interface RepoPreferencesLiveEffectsOptions {
    getSyncEngine?: (workspaceId: string) => SyncEngine | undefined;
    onRepoPreferencesChanged?: (workspaceId: string, preferences: PerRepoPreferences) => void | Promise<void>;
    logError?: (message: string) => void;
}

export interface ApplyRepoPreferencesLiveEffectsOptions extends RepoPreferencesLiveEffectsOptions {
    workspaceId: string;
    preferences: PerRepoPreferences;
    patch?: PerRepoPreferences;
    kind: 'replace' | 'patch';
}

export function applyRepoPreferencesLiveEffects(options: ApplyRepoPreferencesLiveEffectsOptions): void {
    const shouldApplySync = options.kind === 'replace'
        ? options.preferences.sync !== undefined
        : options.patch?.sync !== undefined;
    if (shouldApplySync && options.getSyncEngine) {
        const engine = options.getSyncEngine(options.workspaceId);
        if (engine) {
            const gitRemote = options.preferences.sync?.gitRemote ?? '';
            const intervalMinutes = options.preferences.sync?.intervalMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES;
            engine.start(gitRemote, intervalMinutes).catch(error => {
                logPreferenceEffectError(
                    options,
                    `Failed to reconfigure sync engine for '${options.workspaceId}': ${getErrorMessage(error)}`,
                );
            });
        }
    }

    // Notify on any patch, not just the sections that happened to need it first.
    // Every listener re-reads the preference it cares about and no-ops when it is
    // unchanged, so an extra notification is cheap — whereas a missing one leaves
    // a live timer stale until the next restart. A `PATCH` touching only
    // `autoPull` used to fall through here and never re-arm its pull timer.
    const shouldNotifyRepoPreferences = options.kind === 'replace' || options.patch !== undefined;
    if (shouldNotifyRepoPreferences && options.onRepoPreferencesChanged) {
        Promise.resolve(options.onRepoPreferencesChanged(options.workspaceId, options.preferences)).catch(error => {
            logPreferenceEffectError(
                options,
                `Failed to apply live repo preferences for '${options.workspaceId}': ${getErrorMessage(error)}`,
            );
        });
    }
}

function logPreferenceEffectError(options: RepoPreferencesLiveEffectsOptions, message: string): void {
    if (options.logError) {
        options.logError(message);
        return;
    }
    process.stderr.write(`[preferences] ${message}\n`);
}

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
