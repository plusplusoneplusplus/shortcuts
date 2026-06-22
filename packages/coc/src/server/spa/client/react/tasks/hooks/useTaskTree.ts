/**
 * useTaskTree — data-fetching hook for the workspace task tree.
 * Fetches the task folder hierarchy and comment counts, auto-refreshes on WS events.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useCocClient } from '../../repos/cloneRouting';

// ── Types ──────────────────────────────────────────────────────────────

export interface TaskFolder {
    name: string;
    relativePath: string;
    /** Absolute path to the folder (populated by the server) */
    folderPath?: string;
    children: TaskFolder[];
    documentGroups: TaskDocumentGroup[];
    singleDocuments: TaskDocument[];
    /** Absolute filesystem path of the task root this folder belongs to */
    taskRootPath?: string;
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
    /** Absolute filesystem path of the task root this document belongs to */
    taskRootPath?: string;
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

function getPathSegments(relativePath: string): string[] {
    return relativePath.split(/[\\/]/).filter(Boolean);
}

export function isGitMetadataFolder(folder: TaskFolder): boolean {
    if (folder.name === '.git') {
        return true;
    }
    return getPathSegments(folder.relativePath ?? '').includes('.git');
}

export function filterGitMetadataFolders(folder: TaskFolder): TaskFolder {
    const children = Array.isArray(folder.children) ? folder.children : [];

    return {
        ...folder,
        children: children
            .filter((child) => !isGitMetadataFolder(child))
            .map((child) => filterGitMetadataFolders(child)),
    };
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

// ── Path helpers ───────────────────────────────────────────────────────

/**
 * Resolve the relative file path for a task document or document group node.
 * Returns null for folder nodes.
 */
export function getTaskNodePath(item: TaskNode): string | null {
    if (isTaskDocument(item)) {
        const rel = (item.relativePath || '').replace(/\\/g, '/');
        return rel ? rel + '/' + item.fileName : item.fileName;
    }
    if (isTaskDocumentGroup(item)) {
        const firstDoc = item.documents[0];
        if (firstDoc) {
            const rel = (firstDoc.relativePath || '').replace(/\\/g, '/');
            return rel ? rel + '/' + firstDoc.fileName : firstDoc.fileName;
        }
    }
    return null;
}

/**
 * Return the absolute task-root path stamped on a node by the server.
 * For document groups, uses the first document's root.
 */
export function getTaskNodeTaskRootPath(item: TaskNode): string | undefined {
    if (isTaskDocument(item)) return item.taskRootPath;
    if (isTaskDocumentGroup(item)) return item.documents[0]?.taskRootPath;
    if (isTaskFolder(item)) return (item as TaskFolder).taskRootPath;
    return undefined;
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

export interface CollectedTaskFile {
    fileName: string;
    relativePath: string;
}

const INACTIVE_STATUSES = new Set(['future', 'done']);

/**
 * Recursively collect active markdown files from a folder tree,
 * excluding context files and inactive tasks (future/done).
 */
export function collectMarkdownFiles(folder: TaskFolder): CollectedTaskFile[] {
    const files: CollectedTaskFile[] = [];

    for (const doc of folder.singleDocuments) {
        if (
            doc.fileName.toLowerCase().endsWith('.md') &&
            !isContextFile(doc.fileName) &&
            !INACTIVE_STATUSES.has(doc.status ?? '')
        ) {
            const rel = doc.relativePath ? doc.relativePath + '/' + doc.fileName : doc.fileName;
            files.push({ fileName: doc.fileName, relativePath: rel });
        }
    }

    for (const group of folder.documentGroups) {
        for (const doc of group.documents) {
            if (
                doc.fileName.toLowerCase().endsWith('.md') &&
                !isContextFile(doc.fileName) &&
                !INACTIVE_STATUSES.has(doc.status ?? '')
            ) {
                const rel = doc.relativePath ? doc.relativePath + '/' + doc.fileName : doc.fileName;
                files.push({ fileName: doc.fileName, relativePath: rel });
            }
        }
    }

    for (const child of folder.children) {
        files.push(...collectMarkdownFiles(child));
    }

    return files;
}

// ── Search utilities ───────────────────────────────────────────────────

export function flattenTaskTree(folder: TaskFolder): (TaskDocument | TaskDocumentGroup)[] {
    const result: (TaskDocument | TaskDocumentGroup)[] = [];
    const contextDocs: TaskDocument[] = (folder as any).contextDocuments ?? [];

    result.push(...folder.singleDocuments);
    result.push(...folder.documentGroups);
    result.push(...contextDocs);

    for (const child of folder.children) {
        result.push(...flattenTaskTree(child));
    }

    return result;
}

export function filterTaskItems(
    items: (TaskDocument | TaskDocumentGroup)[],
    query: string,
): (TaskDocument | TaskDocumentGroup)[] {
    if (!query) return items.slice().sort((a, b) => a.baseName.localeCompare(b.baseName));

    const q = query.toLowerCase();

    return items
        .filter((item) => {
            const haystack: string[] = [item.baseName];

            if (isTaskDocument(item)) {
                haystack.push(item.fileName);
                if (item.relativePath) haystack.push(item.relativePath);
            }

            if (isTaskDocumentGroup(item)) {
                for (const doc of item.documents) {
                    haystack.push(doc.fileName);
                    if (doc.relativePath) haystack.push(doc.relativePath);
                }
            }

            return haystack.some((field) => field.toLowerCase().includes(q));
        })
        .sort((a, b) => {
            const aArchived = a.isArchived ? 1 : 0;
            const bArchived = b.isArchived ? 1 : 0;
            if (aArchived !== bArchived) return aArchived - bArchived;
            return a.baseName.localeCompare(b.baseName);
        });
}

// ── Status Icon ────────────────────────────────────────────────────────

export const TASK_STATUSES = ['pending', 'in-progress', 'done', 'future'] as const;
export type TaskStatusValue = (typeof TASK_STATUSES)[number];

export const STATUS_PILLS: { status: TaskStatusValue; icon: string; label: string }[] = [
    { status: 'pending', icon: '⏳', label: 'Pending' },
    { status: 'in-progress', icon: '🔄', label: 'In-Progress' },
    { status: 'done', icon: '✅', label: 'Done' },
    { status: 'future', icon: '📋', label: 'Future' },
];

/**
 * Return the emoji status icon for a task status string.
 */
export function getTaskStatusIcon(status?: string): string {
    switch (status) {
        case 'done':        return '✅';
        case 'in-progress': return '🔄';
        case 'pending':     return '⏳';
        case 'future':      return '📋';
        default:            return '';
    }
}

// ── Status Filtering ───────────────────────────────────────────────────

/**
 * Returns true if a document matches the active status filter.
 * An empty filter array means "show all".
 */
export function isDocumentMatchingFilter(doc: { status?: string }, filter: TaskStatusValue[]): boolean {
    if (filter.length === 0) return true;
    return filter.includes(doc.status as TaskStatusValue);
}

/**
 * Recursively prune a task folder tree to only include documents matching the filter.
 * Folders with no matching descendants are removed.
 */
export function filterFolderTree(folder: TaskFolder, filter: TaskStatusValue[]): TaskFolder | null {
    if (filter.length === 0) return folder;
    if (folder.name === 'archive') return null;

    const filteredChildren = folder.children
        .map(child => filterFolderTree(child, filter))
        .filter((child): child is TaskFolder => child !== null);

    const filteredSingleDocs = folder.singleDocuments.filter(doc => isDocumentMatchingFilter(doc, filter));

    const filteredDocGroups = folder.documentGroups.filter(group => {
        return group.documents.some(doc => isDocumentMatchingFilter(doc, filter));
    });

    const contextDocs: TaskDocument[] = (folder as any).contextDocuments ?? [];
    const filteredContextDocs = contextDocs.filter(doc => isDocumentMatchingFilter(doc, filter));

    const hasContent = filteredChildren.length > 0 || filteredSingleDocs.length > 0 || filteredDocGroups.length > 0 || filteredContextDocs.length > 0;
    if (!hasContent) return null;

    const result: TaskFolder = {
        ...folder,
        children: filteredChildren,
        singleDocuments: filteredSingleDocs,
        documentGroups: filteredDocGroups,
    };
    if (contextDocs.length > 0) {
        (result as any).contextDocuments = filteredContextDocs;
    }
    return result;
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
    // Route through the clone's own server so a remote workspace's task tree and
    // comment counts resolve on their owning host instead of 404ing the local one.
    const client = useCocClient(wsId);

    const refresh = useCallback(() => {
        if (!wsId) return;
        if (!hasLoadedOnce.current) {
            setLoading(true);
        }
        setError(null);

        const tasksClient = client.tasks;
        Promise.all([
            tasksClient.getTree(wsId, { showArchived: true }),
            tasksClient.getCommentCounts(wsId).catch(() => null),
        ]).then(([tasksData, countsData]) => {
            const filteredTree = tasksData && typeof tasksData === 'object'
                ? filterGitMetadataFolders(tasksData as TaskFolder)
                : (tasksData as TaskFolder | null);
            setTree(filteredTree);
            if (countsData && typeof countsData === 'object') {
                setCommentCounts(countsData as Record<string, number>);
            }
            hasLoadedOnce.current = true;
            setLoading(false);
        }).catch((err) => {
            setError(getSpaCocClientErrorMessage(err, 'Failed to load tasks'));
            setLoading(false);
        });
    }, [wsId, client]);

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
