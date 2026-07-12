import * as fs from 'fs';
import * as path from 'path';
import { getEffectiveDefaultDisabledTools } from '../llm-tools/llm-tool-registry';
import { getRepoDataPath } from '../paths';
import type { DefaultModelMode, GlobalPreferences, PerRepoPreferences } from './schema';
import {
    normalizeGlobalPreferencesForRead,
    validateGlobalPreferences,
    validatePerRepoPreferences,
} from './schema';

// ============================================================================
// Constants and Types
// ============================================================================

/** Name of the preferences file within the data directory. */
export const PREFERENCES_FILE_NAME = 'preferences.json';

/** Top-level structure of the global preferences file on disk. */
export interface PreferencesFile {
    global?: GlobalPreferences;
}

export type PreferencesReadStatus = 'ok' | 'missing' | 'invalid';

export interface PreferencesReadWarning {
    filePath: string;
    kind: 'invalid-json' | 'invalid-shape';
    message: string;
}

export interface PreferencesReadResult<T> {
    value: T;
    status: PreferencesReadStatus;
    warnings: PreferencesReadWarning[];
}

export interface RepoPreferencesChangedEvent {
    workspaceId: string;
    preferences: PerRepoPreferences;
}

const repoPreferenceListeners = new Set<(event: RepoPreferencesChangedEvent) => void>();

export function onRepoPreferencesChanged(listener: (event: RepoPreferencesChangedEvent) => void): () => void {
    repoPreferenceListeners.add(listener);
    return () => {
        repoPreferenceListeners.delete(listener);
    };
}

function emitRepoPreferencesChanged(event: RepoPreferencesChangedEvent): void {
    for (const listener of repoPreferenceListeners) {
        try { listener(event); } catch { /* preference listeners are non-fatal */ }
    }
}

// ============================================================================
// Persistence Helpers
// ============================================================================

/**
 * Read the global preferences file from disk with structured status.
 * Missing files are not warnings. Invalid/corrupt files return an empty value
 * plus a warning so callers can report recovery without changing legacy API
 * responses.
 */
export function readPreferencesWithStatus(dataDir: string): PreferencesReadResult<PreferencesFile> {
    const filePath = path.join(dataDir, PREFERENCES_FILE_NAME);
    try {
        if (!fs.existsSync(filePath)) {
            return { value: {}, status: 'missing', warnings: [] };
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
            return invalidRead(filePath, 'invalid-shape', 'Preferences file must contain a JSON object');
        }
        const obj = parsed as Record<string, unknown>;
        const result: PreferencesFile = {};

        if (typeof obj.global === 'object' && obj.global !== null) {
            const g = validateGlobalPreferences(obj.global);
            if (Object.keys(g).length > 0) {
                result.global = g;
            }
        }

        return { value: result, status: 'ok', warnings: [] };
    } catch (err) {
        return invalidRead(filePath, 'invalid-json', getErrorMessage(err));
    }
}

/**
 * Read the global preferences file from disk.
 * Returns an empty object when the file doesn't exist or is invalid.
 */
export function readPreferences(dataDir: string): PreferencesFile {
    return readPreferencesWithStatus(dataDir).value;
}

/** Read only the global preferences block from disk. */
export function readGlobalPreferences(dataDir: string): GlobalPreferences {
    return normalizeGlobalPreferencesForRead(readPreferences(dataDir).global ?? {});
}

/**
 * Write the global preferences file to disk atomically (write-then-rename).
 * Creates the data directory if it doesn't exist.
 */
export function writePreferences(dataDir: string, data: PreferencesFile): void {
    fs.mkdirSync(dataDir, { recursive: true });
    const filePath = path.join(dataDir, PREFERENCES_FILE_NAME);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

/**
 * Read per-repo preferences from disk with structured status.
 * Missing files are not warnings. Invalid/corrupt files return an empty value
 * plus a warning so callers can report recovery without changing legacy API
 * responses.
 */
export function readRepoPreferencesWithStatus(
    dataDir: string,
    workspaceId: string,
): PreferencesReadResult<PerRepoPreferences> {
    const filePath = getRepoDataPath(dataDir, workspaceId, PREFERENCES_FILE_NAME);
    try {
        if (!fs.existsSync(filePath)) {
            return { value: {}, status: 'missing', warnings: [] };
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
            return invalidRead(filePath, 'invalid-shape', 'Repo preferences file must contain a JSON object');
        }
        return { value: validatePerRepoPreferences(parsed), status: 'ok', warnings: [] };
    } catch (err) {
        return invalidRead(filePath, 'invalid-json', getErrorMessage(err));
    }
}

/**
 * Read per-repo preferences from disk.
 * Returns an empty object when the file doesn't exist or is invalid.
 */
export function readRepoPreferences(dataDir: string, workspaceId: string): PerRepoPreferences {
    return readRepoPreferencesWithStatus(dataDir, workspaceId).value;
}

/**
 * Resolve the per-repo default model for a given mode.
 *
 * Resolution order (highest -> lowest):
 * 1. Per-mode default from `defaultModels[mode]`.
 * 2. Repo-wide default from `defaultModel`.
 * 3. `undefined` — caller falls through to its own default or CLI default.
 *
 * Callers should check `task.config.model` (explicit model) before calling this.
 */
export function resolveDefaultModel(
    dataDir: string,
    workspaceId: string,
    mode?: DefaultModelMode,
): string | undefined {
    const prefs = readRepoPreferences(dataDir, workspaceId);
    if (mode && prefs.defaultModels?.[mode]) return prefs.defaultModels[mode];
    return prefs.defaultModel || undefined;
}

/**
 * Resolve the effective disabled LLM tools for a workspace.
 * Explicit per-repo preferences win; otherwise defaults depend on the global UI layout mode.
 */
export function readEffectiveDisabledLlmTools(dataDir: string, workspaceId: string): string[] {
    const repoPrefs = readRepoPreferences(dataDir, workspaceId);
    if (repoPrefs.disabledLlmTools !== undefined) {
        return repoPrefs.disabledLlmTools;
    }

    const globalPrefs = readGlobalPreferences(dataDir);
    return getEffectiveDefaultDisabledTools(globalPrefs.uiLayoutMode);
}

/**
 * Write per-repo preferences to disk atomically (write-then-rename).
 * Creates the parent directory if it doesn't exist.
 */
export function writeRepoPreferences(dataDir: string, workspaceId: string, data: PerRepoPreferences): void {
    const preferences = validatePerRepoPreferences(data);
    const filePath = getRepoDataPath(dataDir, workspaceId, PREFERENCES_FILE_NAME);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(preferences, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    emitRepoPreferencesChanged({ workspaceId, preferences });
}

function invalidRead<T extends object>(
    filePath: string,
    kind: PreferencesReadWarning['kind'],
    message: string,
): PreferencesReadResult<T> {
    return {
        value: {} as T,
        status: 'invalid',
        warnings: [{ filePath, kind, message }],
    };
}

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
