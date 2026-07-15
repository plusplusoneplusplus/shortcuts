/**
 * Preferences snapshot domain.
 *
 * Owns export/import/wipe for the global preferences file (`preferences.json`
 * at the data-dir root) and per-repo preference files
 * (`<dataDir>/repos/<repoId>/preferences.json`).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RepoPreferencesSnapshot } from '../export-import-types';
import {
    PREFERENCES_FILE_NAME,
    type PreferencesFile,
    readRepoPreferences,
    writePreferences,
    writeRepoPreferences,
} from '../../preferences/repository';
import type { GlobalPreferences } from '../../preferences/schema';
import { validatePerRepoPreferences } from '../../preferences/schema';
import { applyRepoPreferencesPatch } from '../../preferences/merge-policy';
import type { StorageSnapshotDomain } from './types';
import {
    getErrorMessage,
    isPlainRecord,
    listRepoDirs,
    listRepoFiles,
    readJsonFile,
    readRepoRootPathFromQueueFile,
    skippedWarning,
} from './snapshot-fs';

export function createPreferencesDomain(): StorageSnapshotDomain<{
    repoPreferenceFiles: string[];
    globalPreferenceFile?: string;
}> {
    return {
        id: 'preferences',
        collect(ctx) {
            const { preferences, warnings: globalWarnings } = readGlobalPreferencesSnapshot(ctx.dataDir);
            const repoResult = readRepoPreferenceSnapshots(ctx.dataDir);

            return {
                data: {
                    preferences,
                    repoPreferences: repoResult.snapshots,
                },
                metadata: { repoPreferenceCount: repoResult.snapshots.length },
                warnings: [...globalWarnings, ...repoResult.warnings],
            };
        },
        restoreReplace(payload, ctx, result) {
            if (payload.repoPreferences) {
                result.importedRepoPreferenceFiles = writeRepoPreferenceSnapshots(ctx.dataDir, payload.repoPreferences, result.errors);
            }
            writeGlobalPreferencesSnapshot(ctx.dataDir, payload.preferences, result.errors);
        },
        restoreMerge(payload, ctx, result) {
            if (payload.repoPreferences) {
                result.importedRepoPreferenceFiles = mergeRepoPreferenceSnapshots(ctx.dataDir, payload.repoPreferences, result.errors);
            }
            mergeGlobalPreferencesSnapshot(ctx.dataDir, payload.preferences, result.errors);
        },
        planWipe(ctx) {
            const repoPreferenceFiles = listRepoFiles(ctx.dataDir, PREFERENCES_FILE_NAME);
            const globalPreferenceFile = path.join(ctx.dataDir, PREFERENCES_FILE_NAME);
            const hasGlobalPreferences = fs.existsSync(globalPreferenceFile);

            return {
                plan: {
                    repoPreferenceFiles,
                    globalPreferenceFile: hasGlobalPreferences ? globalPreferenceFile : undefined,
                },
                counts: {
                    deletedRepoPreferences: repoPreferenceFiles.length,
                    deletedPreferences: hasGlobalPreferences || repoPreferenceFiles.length > 0,
                },
                errors: [],
            };
        },
        executeWipe(_ctx, plan, result) {
            for (const filePath of plan?.repoPreferenceFiles ?? []) {
                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    result.errors.push(`Failed to delete repo preferences ${filePath}: ${getErrorMessage(err)}`);
                }
            }

            if (!plan?.globalPreferenceFile) { return; }
            try {
                fs.unlinkSync(plan.globalPreferenceFile);
            } catch (err) {
                result.errors.push(`Failed to delete preferences: ${getErrorMessage(err)}`);
            }
        },
    };
}

/**
 * Build a {@link PreferencesFile} from a raw global preferences block.
 *
 * Snapshot restore round-trips the global block verbatim — including any keys
 * not in the current schema — so this preserves the raw record rather than
 * validating-and-stripping it. Non-record inputs yield an empty file.
 */
