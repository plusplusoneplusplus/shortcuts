/**
 * Sidecar placement and access control for note attachments.
 *
 * A sidecar is the JSON file holding data attached to a note — comment threads
 * (`.comments.json`) or paper annotations (`.paper-annotations.json`).
 *
 * Placement rules:
 * - Notes inside the managed workspace data dir (`~/.coc/repos/<wsId>/`) or
 *   inside `~/.copilot` keep a co-located sidecar next to the note.
 * - Every other note — repo-folder roots, and default-root notes opened by
 *   absolute path from inside the workspace git repo (chat scratchpad files) —
 *   gets its sidecar under `~/.coc/repos/<wsId>/notes-comments/<bucket>/`, so
 *   the workspace repo stays clean.
 *
 * Access control runs on the *note* path, not the sidecar path: the question is
 * whether this workspace may annotate that file. Allowed areas are the workspace
 * data dir, `~/.copilot`, and the workspace git root.
 *
 * Pure Node.js; cross-platform (Linux/Mac/Windows).
 */

import * as os from 'os';
import * as path from 'path';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { encodeRootPath } from './notes-root-resolver';
import type { ResolvedNotesRoot } from './notes-root-resolver';
import { resolveSafeNotesPath, isNotesPathSafetyError } from './notes-path-safety';

/** Directory under the workspace data dir holding all managed sidecars. */
const SIDECAR_DIR_NAME = 'notes-comments';

/**
 * Bucket key for notes that live in the workspace git repo but are opened
 * through the default root (chat scratchpad / transcript files).
 *
 * `validateNotesRootPath` rejects `'.'` as a configurable root, so this bucket
 * can never collide with a repo-folder root bucket.
 */
const WORKSPACE_ROOT_BUCKET = '.';

export interface SidecarResolveError {
    error: string;
    statusCode: number;
}

export function isSidecarResolveError(result: string | SidecarResolveError): result is SidecarResolveError {
    return typeof result !== 'string';
}

export function getWorkspaceDataDir(dataDir: string, workspaceId: string): string {
    return path.join(dataDir, 'repos', workspaceId);
}

export function getCopilotDir(): string {
    return path.join(os.homedir(), '.copilot');
}

/** True when the workspace is allowed to read/annotate this absolute path. */
export function isAllowedNotePath(resolved: string, wsDataDir: string, wsRootPath?: string): boolean {
    return isWithinDirectory(resolved, wsDataDir)
        || isWithinDirectory(resolved, getCopilotDir())
        || (!!wsRootPath && isWithinDirectory(resolved, wsRootPath));
}

/** Place one sidecar inside the managed area, guarding traversal and symlinks. */
async function resolveManagedSidecar(
    wsDataDir: string,
    bucket: string,
    relativeNotePath: string,
    suffix: string,
): Promise<string | SidecarResolveError> {
    const sidecarRelativePath = path.join(
        SIDECAR_DIR_NAME,
        encodeRootPath(bucket),
        `${relativeNotePath}${suffix}`,
    );
    const safeSidecarPath = await resolveSafeNotesPath(
        wsDataDir,
        sidecarRelativePath,
        { rejectSymlinks: true },
    );
    if (isNotesPathSafetyError(safeSidecarPath)) {
        return safeSidecarPath;
    }
    return safeSidecarPath.absolutePath;
}

export interface ResolveNoteSidecarOptions {
    dataDir: string;
    workspace: { id: string; rootPath?: string };
    root: ResolvedNotesRoot;
    /** Client-supplied note path: relative to the active root, or absolute for the default root. */
    notePath: string;
    /** Sidecar filename suffix, e.g. `.comments.json`. */
    suffix: string;
}

/**
 * Resolve the sidecar file path for one note, after checking that the workspace
 * is allowed to annotate that note. Returns an error object instead of a path
 * when access is denied or the path cannot be safely resolved.
 */
export async function resolveNoteSidecarPath(
    options: ResolveNoteSidecarOptions,
): Promise<string | SidecarResolveError> {
    const { dataDir, workspace, root, notePath, suffix } = options;
    const wsDataDir = getWorkspaceDataDir(dataDir, workspace.id);

    if (!root.isDefault) {
        // Repo-folder root: the note lives in the user's repo; containment is
        // enforced against the selected root.
        const safeNotePath = await resolveSafeNotesPath(root.absolutePath, notePath);
        if (isNotesPathSafetyError(safeNotePath)) {
            return safeNotePath;
        }
        return resolveManagedSidecar(wsDataDir, root.rootId, safeNotePath.relativePath, suffix);
    }

    // Default root: absolute paths are used as-is (scratchpad / session-state
    // files), relative paths resolve under the managed notes root.
    const noteAbsolutePath = path.isAbsolute(notePath)
        ? path.resolve(notePath)
        : path.resolve(root.absolutePath, notePath);

    if (!isAllowedNotePath(noteAbsolutePath, wsDataDir, workspace.rootPath)) {
        return { error: 'Access denied: path is outside workspace data directory', statusCode: 403 };
    }

    if (isWithinDirectory(noteAbsolutePath, wsDataDir) || isWithinDirectory(noteAbsolutePath, getCopilotDir())) {
        return noteAbsolutePath + suffix;
    }

    // The note is inside the workspace git repo — keep the repo clean by storing
    // the sidecar in the managed area instead of next to the file.
    const relativeNotePath = path.relative(workspace.rootPath!, noteAbsolutePath);
    return resolveManagedSidecar(wsDataDir, WORKSPACE_ROOT_BUCKET, relativeNotePath, suffix);
}
