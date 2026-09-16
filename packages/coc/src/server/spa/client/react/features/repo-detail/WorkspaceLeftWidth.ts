import { useCallback, useSyncExternalStore } from 'react';
import {
    LEFT_RAIL_WIDTH,
    readLeftCollapsed,
    splitWorkspaceLeftCollapsedStorageKey,
} from './WorkspaceLeftCollapse';

export const LEFT_COLUMN_MIN_WIDTH = 240;
export const LEFT_COLUMN_MAX_WIDTH = 640;
export const LEFT_COLUMN_INITIAL_WIDTH = 360;

/** localStorage key for the left column's overall width, per workspace. */
export function splitWorkspaceWidthStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:left-width`;
}

const liveWidths = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

function readPersistedWidth(workspaceId: string): number | undefined {
    try {
        const value = localStorage.getItem(splitWorkspaceWidthStorageKey(workspaceId));
        if (value === null) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    } catch {
        return undefined;
    }
}

/** Read the live rendered width, falling back to the workspace's persisted layout. */
export function readWorkspaceLeftWidth(workspaceId: string): number {
    const liveWidth = liveWidths.get(workspaceId);
    if (liveWidth !== undefined) return liveWidth;
    if (readLeftCollapsed(splitWorkspaceLeftCollapsedStorageKey(workspaceId))) return LEFT_RAIL_WIDTH;
    return readPersistedWidth(workspaceId) ?? LEFT_COLUMN_INITIAL_WIDTH;
}

function notify(workspaceId: string): void {
    listeners.get(workspaceId)?.forEach(listener => listener());
}

/** Publish the rendered desktop width without duplicating its localStorage persistence. */
export function setWorkspaceLeftWidth(workspaceId: string, px: number): void {
    if (liveWidths.get(workspaceId) === px) return;
    liveWidths.set(workspaceId, px);
    notify(workspaceId);
}

/** Drop a view's live value so future readers fall back to persisted layout state. */
export function clearWorkspaceLeftWidth(workspaceId: string): void {
    if (!liveWidths.delete(workspaceId)) return;
    notify(workspaceId);
}

function subscribe(workspaceId: string, listener: () => void): () => void {
    let workspaceListeners = listeners.get(workspaceId);
    if (!workspaceListeners) {
        workspaceListeners = new Set();
        listeners.set(workspaceId, workspaceListeners);
    }
    workspaceListeners.add(listener);
    return () => {
        workspaceListeners!.delete(listener);
        if (workspaceListeners!.size === 0) listeners.delete(workspaceId);
    };
}

/** Live left-column width for a workspace, with persistence-aware first render. */
export function useWorkspaceLeftWidth(workspaceId: string): number {
    return useSyncExternalStore(
        useCallback(listener => subscribe(workspaceId, listener), [workspaceId]),
        () => readWorkspaceLeftWidth(workspaceId),
        () => LEFT_COLUMN_INITIAL_WIDTH,
    );
}
