/**
 * Runtime Config Service
 *
 * Central service that owns config loading, validation, persistence,
 * resolved snapshots, source metadata, revisioning, and update notifications.
 *
 * Consumers obtain the current config snapshot from this service instead of
 * independently calling resolveConfig(). Admin config writes go through
 * updateConfig() so disk writes, validation, source refresh, revision bumping,
 * and listener notifications happen in one place.
 */

import type {
    CLIConfig,
    ResolvedCLIConfig,
    ConfigSourceKey,
    ConfigFieldSource,
    AdminConfigWithSource,
} from '../config';
import {
    loadConfigFile,
    writeConfigFile,
    getConfigFilePath,
    resolveConfig,
    getResolvedConfigWithSource,
    getDefaultValues,
} from '../config';
import { validateConfigWithSchema } from './schema';
import { ADMIN_CONFIG_FIELDS } from '../server/admin/admin-config-fields';

// ============================================================================
// Types
// ============================================================================

/** Runtime behavior classification for admin-editable config fields. */
export type ConfigFieldRuntime = 'live' | 'reloadable' | 'restartRequired';

/** Effect of a config field change after an update. */
export interface ConfigChangeEffect {
    field: string;
    runtime: ConfigFieldRuntime;
    requiresRestart: boolean;
}

/** Snapshot of the current runtime config state. */
export interface RuntimeConfigSnapshot {
    config: ResolvedCLIConfig;
    sources: Record<ConfigSourceKey, ConfigFieldSource>;
    revision: number;
}

/** Result of a successful config update. */
export interface RuntimeConfigUpdateResult extends RuntimeConfigSnapshot {
    effects: ConfigChangeEffect[];
}

/** Listener callback invoked after a successful config update. */
export type ConfigChangeListener = (snapshot: RuntimeConfigSnapshot) => void;

// ============================================================================
// Runtime Config Service
// ============================================================================

export class RuntimeConfigService {
    private _config: ResolvedCLIConfig;
    private _sources: Record<ConfigSourceKey, ConfigFieldSource>;
    private _revision: number;
    private _configPath: string;
    private _listeners: Set<ConfigChangeListener> = new Set();
    private _updateQueue: Promise<void> = Promise.resolve();

    constructor(options?: {
        configPath?: string;
        /** Pre-loaded file config (skips file I/O for initial resolution). */
        fileConfig?: CLIConfig;
    }) {
        this._configPath = options?.configPath ?? getConfigFilePath();
        this._revision = 0;

        if (options?.fileConfig) {
            // When a pre-loaded config is supplied, merge it with defaults
            // instead of reading from disk. This is used by tests and by
            // callers that have already parsed the config file.
            this._config = resolveConfig(undefined, options.fileConfig);
            this._sources = {} as Record<ConfigSourceKey, ConfigFieldSource>;
        } else {
            const initial = getResolvedConfigWithSource(options?.configPath);
            this._config = initial.resolved;
            this._sources = initial.sources;
        }
    }

    // ── Snapshot ─────────────────────────────────────────────────────────

    /** Current resolved config. */
    get config(): ResolvedCLIConfig {
        return this._config;
    }

    /** Current per-field source metadata. */
    get sources(): Record<ConfigSourceKey, ConfigFieldSource> {
        return this._sources;
    }

    /** Monotonically increasing revision counter (starts at 0, bumps on each successful update). */
    get revision(): number {
        return this._revision;
    }

    /** Config file path used by this service. */
    get configPath(): string {
        return this._configPath;
    }

    /** Default values for all tracked config keys (static, computed once). */
    get defaults(): Record<string, unknown> {
        return getDefaultValues();
    }

    /** Return a snapshot object (config + sources + revision). */
    getSnapshot(): RuntimeConfigSnapshot {
        return {
            config: this._config,
            sources: { ...this._sources },
            revision: this._revision,
        };
    }

    // ── Refresh ──────────────────────────────────────────────────────────

    /**
     * Re-read config from disk and refresh the in-memory snapshot.
     * Does NOT increment the revision (no user-initiated change).
     */
    refresh(): void {
        const fresh = getResolvedConfigWithSource(this._configPath);
        this._config = fresh.resolved;
        this._sources = fresh.sources;
    }

    // ── Update ───────────────────────────────────────────────────────────

    /**
     * Validate and apply a config patch.
     *
     * Serialized through a promise queue so concurrent admin writes
     * cannot corrupt the config file.
     *
     * @param patch - Flat key/value pairs matching ADMIN_CONFIG_FIELDS keys.
     * @returns Updated snapshot with effects describing which fields changed.
     * @throws Error with validation message if any field is invalid.
     */
    async updateConfig(
        patch: Record<string, unknown>,
    ): Promise<RuntimeConfigUpdateResult> {
        // Wrap in the serialization queue
        return new Promise<RuntimeConfigUpdateResult>((resolve, reject) => {
            this._updateQueue = this._updateQueue.then(async () => {
                try {
                    const result = this._applyUpdate(patch);
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            });
        });
    }

    /**
     * Internal: validate, write, refresh, bump revision, notify.
     * Called inside the serialization queue.
     */
    private _applyUpdate(
        patch: Record<string, unknown>,
    ): RuntimeConfigUpdateResult {
        // 1. Validate all present editable fields via registry
        const errors: string[] = [];
        const matchedFields: typeof ADMIN_CONFIG_FIELDS[number][] = [];

        for (const field of ADMIN_CONFIG_FIELDS) {
            if (field.key in patch) {
                const err = field.validate(patch[field.key]);
                if (err) {
                    errors.push(err);
                } else {
                    matchedFields.push(field);
                }
            }
        }

        if (errors.length > 0) {
            throw new Error(errors.join('; '));
        }

        if (matchedFields.length === 0) {
            throw new Error('No valid editable fields in patch');
        }

        // 2. Load current file config
        const existing: CLIConfig = loadConfigFile(this._configPath) ?? {};

        // 3. Apply validated fields
        for (const field of matchedFields) {
            field.apply(existing, patch[field.key]);
        }

        // 4. Validate cross-field constraints before mutating disk.
        validateConfigWithSchema(existing);

        // 5. Write to disk (atomic write-then-rename)
        writeConfigFile(this._configPath, existing);

        // 6. Refresh in-memory snapshot from disk
        const fresh = getResolvedConfigWithSource(this._configPath);
        this._config = fresh.resolved;
        this._sources = fresh.sources;

        // 7. Bump revision
        this._revision++;

        // 8. Build effects using actual field runtime classification
        const effects: ConfigChangeEffect[] = matchedFields.map(field => ({
            field: field.key,
            runtime: field.runtime,
            requiresRestart: field.runtime === 'restartRequired',
        }));

        const snapshot = this.getSnapshot();

        // 9. Notify listeners
        for (const listener of this._listeners) {
            try {
                listener(snapshot);
            } catch {
                // Listener errors must not block the update
            }
        }

        return { ...snapshot, effects };
    }

    // ── Listeners ────────────────────────────────────────────────────────

    /** Register a listener that will be called after each successful update. */
    onChange(listener: ConfigChangeListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** Remove all listeners (for cleanup/tests). */
    removeAllListeners(): void {
        this._listeners.clear();
    }
}
