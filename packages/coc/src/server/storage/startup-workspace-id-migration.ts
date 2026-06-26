/**
 * Startup Machine-Scoped Workspace-ID Migration
 *
 * Re-keys legacy path-only physical workspace IDs (`ws-<base36hash>`) to the
 * machine-scoped scheme (`ws-v2-<hash>` over raw OS hostname + normalized root
 * path). This lets the dashboard tell two machines that registered the same
 * repository at the same absolute path apart, instead of collapsing them into
 * one entry.
 *
 * For each legacy physical workspace the migration:
 *   1. computes the new id from the raw hostname + the workspace root path,
 *   2. moves the repo-scoped data directory `repos/<oldId>/` → `repos/<newId>/`
 *      (this carries git-ops/paste-context/preferences and, for the file-backed
 *      store, the process history too) when the source exists and the target
 *      does not, and
 *   3. asks the store to re-key its records via {@link ProcessStore.renameWorkspaceId}.
 *
 * The migration is:
 * - Conflict-safe: it never overwrites an existing target workspace or data
 *   directory; conflicts are logged and the legacy workspace is left untouched.
 * - Crash-resilient: the directory is moved before the records are re-keyed, and
 *   the legacy workspace record drives re-migration, so an interrupted run is
 *   completed on the next startup.
 * - Idempotent: already-migrated (`ws-v2-`) and virtual workspaces are skipped.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { computeWorkspaceId, isLegacyPhysicalWorkspaceId } from '@plusplusoneplusplus/forge';

const PREFIX = '[WorkspaceIdMigration]';

export interface WorkspaceIdMigrationResult {
    /** Number of workspaces successfully re-keyed to the v2 scheme. */
    migrated: number;
    /** Successful renames, in application order. */
    renames: Array<{ oldId: string; newId: string }>;
    /** Workspaces left untouched because re-keying them was unsafe. */
    conflicts: Array<{ oldId: string; newId: string; reason: string }>;
}

function log(message: string): void {
    process.stderr.write(`${PREFIX} ${message}\n`);
}

/**
 * Detect and migrate legacy path-only physical workspace IDs to the
 * machine-scoped `ws-v2-` scheme. Safe to call on every startup; a no-op once
 * every physical workspace is already on the v2 scheme.
 *
 * @param dataDir CoC data directory (the parent of `repos/`).
 * @param store Active process store whose workspace records are re-keyed.
 * @param rawHostname Raw OS hostname (`os.hostname()`) — NOT a shortened or
 *   configured display name.
 */
export async function migrateWorkspaceIdsToV2IfNeeded(
    dataDir: string,
    store: ProcessStore,
    rawHostname: string,
): Promise<WorkspaceIdMigrationResult> {
    const result: WorkspaceIdMigrationResult = { migrated: 0, renames: [], conflicts: [] };

    const workspaces = await store.getWorkspaces();
    // Track which ids are taken so two legacy workspaces can never collapse onto
    // the same new id (and so we honor ids claimed earlier in this same run).
    const takenIds = new Set(workspaces.map(w => w.id));
    const reposRoot = path.join(dataDir, 'repos');

    for (const ws of workspaces) {
        // Only physical repository workspaces are machine-scoped. Virtual/system
        // workspaces (My Work, My Life, Global) keep their fixed ids, and
        // already-migrated v2 ids are not legacy.
        if (ws.virtual || !isLegacyPhysicalWorkspaceId(ws.id)) {
            continue;
        }
        const oldId = ws.id;
        const newId = computeWorkspaceId(rawHostname, ws.rootPath);
        if (newId === oldId) {
            continue;
        }

        const oldDir = path.join(reposRoot, oldId);
        const newDir = path.join(reposRoot, newId);

        // Conflict: another workspace already owns the target id.
        if (takenIds.has(newId)) {
            const reason = 'target-workspace-exists';
            log(`Skipping ${oldId} → ${newId}: ${reason}`);
            result.conflicts.push({ oldId, newId, reason });
            continue;
        }
        // Conflict: both source and target data directories hold data — never
        // merge or overwrite.
        if (fs.existsSync(oldDir) && fs.existsSync(newDir)) {
            const reason = 'target-data-dir-exists';
            log(`Skipping ${oldId} → ${newId}: ${reason}`);
            result.conflicts.push({ oldId, newId, reason });
            continue;
        }

        let movedDataDir = false;
        try {
            if (typeof store.renameWorkspaceId !== 'function') {
                const reason = 'store-rename-unavailable';
                log(`Skipping ${oldId} → ${newId}: ${reason}`);
                result.conflicts.push({ oldId, newId, reason });
                continue;
            }

            // Move the repo-scoped data directory first so an interrupted run is
            // re-driven by the still-legacy workspace record on next startup.
            if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
                fs.mkdirSync(reposRoot, { recursive: true });
                fs.renameSync(oldDir, newDir);
                movedDataDir = true;
            }

            const renamed = await store.renameWorkspaceId(oldId, newId);
            if (!renamed) {
                const reason = 'store-rename-rejected';
                if (movedDataDir && !fs.existsSync(oldDir) && fs.existsSync(newDir)) {
                    fs.renameSync(newDir, oldDir);
                }
                log(`Skipping ${oldId} → ${newId}: ${reason}`);
                result.conflicts.push({ oldId, newId, reason });
                continue;
            }

            takenIds.delete(oldId);
            takenIds.add(newId);
            result.migrated += 1;
            result.renames.push({ oldId, newId });
            log(`Migrated workspace ${oldId} → ${newId}`);
        } catch (err) {
            if (movedDataDir && !fs.existsSync(oldDir) && fs.existsSync(newDir)) {
                try {
                    fs.renameSync(newDir, oldDir);
                } catch (rollbackErr) {
                    log(`Failed to roll back data directory ${newId} → ${oldId}: ${(rollbackErr as Error)?.message ?? rollbackErr}`);
                }
            }
            const reason = `error: ${(err as Error)?.message ?? err}`;
            log(`Failed to migrate ${oldId} → ${newId}: ${reason}`);
            result.conflicts.push({ oldId, newId, reason });
        }
    }

    if (result.migrated > 0) {
        log(`Migration complete — ${result.migrated} workspace(s) re-keyed to the machine-scoped scheme`);
    }

    return result;
}
