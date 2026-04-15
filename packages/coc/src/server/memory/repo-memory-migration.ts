/**
 * Repo Memory Migration
 *
 * One-time migration from hash-based (`~/.coc/memory/repos/<hash>/`) to
 * workspaceId-based (`~/.coc/repos/<workspaceId>/memory/`) repo-level
 * observation memory. System and git-remote levels are unchanged.
 *
 * Migration steps:
 * 1. Scan `~/.coc/memory/repos/` for existing `<hash>/` directories
 * 2. Reverse-lookup workspaceId via ProcessStore by matching computeRepoHash(ws.rootPath)
 * 3. Copy `raw/*.md`, `consolidated.md`, `index.json` to the new location
 * 4. Skip files that already exist at the destination (no clobber)
 * 5. Write a `.migrated` marker in the old hash directory
 * 6. Does NOT delete old data
 *
 * No VS Code dependencies — pure Node.js.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { computeRepoHash } from '@plusplusoneplusplus/forge';
import { readMemoryConfig } from './memory-config-handler';
import { getRepoDataPath } from '../paths';

export interface MigrationResult {
    /** Number of hash dirs that were migrated. */
    migrated: number;
    /** Number of hash dirs already migrated (had .migrated marker). */
    skippedAlreadyMigrated: number;
    /** Number of hash dirs that could not be matched to a workspaceId. */
    skippedUnmatched: number;
    /** Per-dir details (for logging). */
    details: MigrationDetail[];
}

export interface MigrationDetail {
    hash: string;
    workspaceId?: string;
    status: 'migrated' | 'already_migrated' | 'unmatched';
    filesCopied: number;
}

/**
 * Run the repo-memory migration. Safe to call multiple times — skips
 * already-migrated directories.
 */
export async function migrateRepoMemory(
    dataDir: string,
    store: ProcessStore,
): Promise<MigrationResult> {
    const config = readMemoryConfig(dataDir);
    const reposDir = path.join(config.storageDir, 'repos');

    const result: MigrationResult = {
        migrated: 0,
        skippedAlreadyMigrated: 0,
        skippedUnmatched: 0,
        details: [],
    };

    // Check if the old repos dir exists
    if (!fs.existsSync(reposDir)) {
        return result;
    }

    // List hash directories
    let hashDirs: string[];
    try {
        const entries = await fsp.readdir(reposDir, { withFileTypes: true });
        hashDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
        return result;
    }

    if (hashDirs.length === 0) {
        return result;
    }

    // Build hash → workspaceId lookup
    const workspaces = await store.getWorkspaces();
    const hashToWorkspace = new Map<string, string>();
    for (const ws of workspaces) {
        const hash = computeRepoHash(ws.rootPath);
        hashToWorkspace.set(hash, ws.id);
    }

    for (const hash of hashDirs) {
        const srcDir = path.join(reposDir, hash);
        const markerPath = path.join(srcDir, '.migrated');

        // Skip already migrated
        if (fs.existsSync(markerPath)) {
            result.skippedAlreadyMigrated++;
            result.details.push({ hash, status: 'already_migrated', filesCopied: 0 });
            continue;
        }

        // Reverse-lookup workspaceId
        const workspaceId = hashToWorkspace.get(hash);
        if (!workspaceId) {
            result.skippedUnmatched++;
            result.details.push({ hash, status: 'unmatched', filesCopied: 0 });
            continue;
        }

        // Copy files to new location
        const destDir = getRepoDataPath(dataDir, workspaceId, path.join('memory', 'observations'));
        const filesCopied = await copyMemoryFiles(srcDir, destDir);

        // Write migration marker
        fs.writeFileSync(markerPath, new Date().toISOString(), 'utf-8');

        result.migrated++;
        result.details.push({ hash, workspaceId, status: 'migrated', filesCopied });
    }

    return result;
}

/**
 * Copy memory files from srcDir to destDir without clobbering existing files.
 * Returns the number of files copied.
 */
async function copyMemoryFiles(srcDir: string, destDir: string): Promise<number> {
    let count = 0;

    // Copy consolidated.md
    count += await copyFileNoClobber(
        path.join(srcDir, 'consolidated.md'),
        path.join(destDir, 'consolidated.md'),
    );

    // Copy index.json
    count += await copyFileNoClobber(
        path.join(srcDir, 'index.json'),
        path.join(destDir, 'index.json'),
    );

    // Copy raw/*.md
    const rawSrcDir = path.join(srcDir, 'raw');
    const rawDestDir = path.join(destDir, 'raw');
    try {
        const rawFiles = await fsp.readdir(rawSrcDir);
        for (const file of rawFiles) {
            if (!file.endsWith('.md')) continue;
            count += await copyFileNoClobber(
                path.join(rawSrcDir, file),
                path.join(rawDestDir, file),
            );
        }
    } catch {
        // raw dir may not exist
    }

    return count;
}

/**
 * Copy a single file if the destination does not already exist.
 * Returns 1 if copied, 0 if skipped.
 */
async function copyFileNoClobber(src: string, dest: string): Promise<number> {
    try {
        await fsp.access(src);
    } catch {
        return 0; // source doesn't exist
    }

    try {
        await fsp.access(dest);
        return 0; // dest already exists — no clobber
    } catch {
        // dest doesn't exist — proceed with copy
    }

    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
    return 1;
}

// ============================================================================
// Subfolder migration: memory/ → memory/notes/ + memory/observations/
// ============================================================================

const SEPARATED_MARKER = '.memory-separated';

export interface SubfolderMigrationResult {
    /** Number of repo memory dirs that were migrated. */
    migrated: number;
    /** Number of dirs already separated (had marker). */
    skipped: number;
    /** Per-dir details. */
    details: { workspaceId: string; status: 'migrated' | 'already_separated'; noteFiles: number; observationFiles: number }[];
}

