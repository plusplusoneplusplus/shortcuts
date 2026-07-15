import * as path from 'path';
import * as fs from 'fs';

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

export type ExistingTaskRootSource = 'primary' | 'legacy' | 'configured';

export interface ExistingTaskRoot {
    /** Canonical absolute directory path after resolving symlinks. */
    absolutePath: string;
    /** User-facing Notes collection label. */
    label: string;
    /** Source used to derive this root. */
    source: ExistingTaskRootSource;
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
    await fs.promises.mkdir(info.absolutePath, { recursive: true });
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

/**
 * Produce a comparison key for a canonical filesystem path. Windows path
 * comparison is case-insensitive; POSIX comparison preserves case. realpath
 * already collapses case aliases on case-insensitive macOS volumes.
 */
export function taskRootPathComparisonKey(
    canonicalPath: string,
    platform: NodeJS.Platform = process.platform,
): string {
    const normalized = path.normalize(canonicalPath);
    return platform === 'win32'
        ? normalized.toLocaleLowerCase('en-US')
        : normalized;
}

/**
 * Resolve task roots that currently exist as directories. Candidates are
 * ordered by label priority so the primary and legacy labels win when task
 * settings reach the same directory through another path.
 */
export function resolveExistingTaskRoots(
    options: TaskRootOptions,
    additionalPaths: string[],
): ExistingTaskRoot[] {
    const primary = resolveTaskRoot(options);
    const candidates: Array<{ absolutePath: string; label: string; source: ExistingTaskRootSource }> = [
        { absolutePath: primary.absolutePath, label: 'Task Plans', source: 'primary' },
        {
            absolutePath: path.resolve(options.rootPath, '.vscode', 'tasks'),
            label: 'Legacy Plans (.vscode/tasks)',
            source: 'legacy',
        },
        ...additionalPaths.map(configuredPath => ({
            absolutePath: path.isAbsolute(configuredPath)
                ? path.resolve(configuredPath)
                : path.resolve(options.rootPath, configuredPath),
            label: configuredPath,
            source: 'configured' as const,
        })),
    ];

    const seen = new Set<string>();
    const roots: ExistingTaskRoot[] = [];
    for (const candidate of candidates) {
        try {
            if (!fs.statSync(candidate.absolutePath).isDirectory()) continue;
            const canonicalPath = fs.realpathSync.native(candidate.absolutePath);
            const comparisonKey = taskRootPathComparisonKey(canonicalPath);
            if (seen.has(comparisonKey)) continue;
            seen.add(comparisonKey);
            roots.push({
                absolutePath: canonicalPath,
                label: candidate.label,
                source: candidate.source,
            });
        } catch {
            // Missing or inaccessible task directories are not Notes collections.
        }
    }
    return roots;
}
