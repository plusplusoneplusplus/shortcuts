import * as path from 'path';
import * as fs from 'fs/promises';

export interface TaskRootInfo {
    /** Absolute path to the tasks directory, e.g. /home/user/.coc/repos/ws-kss6a7/tasks */
    absolutePath: string;
    /** Workspace ID used as the repo identifier, e.g. "ws-kss6a7" */
    repoId: string;
    /** Value to pass as TasksViewerSettings.folderPath (same as absolutePath since TaskManager accepts absolute paths) */
    relativeFolderPath: string;
}

export interface TaskRootOptions {
    /** CoC data directory, typically ~/.coc */
    dataDir: string;
    /** Repository root path */
    rootPath: string;
    /** Workspace ID, e.g. "ws-kss6a7" */
    workspaceId: string;
}

/**
 * Pure computation — resolves the canonical repo-scoped task root path.
 * Performs no filesystem I/O.
 */
export function resolveTaskRoot(options: TaskRootOptions): TaskRootInfo {
    const repoId = options.workspaceId;
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

/**
 * Build a human-readable label for a task root by including the parent directory
 * name so that roots sharing the same basename (e.g. "tasks") are distinguishable.
 */
export function buildRootLabel(p: string): string {
    return path.join(path.basename(path.dirname(p)), path.basename(p));
}

/**
 * Resolve all task roots: the primary repo-scoped root plus any additional paths.
 * Returns an array of { absolutePath, label } for each valid root.
 */
export function resolveAllTaskRoots(
    options: TaskRootOptions,
    additionalPaths: string[],
): { absolutePath: string; label: string }[] {
    const primary = resolveTaskRoot(options);
    const roots: { absolutePath: string; label: string }[] = [
        { absolutePath: primary.absolutePath, label: buildRootLabel(primary.absolutePath) },
    ];
    for (const p of additionalPaths) {
        const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(options.rootPath, p);
        roots.push({ absolutePath: abs, label: buildRootLabel(abs) });
    }
    return roots;
}
