/**
 * WorkspaceFileNoteEditorIO — NoteEditorIO adapter for arbitrary workspace files.
 *
 * Used by the floating markdown dialog and pop-out shell when a chat-clicked
 * file lives outside `.vscode/tasks/`. Loads via the workspace file-preview
 * endpoint and saves via the tasks content endpoint (which now accepts
 * workspace-relative `.md` files as a fallback).
 *
 * Image upload and serving reuse the notes image endpoint, matching
 * `TasksNoteEditorIO`'s V1 decision: attachments land under the notes
 * `.attachments/` directory.
 *
 * Every call is routed through the clone registry by `workspaceId`, so editing a
 * file in a REMOTE workspace talks to that workspace's own server. Local ids
 * resolve to the default page-origin client, unchanged.
 */

import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { translateSpaCocClientError } from '../api/cocClient';
import { getCocClientForWorkspace, remoteCloneApiBase } from '../repos/cloneRegistry';
import { type NoteEditorIO } from '../features/notes/editor/NoteEditorIO';

async function withConflictError<T>(request: Promise<T>): Promise<T> {
    try {
        return await request;
    } catch (error) {
        if (error instanceof CocApiError && error.status === 409) {
            const body =
                error.body && typeof error.body === 'object'
                    ? (error.body as Record<string, unknown>)
                    : {};
            throw Object.assign(new Error('conflict'), { status: 409, ...body });
        }
        translateSpaCocClientError(error);
    }
}

async function withSpaErrors<T>(request: Promise<T>): Promise<T> {
    try {
        return await request;
    } catch (error) {
        translateSpaCocClientError(error);
    }
}

/**
 * Reconstruct the full text content from a `previewWorkspaceFile` response.
 *
 * Prefers the explicit `content` field (returned when `lines: 0` is requested)
 * to preserve trailing newlines exactly. Falls back to joining `lines` for
 * older server responses that omit `content`.
 */
function extractContent(res: { content?: unknown; lines?: unknown }): string {
    if (typeof res.content === 'string') return res.content;
    if (Array.isArray(res.lines)) {
        return (res.lines as unknown[])
            .map((line) => (typeof line === 'string' ? line : ''))
            .join('\n');
    }
    return '';
}

/**
 * REST base for an image URL: the clone's absolute base for a remote workspace,
 * else the relative `/api` the local flow has always used.
 */
function imageApiBase(workspaceId: string): string {
    return remoteCloneApiBase(workspaceId) ?? '/api';
}

/**
 * Create a NoteEditorIO that reads workspace-relative files via the
 * file-preview endpoint and writes them via the tasks content endpoint.
 */
export function createWorkspaceFileNoteEditorIO(): NoteEditorIO {
    return {
        async loadContent(workspaceId, path) {
            const res = await withSpaErrors(
                getCocClientForWorkspace(workspaceId).tasks.previewWorkspaceFile(workspaceId, path, { lines: 0 }),
            );
            const content = extractContent(res as { content?: unknown; lines?: unknown });
            const mtime = typeof (res as { mtime?: unknown }).mtime === 'number'
                ? ((res as { mtime: number }).mtime)
                : 0;
            return { content, path, mtime };
        },

        async saveContent(workspaceId, path, markdown, expectedMtime?) {
            const res = await withConflictError(
                getCocClientForWorkspace(workspaceId).tasks.writeContent(workspaceId, {
                    path,
                    content: markdown,
                    expectedMtime,
                }),
            );
            return { path: res.path, updated: res.updated, mtime: res.mtime };
        },

        async uploadImage(workspaceId, fileName, dataUrl) {
            const res = await withSpaErrors(
                getCocClientForWorkspace(workspaceId).notes.uploadImage(workspaceId, fileName, dataUrl),
            );
            return { path: res.path };
        },

        imageApiUrl(workspaceId, relativePath) {
            return `${imageApiBase(workspaceId)}/workspaces/${encodeURIComponent(workspaceId)}/notes/image?path=${encodeURIComponent(relativePath)}`;
        },

        localImageApiUrl(workspaceId, absolutePath) {
            return `${imageApiBase(workspaceId)}/workspaces/${encodeURIComponent(workspaceId)}/notes/local-image?path=${encodeURIComponent(absolutePath)}`;
        },
    };
}
