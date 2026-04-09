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
};
