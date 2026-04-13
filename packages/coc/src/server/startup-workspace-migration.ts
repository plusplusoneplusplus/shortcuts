/**
 * Startup Workspace Registry Migration
 *
 * Automatically migrates workspace and wiki registry entries from legacy
 * JSON files (workspaces.json, wikis.json) into the SQLite process store
 * on server startup. This covers the upgrade path where someone pulls
 * new code (with SQLite default) without running the full admin migration.
 *
 * The migration is:
 * - Idempotent (INSERT OR REPLACE in SQLite)
 * - Non-destructive (renames files to *.migrated, not deleted)
 * - A no-op for file-based backends or fresh installs
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, WorkspaceInfo, WikiInfo } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';

const PREFIX = '[WorkspaceMigration]';

export interface MigrationResult {
    migrated: boolean;
    workspaceCount: number;
    wikiCount: number;
}

function readJsonFileSafe<T>(filePath: string): T | undefined {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as T;
    } catch {
        return undefined;
    }
}

function renameToMigrated(filePath: string): void {
    try {
        fs.renameSync(filePath, filePath + '.migrated');
    } catch (err) {
        process.stderr.write(
            `${PREFIX} Warning: could not rename ${path.basename(filePath)} → ${path.basename(filePath)}.migrated: ${(err as Error)?.message ?? err}\n`,
        );
    }
}

/**
 * Detect and migrate workspace/wiki registries from legacy JSON files
 * into the SQLite process store. Safe to call on every startup.
 */
export async function migrateWorkspaceRegistryIfNeeded(
    dataDir: string,
    store: ProcessStore,
): Promise<MigrationResult> {
    const noOp: MigrationResult = { migrated: false, workspaceCount: 0, wikiCount: 0 };

    // Only migrate when using SQLite backend
    if (!(store instanceof SqliteProcessStore)) {
        return noOp;
    }

    const workspacesPath = path.join(dataDir, 'workspaces.json');
    if (!fs.existsSync(workspacesPath)) {
        return noOp;
    }

    process.stderr.write(`${PREFIX} Detected legacy workspaces.json — migrating to SQLite…\n`);

    // --- Migrate workspaces ---
    let workspaceCount = 0;
    const workspaces = readJsonFileSafe<WorkspaceInfo[]>(workspacesPath);
    if (workspaces && Array.isArray(workspaces)) {
        for (const ws of workspaces) {
            await store.registerWorkspace(ws);
        }
        workspaceCount = workspaces.length;
        process.stderr.write(`${PREFIX} Migrated ${workspaceCount} workspace(s)\n`);
    } else {
        process.stderr.write(`${PREFIX} Warning: workspaces.json is malformed — skipping workspace migration\n`);
    }
    renameToMigrated(workspacesPath);

    // --- Migrate wikis (independent of workspace migration) ---
    let wikiCount = 0;
    const wikisPath = path.join(dataDir, 'wikis.json');
    if (fs.existsSync(wikisPath)) {
        const wikis = readJsonFileSafe<WikiInfo[]>(wikisPath);
        if (wikis && Array.isArray(wikis)) {
            for (const wiki of wikis) {
                await store.registerWiki(wiki);
            }
            wikiCount = wikis.length;
            process.stderr.write(`${PREFIX} Migrated ${wikiCount} wiki(s)\n`);
        } else {
            process.stderr.write(`${PREFIX} Warning: wikis.json is malformed — skipping wiki migration\n`);
        }
        renameToMigrated(wikisPath);
    }

    process.stderr.write(`${PREFIX} Migration complete\n`);

    return { migrated: true, workspaceCount, wikiCount };
}
