/**
 * useQueueActivity — maps queue execution state onto task file paths.
 *
 * Builds a record keyed by relative task file path (matching TaskTreeItem paths)
 * with the count of running queue items for each path.
 */

import { useMemo } from 'react';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';

/** Normalise a file path: backslash → slash, strip trailing slash. */
function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '');
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

export function useQueueActivity(wsId: string, tasksFolder = '.vscode/tasks'): QueueActivityMap {
    const { state: queueState } = useQueue();
    const { state: appState } = useApp();

    return useMemo(() => {
        const ws = appState.workspaces.find((w: any) => w.id === wsId);
        const wsRootPath: string = ws?.rootPath || '';
        const map: QueueActivityMap = {};

        const activeItems = [...(queueState.queued || []), ...(queueState.running || [])];

        for (const item of activeItems) {
            const rel = extractTaskPath(item, wsRootPath, tasksFolder);
            if (rel) {
                map[rel] = (map[rel] || 0) + 1;
            }
        }

        return map;
    }, [queueState.queued, queueState.running, appState.workspaces, wsId, tasksFolder]);
}
