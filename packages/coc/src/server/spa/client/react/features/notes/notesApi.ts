/**
 * notesApi — typed wrappers over the repo-scoped notes REST endpoints.
 */

import { fetchApi } from '../../hooks/useApi';
import { getApiBase } from '../../utils/config';

/**
 * Like fetchApi but surfaces 409 Conflict responses as enriched errors
 * instead of generic "API error" messages.
 */
async function fetchApiWithConflict(urlPath: string, init: RequestInit): Promise<any> {
    const url = getApiBase() + urlPath;
    const res = await fetch(url, init);
    if (res.status === 409) {
        const data = await res.json();
        throw Object.assign(new Error('conflict'), { status: 409, ...data });
    }
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    if (res.status === 204) return undefined;
    return res.json();
}

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

export interface NoteTreeResponse {
    tree: NoteTreeNode[];
    notesRoot: string;
    /** Names of top-level notebook folders that are managed by the system and cannot be renamed or deleted. */
    systemFolders?: string[];
}

// ── Comment types (mirrors notes-comments-types.ts) ────────────────────────

// Canonical definition lives in notes/textAnchor.ts; re-export for compatibility.
export type { TextAnchor } from './notes/textAnchor';

export interface Comment {
    id: string;
    content: string;
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
    getTree(wsId: string): Promise<NoteTreeResponse> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/tree`);
    },

    getContent(wsId: string, notePath: string): Promise<{ content: string; path: string; mtime: number }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/content?path=${encodeURIComponent(notePath)}`);
    },

    saveContent(wsId: string, notePath: string, content: string, expectedMtime?: number): Promise<{ path: string; updated: boolean; mtime: number }> {
        return fetchApiWithConflict(`/workspaces/${encodeURIComponent(wsId)}/notes/content`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: notePath, content, ...(expectedMtime !== undefined ? { expectedMtime } : {}) }),
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

    reorder(wsId: string, parentPath: string, order: string[]): Promise<{ parentPath: string; order: string[] }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/order`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentPath, order }),
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

    /**
     * Enqueue a batch-resolve task for all open comment threads on a note.
     * Returns the queue task ID on success (202).
     */
    batchResolve(wsId: string, notePath: string, documentContent: string, userContext?: string): Promise<{ taskId: string }> {
        return fetchApi(
            `/workspaces/${encodeURIComponent(wsId)}/notes/batch-resolve?path=${encodeURIComponent(notePath)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ documentContent, ...(userContext ? { userContext } : {}) }),
            },
        );
    },

    // ── Git status endpoint ──────────────────────────────────────────

    getGitStatus(wsId: string): Promise<{
        initialized: boolean;
        branch?: string;
        clean?: boolean;
    }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/git/status`);
    },

    // ── Auto-commit timer endpoints ──────────────────────────────────

    getAutoCommitStatus(wsId: string): Promise<{
        enabled: boolean;
        intervalMs?: number;
        lastCommittedAt?: string | null;
        lastError?: string | null;
        warning?: string;
    }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/git/auto-commit/status`);
    },

    enableAutoCommit(wsId: string, intervalMs?: number): Promise<{ enabled: boolean; intervalMs: number }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/git/auto-commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intervalMs: intervalMs ?? 1_800_000 }),
        });
    },

    disableAutoCommit(wsId: string): Promise<{ deleted: boolean }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/git/auto-commit`, {
            method: 'DELETE',
        });
    },

    updateAutoCommitInterval(wsId: string, intervalMs: number): Promise<{ enabled: boolean; intervalMs: number }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/git/auto-commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intervalMs }),
        });
    },

    // ── Per-file version history endpoints ──────────────────────────

    getFileLog(wsId: string, notePath: string, limit = 50): Promise<{
        entries: Array<{
            hash: string; shortHash: string; message: string; date: string; isNamedCheckpoint: boolean;
        }>;
        path: string;
        limit: number;
    }> {
        return fetchApi(
            `/workspaces/${encodeURIComponent(wsId)}/notes/git/file-log?path=${encodeURIComponent(notePath)}&limit=${limit}`,
        );
    },

    getFileContentAtRevision(wsId: string, hash: string, notePath: string): Promise<{
        content: string; hash: string; path: string;
    }> {
        return fetchApi(
            `/workspaces/${encodeURIComponent(wsId)}/notes/git/file-content?hash=${encodeURIComponent(hash)}&path=${encodeURIComponent(notePath)}`,
        );
    },

    saveCheckpoint(wsId: string, notePath: string, name: string): Promise<{ hash: string; message: string }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/git/save-checkpoint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: notePath, name }),
        });
    },

    restoreVersion(wsId: string, notePath: string, hash: string): Promise<{ mtime: number }> {
        return fetchApi(`/workspaces/${encodeURIComponent(wsId)}/notes/git/restore-version`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: notePath, hash }),
        });
    },
};
