/**
 * Repo Memory Migration
 *
 * One-time migration from hash-based (`~/.coc/memory/repos/<hash>/`) to
 * workspaceId-based (`~/.coc/repos/<workspaceId>/memory/`) repo-level
 * pipeline memory. System and git-remote levels are unchanged.
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
        const destDir = getRepoDataPath(dataDir, workspaceId, 'memory');
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
