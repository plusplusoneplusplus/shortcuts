/**
 * useTaskTree — data-fetching hook for the workspace task tree.
 * Fetches the task folder hierarchy and comment counts, auto-refreshes on WS events.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from './useApi';

// ── Types ──────────────────────────────────────────────────────────────

export interface TaskFolder {
    name: string;
    relativePath: string;
    children: TaskFolder[];
    documentGroups: TaskDocumentGroup[];
    singleDocuments: TaskDocument[];
}

export interface TaskDocumentGroup {
    baseName: string;
    documents: TaskDocument[];
    isArchived: boolean;
}

export interface TaskDocument {
    baseName: string;
    docType?: string;
    fileName: string;
    relativePath?: string;
    status?: string;
    isArchived: boolean;
}

export type TaskNode = TaskFolder | TaskDocumentGroup | TaskDocument;

// ── Context File Filtering ─────────────────────────────────────────────

export const CONTEXT_FILES = new Set([
    'readme', 'readme.md', 'claude.md', 'license', 'license.md',
    'changelog.md', 'contributing.md', 'code_of_conduct.md', 'security.md',
    'index', 'index.md', 'context', 'context.md',
    '.gitignore', '.gitattributes',
]);

export function isContextFile(fileName: string): boolean {
    return CONTEXT_FILES.has(fileName.toLowerCase());
}

// ── Type guards ────────────────────────────────────────────────────────

export function isTaskFolder(node: TaskNode): node is TaskFolder {
    return 'children' in node && 'singleDocuments' in node;
}

export function isTaskDocumentGroup(node: TaskNode): node is TaskDocumentGroup {
    return 'documents' in node && 'baseName' in node && !('children' in node);
}

export function isTaskDocument(node: TaskNode): node is TaskDocument {
    return 'fileName' in node && !('documents' in node) && !('children' in node);
}

// ── Helper ─────────────────────────────────────────────────────────────

export function folderToNodes(folder: TaskFolder): TaskNode[] {
    const contextDocs = (folder as any).contextDocuments ?? [];
    return [...folder.children, ...folder.documentGroups, ...folder.singleDocuments, ...contextDocs];
}

export function countMarkdownFilesInFolder(folder: TaskFolder): number {
    const directSingles = folder.singleDocuments.reduce((count, doc) => (
        doc.fileName.toLowerCase().endsWith('.md') ? count + 1 : count
    ), 0);
    const groupedDocs = folder.documentGroups.reduce((groupCount, group) => (
        groupCount + group.documents.reduce((docCount, doc) => (
            doc.fileName.toLowerCase().endsWith('.md') ? docCount + 1 : docCount
        ), 0)
    ), 0);
    const childDocs = folder.children.reduce((childCount, child) => (
        childCount + countMarkdownFilesInFolder(child)
    ), 0);

    return directSingles + groupedDocs + childDocs;
}

// ── Hook ───────────────────────────────────────────────────────────────

export interface UseTaskTreeResult {
    tree: TaskFolder | null;
    commentCounts: Record<string, number>;
    loading: boolean;
    error: string | null;
    refresh: () => void;
}

export function useTaskTree(wsId: string): UseTaskTreeResult {
    const [tree, setTree] = useState<TaskFolder | null>(null);
    const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const hasLoadedOnce = useRef(false);

    const refresh = useCallback(() => {
        if (!wsId) return;
        if (!hasLoadedOnce.current) {
            setLoading(true);
        }
        setError(null);

        Promise.all([
            fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks?showArchived=true`),
            fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks/comment-counts`).catch(() => null),
        ]).then(([tasksData, countsData]) => {
            setTree(tasksData as TaskFolder);
            if (countsData && typeof countsData === 'object') {
                setCommentCounts(countsData as Record<string, number>);
            }
            hasLoadedOnce.current = true;
            setLoading(false);
        }).catch((err) => {
            setError(err instanceof Error ? err.message : 'Failed to load tasks');
            setLoading(false);
        });
    }, [wsId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // Listen for tasks-changed events from WebSocket
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.wsId === wsId) {
                refresh();
            }
        };
        window.addEventListener('tasks-changed', handler);
        return () => window.removeEventListener('tasks-changed', handler);
    }, [wsId, refresh]);

    return { tree, commentCounts, loading, error, refresh };
}
