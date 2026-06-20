/**
 * Shared resolution for opening a markdown file in an editable NoteEditor —
 * used by BOTH the floating `MarkdownReviewDialog` (via `App.tsx`'s
 * `coc-open-markdown-review` handler) and the docked source canvas (AC-02).
 *
 * Given a clicked file reference (absolute or relative path, optional workspace
 * hint, optional source file for relative resolution) and the known workspaces,
 * it decides:
 *  - which workspace to edit in (`wsId`),
 *  - the path to load/save (`filePath`) — task-relative when the file lives
 *    under `.vscode/tasks/`, otherwise the full path,
 *  - the path to show in the header (`displayPath`),
 *  - which NoteEditor IO adapter to use (`fetchMode`: `'tasks'` vs `'auto'`),
 *  - the absolute task-root path when known (`taskRootPath`).
 *
 * Returns `null` when no workspace can be resolved, so callers can bail without
 * opening an editor on an unresolvable path.
 *
 * This mirrors what `App.tsx`'s handler used to compute inline; keeping it in
 * one place keeps the floating dialog and the canvas editor in sync.
 */
import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';
import {
    deriveHomeDirFromWorkspaces,
    expandTildePath,
    isAbsolutePath,
    resolveRelativePath,
} from '../../utils/path-resolution';

/* @internal – exported for testing only */
export interface WorkspaceLike {
    id: string;
    name?: string;
    rootPath?: string;
}

export type MarkdownReviewFetchMode = 'tasks' | 'auto';

export interface MarkdownReviewTarget {
    /** Workspace id to edit in. */
    wsId: string;
    /** Path to load/save — task-relative under `.vscode/tasks/`, else the full path. */
    filePath: string;
    /** Path shown in the header (the absolute/full path). */
    displayPath: string;
    /** Which NoteEditor IO adapter to use. */
    fetchMode: MarkdownReviewFetchMode;
    /** Absolute task-root path, when known (fast-path event hint or TaskTree). */
    taskRootPath?: string;
}

export interface MarkdownReviewInput {
    /** The clicked file path (absolute, workspace-relative, or task-relative). */
    filePath: string;
    /** Explicit workspace-id hint from the clicked container, if any. */
    wsId?: string;
    /** The file the (possibly relative) reference appeared in — for resolution. */
    sourceFilePath?: string;
    /** Absolute task-root path hint carried by the event, if any. */
    taskRootPath?: string;
}

function normalizePath(pathValue: string): string {
    return toForwardSlashes(pathValue);
}

/**
 * Pick the workspace whose `rootPath` is the longest prefix of `filePath`
 * (case-insensitive), or `null` when none contains it.
 */
/* @internal – exported for testing only */
export function resolveWorkspaceForPath(
    filePath: string,
    workspaces: WorkspaceLike[],
): WorkspaceLike | null {
    const normalizedPath = normalizePath(filePath).toLowerCase();
    let best: WorkspaceLike | null = null;

    for (const ws of workspaces) {
        if (!ws?.rootPath) continue;
        const normalizedRoot = normalizePath(ws.rootPath).replace(/\/+$/, '').toLowerCase();
        if (!normalizedRoot) continue;

        if (normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/')) {
            if (!best || normalizedRoot.length > normalizePath(best.rootPath || '').toLowerCase().length) {
                best = ws;
            }
        }
    }

    return best;
}

/**
 * Path of `fullPath` relative to the workspace's `.vscode/tasks` directory, or
 * `null` when it does not live under it. `''` means it IS the tasks root.
 */
function toTaskRelativePath(fullPath: string, workspaceRoot: string): string | null {
    if (!workspaceRoot) return null;
    const normalizedPath = normalizePath(fullPath);
    const normalizedRoot = normalizePath(workspaceRoot).replace(/\/+$/, '');
    const tasksRoot = `${normalizedRoot}/.vscode/tasks`;

    if (normalizedPath === tasksRoot) return '';
    if (!normalizedPath.startsWith(tasksRoot + '/')) return null;

    return normalizedPath.slice(tasksRoot.length + 1);
}

/**
 * Resolve a clicked markdown reference into the inputs an editable NoteEditor
 * needs, or `null` when no workspace can be determined.
 */
export function resolveMarkdownReviewTarget(
    input: MarkdownReviewInput,
    workspaces: WorkspaceLike[],
): MarkdownReviewTarget | null {
    let filePath = typeof input.filePath === 'string' ? input.filePath : '';
    if (!filePath) return null;

    const wsIdHint = typeof input.wsId === 'string' ? input.wsId : '';
    const eventTaskRootPath = typeof input.taskRootPath === 'string' ? input.taskRootPath : undefined;

    // CoC note hrefs (e.g. `~/.coc/repos/<wsId>/notes/...`) arrive tilde-prefixed
    // from assistant markdown links. Expand `~` to an absolute path — using the
    // home dir of the hinted (or any) workspace so remote-clone homes resolve
    // correctly — before the absolute/relative classification below, which would
    // otherwise misread `~/...` as a task-relative or unresolvable path.
    if (filePath.startsWith('~')) {
        filePath = expandTildePath(filePath, deriveHomeDirFromWorkspaces(wsIdHint, workspaces || []));
    }

    // Fast path: wsId hint provided — use that workspace directly.
    if (wsIdHint) {
        const hintedWorkspace = (workspaces || []).find((ws) => ws.id === wsIdHint);
        if (hintedWorkspace) {
            if (isAbsolutePath(filePath)) {
                // Absolute path from a chat click — fetchMode by task membership.
                const taskRelativePath = toTaskRelativePath(filePath, hintedWorkspace.rootPath || '');
                return {
                    wsId: hintedWorkspace.id,
                    filePath: taskRelativePath ?? filePath,
                    displayPath: filePath,
                    fetchMode: taskRelativePath !== null ? 'tasks' : 'auto',
                    taskRootPath: eventTaskRootPath,
                };
            }
            // Task-relative path (e.g. from the TaskTree).
            const displayBase = eventTaskRootPath
                ? normalizePath(eventTaskRootPath).replace(/\/+$/, '')
                : (() => {
                    const rootNormalized = normalizePath(hintedWorkspace.rootPath || '').replace(/\/+$/, '');
                    return rootNormalized ? `${rootNormalized}/.vscode/tasks` : '';
                })();
            const displayPath = displayBase ? `${displayBase}/${filePath}` : filePath;
            return {
                wsId: hintedWorkspace.id,
                filePath,
                displayPath,
                fetchMode: 'tasks',
                taskRootPath: eventTaskRootPath,
            };
        }
    }

    // Resolve relative paths against the source file's directory.
    const sourceFilePath = typeof input.sourceFilePath === 'string' ? input.sourceFilePath : '';
    if (sourceFilePath && !isAbsolutePath(filePath)) {
        const sourceDir = normalizePath(sourceFilePath).replace(/\/[^/]*$/, '');
        filePath = resolveRelativePath(sourceDir, filePath);
    }

    const fullPath = filePath;
    const workspace = resolveWorkspaceForPath(fullPath, workspaces || []);
    if (!workspace?.id) return null;

    const taskRelativePath = toTaskRelativePath(fullPath, workspace.rootPath || '');
    return {
        wsId: workspace.id,
        filePath: taskRelativePath ?? fullPath,
        displayPath: fullPath,
        fetchMode: taskRelativePath !== null ? 'tasks' : 'auto',
    };
}
