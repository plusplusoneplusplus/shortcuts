/**
 * Task Migration Utility
 *
 * One-time migration that copies task files from the legacy `.vscode/tasks/`
 * location to the new `~/.coc/repos/<repoId>/tasks/` directory.
 * Also remaps comment file hashes from old-prefix to new-prefix paths.
 *
 * Uses the same one-time copy-and-remap pattern as other server data migrations.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface MigrationResult {
    migrated: boolean;
    fileCount: number;
    sourcePath: string;
    targetPath: string;
    commentsMigrated: number;
    errors: string[];
    skippedReason?: string;
}

export interface MigrationOptions {
    workspaceRoot: string;
    workspaceId: string;
    dataDir: string;
    dryRun?: boolean;
    force?: boolean;
}

/**
 * Check whether migration is needed for a given workspace.
 * Returns true if the legacy `.vscode/tasks` directory exists and the
 * repo-scoped target does NOT yet contain files (or has no `.migrated-from` marker).
 */
export function isMigrationNeeded(workspaceRoot: string, workspaceId: string, dataDir: string): boolean {
    const sourcePath = path.join(workspaceRoot, '.vscode', 'tasks');
    if (!fs.existsSync(sourcePath)) {
        return false;
    }
    const targetPath = path.join(dataDir, 'repos', workspaceId, 'tasks');
    if (fs.existsSync(path.join(targetPath, '.migrated-from'))) {
        return false;
    }
    // If target has any files already, consider it migrated unless force is used
    if (fs.existsSync(targetPath) && fs.readdirSync(targetPath).length > 0) {
        return false;
    }
    return true;
}

/**
 * Recursively list all files under a directory, returning paths relative to the base.
 */
function listFilesRecursive(dir: string, base: string = dir): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...listFilesRecursive(fullPath, base));
        } else if (entry.isFile()) {
            results.push(path.relative(base, fullPath));
        }
    }
    return results;
}

/**
 * Migrate task files from `.vscode/tasks/` to the repo-scoped directory.
 * Copies files (does NOT delete originals). Writes a `.migrated-from` marker.
 */
export async function migrateTasksToRepoScoped(options: MigrationOptions): Promise<MigrationResult> {
    const { workspaceRoot, workspaceId, dataDir, dryRun = false, force = false } = options;
    const sourcePath = path.join(workspaceRoot, '.vscode', 'tasks');
    const targetPath = path.join(dataDir, 'repos', workspaceId, 'tasks');

    const result: MigrationResult = {
        migrated: false,
        fileCount: 0,
        sourcePath,
        targetPath,
        commentsMigrated: 0,
        errors: [],
    };

    // Guard: source doesn't exist
    if (!fs.existsSync(sourcePath)) {
        result.skippedReason = 'no-source';
        return result;
    }

    // Guard: target already has files (unless force)
    if (!force && fs.existsSync(targetPath) && fs.readdirSync(targetPath).length > 0) {
        result.skippedReason = 'already-migrated';
        return result;
    }

    // List all files to copy
    const files = listFilesRecursive(sourcePath);
    result.fileCount = files.length;

    if (dryRun) {
        result.migrated = true;
        return result;
    }

    // Copy each file, preserving directory structure
    for (const relFile of files) {
        try {
            const src = path.join(sourcePath, relFile);
            const dest = path.join(targetPath, relFile);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
        } catch (err) {
            result.errors.push(`${relFile}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // Write .migrated-from marker
    try {
        fs.mkdirSync(targetPath, { recursive: true });
        fs.writeFileSync(
            path.join(targetPath, '.migrated-from'),
            JSON.stringify({
                source: sourcePath,
                timestamp: new Date().toISOString(),
                fileCount: files.length,
            }, null, 2),
        );
    } catch (err) {
        result.errors.push(`.migrated-from: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Migrate comment hashes
    try {
        const commentResult = await migrateCommentHashes({
            dataDir,
            workspaceId,
            oldPrefix: '.vscode/tasks',
            newPrefix: '',
            dryRun: false,
        });
        result.commentsMigrated = commentResult.remapped;
        result.errors.push(...commentResult.errors);
    } catch (err) {
        result.errors.push(`comments: ${err instanceof Error ? err.message : String(err)}`);
    }

    result.migrated = true;
    return result;
}

/**
 * Remap comment file hashes from old-prefix paths to new-prefix paths.
 *
 * Comment files are stored as `sha256(filePath).json`. After migration,
 * `filePath` changes from e.g. `.vscode/tasks/feature/plan.md` to `feature/plan.md`.
 */
export async function migrateCommentHashes(options: {
    dataDir: string;
    workspaceId: string;
    oldPrefix: string;
    newPrefix: string;
    dryRun?: boolean;
}): Promise<{ remapped: number; errors: string[] }> {
    const { dataDir, workspaceId, oldPrefix, dryRun = false } = options;
    const commentsDir = path.join(dataDir, 'tasks-comments', workspaceId);
    const result = { remapped: 0, errors: [] as string[] };

    if (!fs.existsSync(commentsDir)) {
        return result;
    }

    const files = fs.readdirSync(commentsDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
        try {
            const filePath = path.join(commentsDir, file);
            const raw = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(raw);

            // Storage format: { comments: TaskComment[], settings?: ... }
            // Each comment has a `filePath` field
            const comments: any[] = Array.isArray(data.comments) ? data.comments : [];
            let needsUpdate = false;

            for (const comment of comments) {
                if (comment.filePath && comment.filePath.startsWith(oldPrefix + '/')) {
                    const newFilePath = comment.filePath.slice(oldPrefix.length + 1);
                    comment.filePath = newFilePath;
                    needsUpdate = true;
                }
            }

            if (!needsUpdate) continue;

            // Compute new hash from the updated filePath
            const newFilePath = comments[0]?.filePath;
            if (!newFilePath) continue;

            const newHash = crypto.createHash('sha256').update(newFilePath).digest('hex');
            const newFileName = `${newHash}.json`;

            if (!dryRun) {
                // Write updated data to new file
                fs.writeFileSync(path.join(commentsDir, newFileName), JSON.stringify(data, null, 2));
                // Remove old file if different name
                if (file !== newFileName) {
                    fs.unlinkSync(filePath);
                }
            }

            result.remapped++;
        } catch (err) {
            result.errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    return result;
}
