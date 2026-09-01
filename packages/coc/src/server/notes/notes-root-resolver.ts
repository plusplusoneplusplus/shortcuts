/**
 * Centralizes notes root resolution logic for multi-root support.
 * The "default" root is the managed `~/.coc/repos/<workspaceId>/notes/` directory.
 * Additional roots are subfolders inside the workspace git repository.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';
import { resolveExistingTaskRoots, taskRootPathComparisonKey } from '../tasks/task-root-resolver';
import { readTasksSettingsSync } from '../tasks/tasks-handler-utils';

/** Maximum number of additional notes roots per workspace. */
export const MAX_ADDITIONAL_NOTES_ROOTS = 10;

/** Sentinel value representing the default managed notes root. */
export const DEFAULT_ROOT_ID = 'default';

/** Prefix for opaque roots derived from the workspace's task settings. */
export const TASK_DERIVED_ROOT_ID_PREFIX = 'task:';

export interface TaskDerivedNotesRoot {
    /** Opaque root identity accepted by Notes file operations. */
    rootId: string;
    /** Canonical absolute directory path. */
    absolutePath: string;
    /** Display label derived from the task-root source. */
    label: string;
}

export interface ResolvedNotesRoot {
    /** Absolute path to the notes root directory. */
    absolutePath: string;
    /** Whether this is the default managed root (under ~/.coc). */
    isDefault: boolean;
    /** Whether this root is a protected collection derived from task settings. */
    isTaskDerived?: boolean;
    /** The root identifier: 'default' for the managed root, or the relative path for repo-folder roots. */
    rootId: string;
}

function taskDerivedRootId(workspaceId: string, canonicalPath: string): string {
    const identity = `${workspaceId}\0${taskRootPathComparisonKey(canonicalPath)}`;
    const hash = crypto.createHash('sha256').update(identity).digest('hex');
    return `${TASK_DERIVED_ROOT_ID_PREFIX}${hash}`;
}

/**
 * Discover existing task folders for one workspace and expose stable opaque
 * identities. Client-supplied paths are never decoded or treated as authority.
 */
export function discoverTaskDerivedNotesRoots(
    dataDir: string,
    workspaceId: string,
    workspaceRoot: string | undefined,
): TaskDerivedNotesRoot[] {
    if (!workspaceRoot) return [];
    const settings = readTasksSettingsSync(dataDir, workspaceId);
    return resolveExistingTaskRoots(
        { dataDir, rootPath: workspaceRoot, workspaceId },
        settings.folderPaths,
    ).map(root => ({
        rootId: taskDerivedRootId(workspaceId, root.absolutePath),
        absolutePath: root.absolutePath,
        label: root.label,
    }));
}

/** Return the canonical path for an existing directory, or undefined. */
export function canonicalizeExistingNotesDirectory(directoryPath: string): string | undefined {
    try {
        if (!fs.statSync(directoryPath).isDirectory()) return undefined;
        return fs.realpathSync.native(directoryPath);
    } catch {
        return undefined;
    }
}

/**
 * Resolve the notes root for a given workspace.
 *
 * @param dataDir - The CoC data directory (~/.coc)
 * @param workspaceRoot - Absolute path to the workspace git root
 * @param rootParam - The `root` query parameter value (undefined or 'default' = default root)
 * @param additionalRoots - The configured additional roots from preferences
 * @returns The resolved root info, or an error string if invalid
 */
