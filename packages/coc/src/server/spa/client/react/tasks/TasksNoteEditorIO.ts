/**
 * TasksNoteEditorIO — NoteEditorIO adapter backed by the tasks content API.
 *
 * Allows the shared NoteEditor component to edit task/plan files
 * (served by the tasks REST API) instead of notes files.
 *
 * Image upload and serving reuse the notes image endpoint (V1 decision):
 * plan-file images are stored under the notes `.attachments/` directory.
 */

import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, translateSpaCocClientError } from '../api/cocClient';
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
 * Create a NoteEditorIO that reads/writes task content via the tasks API.
 *
 * Call once per editor mount (or memoize at the component level) —
 * the returned object is stateless so sharing is fine.
 */
export function createTasksNoteEditorIO(): NoteEditorIO {
    return {
        async loadContent(workspaceId, path, root?) {
            const res = await withSpaErrors(
                getSpaCocClient().tasks.getContent(workspaceId, path, root ? { folder: root } : undefined),
            );
            return { content: res.content, path: res.path, mtime: res.mtime };
        },

        async saveContent(workspaceId, path, markdown, expectedMtime?, root?) {
            const res = await withConflictError(
                getSpaCocClient().tasks.writeContent(workspaceId, {
                    path,
                    content: markdown,
                    expectedMtime,
                    ...(root ? { folderPath: root } : {}),
                }),
            );
            return { path: res.path, updated: res.updated, mtime: res.mtime };
        },

        async uploadImage(workspaceId, fileName, dataUrl) {
            // Reuse the notes image endpoint for V1; images land in .attachments/.
            const res = await withSpaErrors(
                getSpaCocClient().notes.uploadImage(workspaceId, fileName, dataUrl),
            );
            return { path: res.path };
        },

        imageApiUrl(workspaceId, relativePath) {
            return `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/image?path=${encodeURIComponent(relativePath)}`;
        },

        localImageApiUrl(workspaceId, absolutePath) {
            return `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/local-image?path=${encodeURIComponent(absolutePath)}`;
        },
    };
}
