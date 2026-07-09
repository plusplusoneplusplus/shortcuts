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
            const intervalMinutes = options.preferences.sync?.intervalMinutes ?? 5;
            engine.start(gitRemote, intervalMinutes).catch(error => {
                logPreferenceEffectError(
                    options,
                    `Failed to reconfigure sync engine for '${options.workspaceId}': ${getErrorMessage(error)}`,
                );
            });
        }
    }

    const shouldNotifyRepoPreferences = options.kind === 'replace'
        || options.patch?.workItems !== undefined;
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
