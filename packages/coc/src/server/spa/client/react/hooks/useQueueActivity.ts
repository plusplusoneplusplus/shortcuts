/**
 * useQueueActivity — maps queue execution state onto task file paths.
 *
 * Builds a record keyed by relative task file path (matching TaskTreeItem paths)
 * with the count of running queue items for each path.
 */

import { useMemo } from 'react';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { toForwardSlashes } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';

/** Normalise a file path: backslash → slash, strip trailing slash. */
function normalizePath(p: string): string {
    return toForwardSlashes(p).replace(/\/+$/, '');
}

/**
 * Extract the relative task file path from a queue item payload.
 * Returns null if no task file path can be confidently determined.
 */
function extractTaskPath(
    item: any,
    wsRootPath: string,
    tasksFolder: string,
): string | null {
    const payload = item?.payload;
    if (!payload) return null;

    // Candidate absolute paths in priority order
    const candidates: string[] = [];

    if (typeof payload.planFilePath === 'string') {
        candidates.push(payload.planFilePath);
    }
    if (payload.data && typeof payload.data.originalTaskPath === 'string') {
        candidates.push(payload.data.originalTaskPath);
    }
    if (typeof payload.filePath === 'string') {
        candidates.push(payload.filePath);
    }

    const prefix = wsRootPath
        ? normalizePath(wsRootPath) + '/' + normalizePath(tasksFolder) + '/'
        : '';

    for (const raw of candidates) {
        const norm = normalizePath(raw);
        if (prefix && norm.startsWith(prefix)) {
            const rel = norm.slice(prefix.length);
            if (rel) return rel;
        }
    }

    return null;
}

export type QueueActivityMap = Record<string, number>;
export type QueueFolderActivityMap = Record<string, number>;

export function useQueueActivity(wsId: string, tasksFolder = '.vscode/tasks'): { fileMap: QueueActivityMap; folderMap: QueueFolderActivityMap } {
    const { state: queueState } = useQueue();
    const { state: appState } = useApp();

    return useMemo(() => {
        const ws = appState.workspaces.find((w: any) => w.id === wsId);
        const wsRootPath: string = ws?.rootPath || '';
        const map: QueueActivityMap = {};

        // Prefer per-repo data from repoQueueMap (updated in real-time via WebSocket)
        // over top-level arrays (only populated on full page refresh).
        const repoEntry = queueState.repoQueueMap?.[wsId];
        const queued = repoEntry?.queued ?? queueState.queued ?? [];
        const running = repoEntry?.running ?? queueState.running ?? [];
        const activeItems = [...queued, ...running];

        for (const item of activeItems) {
            const rel = extractTaskPath(item, wsRootPath, tasksFolder);
            if (rel) {
                map[rel] = (map[rel] || 0) + 1;
            }
        }

        const folderMap: QueueFolderActivityMap = {};
        for (const [rel, count] of Object.entries(map)) {
            const parts = rel.split('/');
            // accumulate for each ancestor folder prefix (exclude the filename itself)
            for (let i = 1; i < parts.length; i++) {
                const prefix = parts.slice(0, i).join('/');
                folderMap[prefix] = (folderMap[prefix] || 0) + count;
            }
        }

        return { fileMap: map, folderMap };
    }, [queueState.queued, queueState.running, queueState.repoQueueMap, appState.workspaces, wsId, tasksFolder]);
}