function toGlobalPreferencesFile(global: unknown): PreferencesFile {
    return isPlainRecord(global) ? { global: global as GlobalPreferences } : {};
}

function readGlobalPreferencesSnapshot(dataDir: string): { preferences: Record<string, unknown>; warnings: string[] } {
    const prefFile = path.join(dataDir, PREFERENCES_FILE_NAME);
    if (!fs.existsSync(prefFile)) {
        return { preferences: {}, warnings: [] };
    }

    const parsed = readJsonFile<Record<string, unknown>>(prefFile);
    if (!parsed.ok) {
        return { preferences: {}, warnings: [skippedWarning('global preferences file', prefFile, parsed.error)] };
    }

    return {
        preferences: parsed.value.global !== undefined ? { global: parsed.value.global } : {},
        warnings: [],
    };
}

function writeGlobalPreferencesSnapshot(dataDir: string, preferences: Record<string, unknown>, errors: string[]): void {
    try {
        writePreferences(dataDir, toGlobalPreferencesFile(preferences.global));
    } catch (err) {
        errors.push(`Failed to write preferences: ${getErrorMessage(err)}`);
    }
}

function mergeGlobalPreferencesSnapshot(dataDir: string, preferences: Record<string, unknown>, errors: string[]): void {
    try {
        if (isPlainRecord(preferences.global)) {
            const existingGlobal = readRawGlobalPreferences(dataDir);
            writePreferences(dataDir, toGlobalPreferencesFile({
                ...existingGlobal,
                ...preferences.global,
            }));
        }
    } catch (err) {
        errors.push(`Failed to merge preferences: ${getErrorMessage(err)}`);
    }
}

function readRawGlobalPreferences(dataDir: string): Record<string, unknown> {
    const prefFile = path.join(dataDir, PREFERENCES_FILE_NAME);
    if (!fs.existsSync(prefFile)) {
        return {};
    }

    const parsed = readJsonFile<Record<string, unknown>>(prefFile);
    if (!parsed.ok || !isPlainRecord(parsed.value.global)) {
        return {};
    }
    return parsed.value.global;
}

function readRepoPreferenceSnapshots(dataDir: string): { snapshots: RepoPreferencesSnapshot[]; warnings: string[] } {
    const snapshots: RepoPreferencesSnapshot[] = [];
    const warnings: string[] = [];

    for (const repo of listRepoDirs(dataDir)) {
        const filePath = path.join(repo.dir, PREFERENCES_FILE_NAME);
        if (!fs.existsSync(filePath)) { continue; }

        const parsed = readJsonFile<unknown>(filePath);
        if (!parsed.ok) {
            warnings.push(skippedWarning('repo preferences file', filePath, parsed.error));
            continue;
        }

        snapshots.push({
            repoId: repo.repoId,
            repoRootPath: readRepoRootPathFromQueueFile(repo.dir),
            preferences: validatePerRepoPreferences(parsed.value) as Record<string, unknown>,
        });
    }

    return { snapshots, warnings };
}

function writeRepoPreferenceSnapshots(dataDir: string, snapshots: RepoPreferencesSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoId) { continue; }
        try {
            writeRepoPreferences(dataDir, snap.repoId, validatePerRepoPreferences(snap.preferences));
            written++;
        } catch (err) {
            errors.push(`Failed to write repo preferences for ${snap.repoId}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}

function mergeRepoPreferenceSnapshots(dataDir: string, snapshots: RepoPreferencesSnapshot[], errors: string[]): number {
    let written = 0;
    for (const snap of snapshots) {
        if (!snap.repoId) { continue; }
        try {
            const existing = readRepoPreferences(dataDir, snap.repoId);
            const { preferences: merged } = applyRepoPreferencesPatch(existing, snap.preferences);
            writeRepoPreferences(dataDir, snap.repoId, merged);
            written++;
        } catch (err) {
            errors.push(`Failed to merge repo preferences for ${snap.repoId}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}
