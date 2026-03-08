import * as path from 'path';
import * as fs from 'fs/promises';
import { computeRepoId } from './queue-persistence';

export interface TaskRootInfo {
    /** Absolute path to the tasks directory, e.g. /home/user/.coc/repos/a1b2c3d4e5f6g7h8/tasks */
    absolutePath: string;
    /** 16-char hex SHA-256 hash of the resolved rootPath */
    repoId: string;
    /** Value to pass as TasksViewerSettings.folderPath (same as absolutePath since TaskManager accepts absolute paths) */
    relativeFolderPath: string;
}

export interface TaskRootOptions {
    /** CoC data directory, typically ~/.coc */
    dataDir: string;
    /** Repository root path (will be path.resolve'd for hashing) */
    rootPath: string;
}

/**
 * Pure computation — resolves the canonical repo-scoped task root path.
 * Performs no filesystem I/O.
 */
export function resolveTaskRoot(options: TaskRootOptions): TaskRootInfo {
    const repoId = computeRepoId(options.rootPath);
    const absolutePath = path.join(options.dataDir, 'repos', repoId, 'tasks');
    return {
        absolutePath,
        repoId,
        relativeFolderPath: absolutePath,
    };
}

/**
 * Resolves the task root path and ensures the directory exists on disk.
 */
export async function ensureTaskRoot(options: TaskRootOptions): Promise<TaskRootInfo> {
    const info = resolveTaskRoot(options);
    await fs.mkdir(info.absolutePath, { recursive: true });
    return info;
}
