/**
 * useQueueChat — maps queue execution state onto task file paths.
 *
 * Builds records keyed by relative task file path (matching TaskTreeItem paths)
 * with the count of active queue items and the first provider seen for each path.
 */

import { useMemo } from 'react';
import { useQueue } from '../../contexts/QueueContext';
import { useApp } from '../../contexts/AppContext';
import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';
import type { ChatProvider } from '../../features/chat/ProviderBadge';

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

    // New ChatPayload format: context.files[] replaces planFilePath/promptFilePath
    if (Array.isArray(payload.context?.files)) {
        for (const f of payload.context.files) {
            if (typeof f === 'string') candidates.push(f);
        }
    }
    if (typeof payload.planFilePath === 'string') {
        candidates.push(payload.planFilePath);
    }
    if (payload.data && typeof payload.data.originalTaskPath === 'string') {
        candidates.push(payload.data.originalTaskPath);
    }
    if (typeof payload.filePath === 'string') {
        candidates.push(payload.filePath);
    }

    const normalizedFolder = normalizePath(tasksFolder);
    const isAbsolute = normalizedFolder.startsWith('/') || /^[A-Za-z]:/.test(normalizedFolder);
    if (!wsRootPath && !isAbsolute) return null;
    const prefix = isAbsolute
        ? normalizedFolder + '/'
        : normalizePath(wsRootPath) + '/' + normalizedFolder + '/';

    for (const raw of candidates) {
        const norm = normalizePath(raw);
        if (prefix && norm.startsWith(prefix)) {
            const rel = norm.slice(prefix.length);
            if (rel) return rel;
        }
    }

    return null;
}

export interface QueueChatEntry {
    count: number;
    provider?: ChatProvider;
}

export type QueueChatMap = Record<string, QueueChatEntry>;
export type QueueFolderChatMap = Record<string, QueueChatEntry>;

export function useQueueChat(wsId: string, tasksFolder = '.vscode/tasks'): { fileMap: QueueChatMap; folderMap: QueueFolderChatMap } {
    const { state: queueState } = useQueue();
    const { state: appState } = useApp();

    return useMemo(() => {
        const ws = appState.workspaces.find((w: any) => w.id === wsId);
        if (!ws) return { fileMap: {} as QueueChatMap, folderMap: {} as QueueFolderChatMap };
        const wsRootPath: string = ws.rootPath || '';
        const map: QueueChatMap = {};

        // Prefer per-repo data from repoQueueMap (updated in real-time via WebSocket)
        // over top-level arrays (only populated on full page refresh).
        const repoEntry = queueState.repoQueueMap?.[wsId];
        const queued = repoEntry?.queued ?? queueState.queued ?? [];
        const running = repoEntry?.running ?? queueState.running ?? [];
        const activeItems = [...queued, ...running];

        for (const item of activeItems) {
            const rel = extractTaskPath(item, wsRootPath, tasksFolder);
            if (rel) {
                const provider = item?.payload?.provider as ChatProvider | undefined;
                const entry = map[rel];
                map[rel] = {
                    count: (entry?.count ?? 0) + 1,
                    provider: entry?.provider ?? provider,
                };
            }
        }

        const folderMap: QueueFolderChatMap = {};
        for (const [rel, entry] of Object.entries(map)) {
            const parts = rel.split('/');
            // accumulate for each ancestor folder prefix (exclude the filename itself)
            for (let i = 1; i < parts.length; i++) {
                const prefix = parts.slice(0, i).join('/');
                const folderEntry = folderMap[prefix];
                folderMap[prefix] = {
                    count: (folderEntry?.count ?? 0) + entry.count,
                    provider: folderEntry?.provider ?? entry.provider,
                };
            }
        }

        return { fileMap: map, folderMap };
    }, [queueState.queued, queueState.running, queueState.repoQueueMap, appState.workspaces, wsId, tasksFolder]);
}