/**
 * Migrate flat `~/.coc/repos/<wsId>/memory/` into `memory/notes/` and `memory/observations/` subfolders.
 * Safe to call multiple times — uses a `.memory-separated` marker for idempotency.
 */
export async function migrateMemoryToSubfolders(dataDir: string): Promise<SubfolderMigrationResult> {
    const reposDir = path.join(dataDir, 'repos');
    const result: SubfolderMigrationResult = { migrated: 0, skipped: 0, details: [] };

    if (!fs.existsSync(reposDir)) return result;

    let wsDirs: string[];
    try {
        const entries = await fsp.readdir(reposDir, { withFileTypes: true });
        wsDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
        return result;
    }

    for (const workspaceId of wsDirs) {
        const memDir = path.join(reposDir, workspaceId, 'memory');
        if (!fs.existsSync(memDir)) continue;

        const markerPath = path.join(memDir, SEPARATED_MARKER);
        if (fs.existsSync(markerPath)) {
            result.skipped++;
            result.details.push({ workspaceId, status: 'already_separated', noteFiles: 0, observationFiles: 0 });
            continue;
        }

        const notesDir = path.join(memDir, 'notes');
        const observationsDir = path.join(memDir, 'observations');
        let noteFiles = 0;
        let observationFiles = 0;

        // Classify and move existing index.json
        const indexPath = path.join(memDir, 'index.json');
        let noteIndex: unknown[] | null = null;
        let obsIndex: Record<string, unknown> | null = null;

        if (fs.existsSync(indexPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
                if (Array.isArray(parsed)) {
                    noteIndex = parsed;
                } else if (parsed && typeof parsed === 'object' && 'lastAggregation' in parsed) {
                    obsIndex = parsed;
                }
            } catch {
                // Corrupted — skip index, each store will recreate
            }
        }

        // Move UUID-named .json files → notes/
        try {
            const entries = await fsp.readdir(memDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
                if (entry.name === 'index.json') continue;
                // UUID pattern: 8-4-4-4-12 hex chars
                if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(entry.name)) {
                    await fsp.mkdir(notesDir, { recursive: true });
                    await fsp.rename(path.join(memDir, entry.name), path.join(notesDir, entry.name));
                    noteFiles++;
                }
            }
        } catch { /* no entries */ }

        // Write notes index
        if (noteIndex !== null) {
            await fsp.mkdir(notesDir, { recursive: true });
            await fsp.writeFile(path.join(notesDir, 'index.json'), JSON.stringify(noteIndex, null, 2), 'utf-8');
            noteFiles++;
        }

        // Move observation files → observations/
        // raw/ directory
        const rawDir = path.join(memDir, 'raw');
        if (fs.existsSync(rawDir)) {
            await fsp.mkdir(observationsDir, { recursive: true });
            await fsp.rename(rawDir, path.join(observationsDir, 'raw'));
            observationFiles++;
        }

        // consolidated.md
        const consolidatedPath = path.join(memDir, 'consolidated.md');
        if (fs.existsSync(consolidatedPath)) {
            await fsp.mkdir(observationsDir, { recursive: true });
            await fsp.rename(consolidatedPath, path.join(observationsDir, 'consolidated.md'));
            observationFiles++;
        }

        // consolidated.prev.md
        const consolidatedPrevPath = path.join(memDir, 'consolidated.prev.md');
        if (fs.existsSync(consolidatedPrevPath)) {
            await fsp.mkdir(observationsDir, { recursive: true });
            await fsp.rename(consolidatedPrevPath, path.join(observationsDir, 'consolidated.prev.md'));
            observationFiles++;
        }

        // Write observation index
        if (obsIndex !== null) {
            await fsp.mkdir(observationsDir, { recursive: true });
            await fsp.writeFile(path.join(observationsDir, 'index.json'), JSON.stringify(obsIndex, null, 2), 'utf-8');
            observationFiles++;
        }

        // Remove old index.json if we moved data from it
        if ((noteIndex !== null || obsIndex !== null) && fs.existsSync(indexPath)) {
            try { fs.unlinkSync(indexPath); } catch { /* ignore */ }
        }

        // Write marker
        fs.writeFileSync(markerPath, new Date().toISOString(), 'utf-8');

        result.migrated++;
        result.details.push({ workspaceId, status: 'migrated', noteFiles, observationFiles });
    }

    return result;
}

// ============================================================================
// Directory rename migration: pipeline/ → observations/
// ============================================================================

/**
 * Rename existing `memory/pipeline/` directories to `memory/observations/` for
 * all repos. Safe to call multiple times — skips repos that already have an
 * `observations/` directory or don't have a `pipeline/` directory.
 */
export async function migrateObservationsDir(dataDir: string): Promise<{ renamed: number }> {
    const reposDir = path.join(dataDir, 'repos');
    let renamed = 0;

    if (!fs.existsSync(reposDir)) return { renamed };

    let wsDirs: string[];
    try {
        const entries = await fsp.readdir(reposDir, { withFileTypes: true });
        wsDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
        return { renamed };
    }

    for (const workspaceId of wsDirs) {
        const pipelineDir = path.join(reposDir, workspaceId, 'memory', 'pipeline');
        const observationsDir = path.join(reposDir, workspaceId, 'memory', 'observations');

        if (!fs.existsSync(pipelineDir)) continue;
        if (fs.existsSync(observationsDir)) continue;

        try {
            await fsp.rename(pipelineDir, observationsDir);
            renamed++;
        } catch {
            // Non-fatal — will be tried again next startup
        }
    }

    return { renamed };
}
