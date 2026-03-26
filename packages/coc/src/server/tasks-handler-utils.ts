/**
 * Tasks REST API Handler — shared helpers and constants.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { scanDocumentsRecursively, scanFoldersRecursively, groupTaskDocuments, isWithinDirectory } from '@plusplusoneplusplus/forge';
import type { TasksViewerSettings, TaskFolder } from '@plusplusoneplusplus/forge';

/**
 * Directories outside the workspace that are trusted for **read-only** access.
 * Writes to these directories are always denied.
 */
export const TRUSTED_READ_ONLY_DIRS: string[] = [
    path.join(os.homedir(), '.copilot'),
];

/** Return true when `target` is inside any of the trusted read-only directories or the server data directory. */
export function isWithinTrustedReadOnlyDir(target: string, dataDir?: string): boolean {
    return (
        TRUSTED_READ_ONLY_DIRS.some(dir => isWithinDirectory(target, dir)) ||
        !!(dataDir && isWithinDirectory(target, dataDir))
    );
}

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_SETTINGS: TasksViewerSettings = {
    enabled: true,
    folderPath: '.vscode/tasks',
    showArchived: false,
    showFuture: false,
    sortBy: 'name',
    groupRelatedDocuments: true,
    discovery: {
        enabled: false,
        defaultScope: {
            includeSourceFiles: true,
            includeDocs: true,
            includeConfigFiles: false,
            includeGitHistory: false,
            maxCommits: 50,
        },
        showRelatedInTree: true,
        groupByCategory: true,
    },
};

// ============================================================================
// Archive Folder Helper
// ============================================================================

/**
 * Build a TaskFolder node for the archive/ subfolder so it appears
 * as a navigable folder in the SPA's Miller columns.
 * Files inside get relativePath prefixed with 'archive/'.
 */
export function buildArchiveFolderNode(archiveDir: string): TaskFolder {
    const docs = scanDocumentsRecursively(archiveDir, 'archive', true);
    const { groups, singles } = groupTaskDocuments(docs);

    const archiveNode: TaskFolder = {
        name: 'archive',
        folderPath: archiveDir,
        relativePath: 'archive',
        isArchived: true,
        children: [],
        tasks: [],
        documentGroups: groups,
        singleDocuments: singles,
    };

    // Scan sub-folders inside archive
    const folderMap = new Map<string, TaskFolder>();
    folderMap.set('archive', archiveNode);
    scanFoldersRecursively(archiveDir, 'archive', true, folderMap, archiveNode);

    return archiveNode;
}

// ============================================================================
// Path Security Helper
// ============================================================================

/**
 * Resolve a user-supplied path against a tasks folder and validate
 * that the result is inside (or equal to) the tasks folder.
 * Returns the resolved absolute path, or null if the check fails.
 */
export function resolveAndValidatePath(tasksFolder: string, userPath: string): string | null {
    const resolved = path.resolve(tasksFolder, userPath);
    if (isWithinDirectory(resolved, tasksFolder)) {
        return resolved;
    }
    return null;
}

/**
 * Recursively copy a file or directory from `src` to `dest`.
 * Used as a fallback for cross-device moves (EXDEV).
 */
export async function copyRecursive(src: string, dest: string): Promise<void> {
    const stat = await fs.promises.stat(src);
    if (stat.isDirectory()) {
        await fs.promises.mkdir(dest, { recursive: true });
        for (const entry of await fs.promises.readdir(src)) {
            await copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
    } else {
        await fs.promises.copyFile(src, dest);
    }
}
