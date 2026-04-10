/**
 * notesApi — typed wrappers over the repo-scoped notes REST endpoints.
 */

import { fetchApi } from '../hooks/useApi';

// ── Types ───────────────────────────────────────────────────────────────────

export interface NoteTreeNode {
    name: string;
    path: string;
    type: 'notebook' | 'section' | 'page';
    children?: NoteTreeNode[];
}

export interface NoteSearchMatch {
    line: number;
    text: string;
}

export interface NoteSearchResult {
    path: string;
    matches: NoteSearchMatch[];
}

export interface NoteSearchResponse {
    results: NoteSearchResult[];
    truncated: boolean;
}

// ── Comment types (mirrors notes-comments-types.ts) ────────────────────────

export interface TextAnchor {
    quotedText: string;
    prefix: string;
    suffix: string;
}

export interface Comment {
    id: string;
    body: string;
    createdAt: string;
    updatedAt?: string;
}

export interface CommentThread {
    id: string;
    anchor: TextAnchor;
    status: 'open' | 'resolved';
    comments: Comment[];
    createdAt: string;
}

export interface NoteSidecar {
    noteId: string;
    threads: Record<string, CommentThread>;
}

// ── API helpers ─────────────────────────────────────────────────────────────

export const notesApi = {
    getTree(wsId: string): Promise<NoteTreeNode[]> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/tree`);
    },

    getContent(wsId: string, notePath: string): Promise<{ content: string; path: string }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/content?path=${encodeURIComponent(notePath)}`);
    },

    saveContent(wsId: string, notePath: string, content: string): Promise<{ path: string; updated: boolean }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/content`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: notePath, content }),
        });
    },

    createNode(wsId: string, nodePath: string, type: 'notebook' | 'section' | 'page'): Promise<{ path: string; type: string }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/page`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: nodePath, type }),
        });
    },

    renameNode(wsId: string, oldPath: string, newPath: string): Promise<{ oldPath: string; newPath: string }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/path`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPath, newPath }),
        });
    },

    deleteNode(wsId: string, nodePath: string): Promise<void> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/path?path=${encodeURIComponent(nodePath)}`, {
            method: 'DELETE',
        });
    },

    search(wsId: string, query: string): Promise<NoteSearchResponse> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/search?q=${encodeURIComponent(query)}`);
    },

    // ── Image endpoints ─────────────────────────────────────────────────────

    uploadImage(wsId: string, fileName: string, data: string): Promise<{ path: string }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName, data }),
        });
    },

    // ── Comment endpoints ───────────────────────────────────────────────────

    getComments(wsId: string, notePath: string): Promise<NoteSidecar> {
        return fetchApi(
            `/workspaces/${encodeURIComponent(wsId)}/notes/comments?path=${encodeURIComponent(notePath)}`,
        );
    },

    saveComments(wsId: string, notePath: string, threads: Record<string, CommentThread>): Promise<void> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/comments`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: notePath, threads }),
        });
    },

    createThread(wsId: string, notePath: string, thread: CommentThread): Promise<{ thread: CommentThread }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/comments/thread`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: notePath, thread }),
        });
    },

    updateThread(wsId: string, notePath: string, threadId: string, status: 'open' | 'resolved'): Promise<{ thread: CommentThread }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/comments/thread/${encodeURIComponent(threadId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: notePath, status }),
        });
    },

    deleteThread(wsId: string, notePath: string, threadId: string): Promise<void> {
        return fetchApi(
            `/workspaces/${encodeURIComponent(wsId)}/notes/comments/thread/${encodeURIComponent(threadId)}?path=${encodeURIComponent(notePath)}`,
            { method: 'DELETE' },
        );
    },

    addComment(wsId: string, notePath: string, threadId: string, content: string): Promise<{ comment: Comment }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/comments/thread/${encodeURIComponent(threadId)}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: notePath, content }),
        });
    },

    editComment(wsId: string, notePath: string, threadId: string, commentId: string, content: string): Promise<{ comment: Comment }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/comments/thread/${encodeURIComponent(threadId)}/comment/${encodeURIComponent(commentId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: notePath, content }),
        });
    },

    deleteComment(wsId: string, notePath: string, threadId: string, commentId: string): Promise<void> {
        return fetchApi(
            `/workspaces/${encodeURIComponent(wsId)}/notes/comments/thread/${encodeURIComponent(threadId)}/comment/${encodeURIComponent(commentId)}?path=${encodeURIComponent(notePath)}`,
            { method: 'DELETE' },
        );
    },
};
