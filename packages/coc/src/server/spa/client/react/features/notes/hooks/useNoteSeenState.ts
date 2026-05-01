import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NoteTreeNode } from '../notesApi';

type SeenState = Record<string, string>;

export interface UseNoteSeenStateResult {
    isNoteUpdated: (node: NoteTreeNode) => boolean;
    markAsSeen: (notePath: string) => void;
    markAllAsSeen: (tree: NoteTreeNode[]) => void;
    syncSeenState: (tree: NoteTreeNode[]) => void;
}

function collectPages(nodes: NoteTreeNode[]): NoteTreeNode[] {
    const pages: NoteTreeNode[] = [];
    for (const node of nodes) {
        if (node.type === 'page') {
            pages.push(node);
        }
        if (node.children) {
            pages.push(...collectPages(node.children));
        }
    }
    return pages;
}

function getStorageKey(workspaceId: string): string {
    return `coc-notes-seen-${workspaceId}`;
}

function readSeenState(storageKey: string): { state: SeenState; existed: boolean } {
    if (typeof window === 'undefined') {
        return { state: {}, existed: false };
    }

    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
        return { state: {}, existed: false };
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { state: {}, existed: true };
        }

        const state: SeenState = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string') {
                state[key] = value;
            }
        }
        return { state, existed: true };
    } catch {
        return { state: {}, existed: true };
    }
}

function writeSeenState(storageKey: string, state: SeenState): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function compareIsoTimes(later: string | undefined, earlier: string | undefined): boolean {
    if (!later || !earlier) return false;
    const laterTime = Date.parse(later);
    const earlierTime = Date.parse(earlier);
    if (Number.isNaN(laterTime) || Number.isNaN(earlierTime)) return false;
    return laterTime > earlierTime;
}

function seenTimestampFor(node: NoteTreeNode): string {
    return node.lastModifiedAt ?? new Date().toISOString();
}

export function useNoteSeenState(workspaceId: string): UseNoteSeenStateResult {
    const storageKey = useMemo(() => getStorageKey(workspaceId), [workspaceId]);
    const initial = useMemo(() => readSeenState(storageKey), [storageKey]);
    const hasStoredStateRef = useRef(initial.existed);
    const [seenAt, setSeenAt] = useState<SeenState>(initial.state);

    useEffect(() => {
        hasStoredStateRef.current = initial.existed;
        setSeenAt(initial.state);
    }, [initial]);

    const persist = useCallback((next: SeenState) => {
        writeSeenState(storageKey, next);
        hasStoredStateRef.current = true;
    }, [storageKey]);

    const isNoteUpdated = useCallback((node: NoteTreeNode) => {
        if (node.type !== 'page') return false;
        return compareIsoTimes(node.lastModifiedAt, seenAt[node.path]);
    }, [seenAt]);

    const markAsSeen = useCallback((notePath: string) => {
        setSeenAt(prev => {
            const next = { ...prev, [notePath]: new Date().toISOString() };
            persist(next);
            return next;
        });
    }, [persist]);

    const markAllAsSeen = useCallback((tree: NoteTreeNode[]) => {
        const next: SeenState = {};
        for (const page of collectPages(tree)) {
            next[page.path] = seenTimestampFor(page);
        }
        setSeenAt(next);
        persist(next);
    }, [persist]);

    const syncSeenState = useCallback((tree: NoteTreeNode[]) => {
        setSeenAt(prev => {
            const next = hasStoredStateRef.current ? { ...prev } : {};
            let changed = !hasStoredStateRef.current;

            for (const page of collectPages(tree)) {
                if (!next[page.path]) {
                    next[page.path] = seenTimestampFor(page);
                    changed = true;
                }
            }

            if (changed) {
                persist(next);
                return next;
            }
            return prev;
        });
    }, [persist]);

    return { isNoteUpdated, markAsSeen, markAllAsSeen, syncSeenState };
}