export function resolveNotesRoot(
    dataDir: string,
    workspaceId: string,
    workspaceRoot: string | undefined,
    rootParam: string | undefined,
    additionalRoots: string[] | undefined,
): ResolvedNotesRoot | { error: string; statusCode: number } {
    // Default root
    if (!rootParam || rootParam === DEFAULT_ROOT_ID) {
        return {
            absolutePath: getRepoDataPath(dataDir, workspaceId, 'notes'),
            isDefault: true,
            isTaskDerived: false,
            rootId: DEFAULT_ROOT_ID,
        };
    }

    // Normalize the requested root
    const normalized = rootParam.replace(/\\/g, '/').replace(/\/+$/, '');

    // Task-derived identities are opaque. Recompute the workspace's currently
    // valid roots and accept only an exact identity returned by discovery.
    const taskRoots = discoverTaskDerivedNotesRoots(dataDir, workspaceId, workspaceRoot);
    const requestedTaskRoot = taskRoots.find(root => root.rootId === normalized);
    if (requestedTaskRoot) {
        return {
            absolutePath: requestedTaskRoot.absolutePath,
            isDefault: false,
            isTaskDerived: true,
            rootId: requestedTaskRoot.rootId,
        };
    }

    // Validate the root is in the configured list
    if (!additionalRoots || !additionalRoots.includes(normalized)) {
        return {
            error: `Root '${normalized}' is not configured. Add it via workspace preferences first.`,
            statusCode: 400,
        };
    }

    if (!workspaceRoot) {
        return {
            error: 'Workspace root path is not available. Cannot resolve repo-folder root.',
            statusCode: 400,
        };
    }

    const absolutePath = path.resolve(workspaceRoot, normalized);

    // Security: ensure the resolved path is within the workspace root
    const normalizedWsRoot = path.resolve(workspaceRoot);
    if (!absolutePath.startsWith(normalizedWsRoot + path.sep) && absolutePath !== normalizedWsRoot) {
        return {
            error: 'Resolved root path is outside the workspace directory.',
            statusCode: 403,
        };
    }

    // If this configured Notes root resolves to a task-derived directory, use
    // the protected task identity consistently even for an older relative id.
    const canonicalPath = canonicalizeExistingNotesDirectory(absolutePath);
    const overlappingTaskRoot = canonicalPath
        ? taskRoots.find(root =>
            taskRootPathComparisonKey(root.absolutePath) === taskRootPathComparisonKey(canonicalPath),
        )
        : undefined;
    if (overlappingTaskRoot) {
        return {
            absolutePath: overlappingTaskRoot.absolutePath,
            isDefault: false,
            isTaskDerived: true,
            rootId: overlappingTaskRoot.rootId,
        };
    }

    return {
        absolutePath,
        isDefault: false,
        isTaskDerived: false,
        rootId: normalized,
    };
}

export function isRootResolveError(
    result: ResolvedNotesRoot | { error: string; statusCode: number },
): result is { error: string; statusCode: number } {
    return 'error' in result;
}

/**
 * Validate a candidate notes root path for addition to preferences.
 * Returns an error message if invalid, or undefined if valid.
 */
export function validateNotesRootPath(rootPath: string): string | undefined {
    if (!rootPath || typeof rootPath !== 'string') {
        return 'Root path must be a non-empty string.';
    }

    const normalized = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');

    if (normalized.length === 0) {
        return 'Root path must be a non-empty string.';
    }

    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
        return 'Root path must be relative to the workspace git root.';
    }

    if (normalized === '.' || normalized === '..') {
        return 'Root path must be a subfolder, not the workspace root itself.';
    }

    if (normalized.startsWith('../') || normalized.includes('/../') || normalized.endsWith('/..')) {
        return 'Root path must not contain parent directory references (..).';
    }

    if (normalized.length > 500) {
        return 'Root path is too long (max 500 characters).';
    }

    return undefined;
}

/**
 * Encode a root path into a filesystem-safe directory name.
 * Uses a short SHA-256 prefix plus the sanitized path for readability.
 */
export function encodeRootPath(rootPath: string): string {
    const normalized = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8);
    const safe = normalized.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_');
    return `${safe}__${hash}`;
}

/*
 * Sidecar file placement (comments / paper annotations) lives in
 * `notes-sidecar-resolver.ts`, which also owns the access check for the note
 * path itself.
 */
