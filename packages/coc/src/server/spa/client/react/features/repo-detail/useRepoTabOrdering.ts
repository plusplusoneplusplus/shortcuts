/**
 * useRepoTabOrdering — owns repo-tab ordering state and mechanics.
 *
 * Loads/saves/resets the persisted global `repoTabOrder` (and reads
 * `gitGroupOrder`), drives customize mode, and carries all drag/drop reordering
 * plus the polite live-region messages. The pure order math lives in
 * `../../repos/repoOrder`; this hook is the stateful shell around it, kept
 * separate from the tab-strip view so reordering can be reasoned about on its
 * own.
 */

import { useCallback, useEffect, useState, type DragEvent as ReactDragEvent, type MutableRefObject } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { moveRepoTabOrder, moveRepoTabOrderToIndex, sanitizeRepoTabOrder } from '../../repos/repoOrder';
import type { ToastContextValue } from '../../contexts/ToastContext';
import { getHorizontalDropPosition, getVerticalDropPosition, REPO_TAB_DRAG_MIME } from './repoTabModel';

export type RepoDropIndicator = { targetId: string; position: 'before' | 'after' } | null;

export interface UseRepoTabOrderingArgs {
    /** All repo ids (unordered) — used to sanitize saved orders. */
    repoIds: string[];
    /**
     * Ref to the repo ids in their currently-rendered flat order — used for move
     * math at event time. A ref (not a value) because the flat order is derived
     * from this hook's own `repoTabOrder`, so reading it through a ref avoids a
     * render-time dependency cycle and keeps the drag callbacks stable.
     */
    allRepoIdsRef: MutableRefObject<string[]>;
    /** Global toast surface for persistence failures. */
    toast: ToastContextValue | null;
}

export interface UseRepoTabOrderingResult {
    groupOrder: string[];
    repoTabOrder: string[] | undefined;
    customizeRepoTabs: boolean;
    setCustomizeRepoTabs: (value: boolean) => void;
    draggedRepoId: string | null;
    repoDropIndicator: RepoDropIndicator;
    repoLiveMessage: string;
    enterCustomizeRepoTabs: () => void;
    resetRepoTabOrder: () => Promise<void>;
    moveRepoToIndex: (repoId: string, targetIndex: number) => void;
    startRepoDrag: (event: ReactDragEvent<HTMLElement>, repoId: string) => void;
    updateRepoDropTarget: (event: ReactDragEvent<HTMLElement>, targetId: string, orientation: 'horizontal' | 'vertical') => void;
    dropRepoOnTarget: (event: ReactDragEvent<HTMLElement>, targetId: string, orientation: 'horizontal' | 'vertical') => void;
    cancelRepoDrag: () => void;
}

export function useRepoTabOrdering({ repoIds, allRepoIdsRef, toast }: UseRepoTabOrderingArgs): UseRepoTabOrderingResult {
    const [groupOrder, setGroupOrder] = useState<string[]>([]);
    const [repoTabOrder, setRepoTabOrder] = useState<string[] | undefined>();
    const [customizeRepoTabs, setCustomizeRepoTabs] = useState(false);
    const [draggedRepoId, setDraggedRepoId] = useState<string | null>(null);
    const [repoDropIndicator, setRepoDropIndicator] = useState<RepoDropIndicator>(null);
    const [repoLiveMessage, setRepoLiveMessage] = useState('');

    useEffect(() => {
        let cancelled = false;
        getSpaCocClient().preferences.getGlobal().then((prefs) => {
            if (!cancelled) {
                if (Array.isArray(prefs?.gitGroupOrder)) {
                    setGroupOrder(prefs.gitGroupOrder);
                }
                setRepoTabOrder(Array.isArray(prefs?.repoTabOrder) ? prefs.repoTabOrder : undefined);
            }
        }).catch((error) => {
            if (!cancelled) {
                console.warn('Failed to load repo tab preferences', error);
            }
        });
        return () => { cancelled = true; };
    }, []);

    const persistRepoTabOrder = useCallback(async (nextOrder: string[]) => {
        const sanitized = sanitizeRepoTabOrder(nextOrder, repoIds);
        setRepoTabOrder(sanitized);
        try {
            await getSpaCocClient().preferences.patchGlobal({ repoTabOrder: sanitized });
        } catch (error) {
            console.warn('Failed to save repo tab order', error);
            toast?.addToast(`${getSpaCocClientErrorMessage(error, 'Failed to save repo tab order')}. The order will stay for this session and retry on the next reorder.`, 'error');
        }
    }, [repoIds, toast]);

    const finishRepoReorder = useCallback((nextOrder: string[]) => {
        setDraggedRepoId(null);
        setRepoDropIndicator(null);
        void persistRepoTabOrder(nextOrder);
        setRepoLiveMessage('Repository tab order updated.');
    }, [persistRepoTabOrder]);

    const resetRepoTabOrder = useCallback(async () => {
        setRepoTabOrder(undefined);
        try {
            const prefs = await getSpaCocClient().preferences.getGlobal();
            const { repoTabOrder: _repoTabOrder, ...rest } = prefs;
            await getSpaCocClient().preferences.replaceGlobal(rest);
            setCustomizeRepoTabs(false);
            toast?.addToast('Repo tab order reset', 'success');
            setRepoLiveMessage('Repository tab order reset.');
        } catch (error) {
            console.warn('Failed to reset repo tab order', error);
            toast?.addToast(getSpaCocClientErrorMessage(error, 'Failed to reset repo tab order'), 'error');
        }
    }, [toast]);

    const enterCustomizeRepoTabs = useCallback(() => {
        setCustomizeRepoTabs(true);
        setRepoLiveMessage('Repo tab customize mode started.');
    }, []);

    useEffect(() => {
        const handler = () => enterCustomizeRepoTabs();
        window.addEventListener('coc-customize-repo-tabs', handler);
        return () => window.removeEventListener('coc-customize-repo-tabs', handler);
    }, [enterCustomizeRepoTabs]);

    useEffect(() => {
        if (!customizeRepoTabs && !draggedRepoId) {
            return;
        }
        const handler = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }
            event.preventDefault();
            setDraggedRepoId(null);
            setRepoDropIndicator(null);
            setCustomizeRepoTabs(false);
            setRepoLiveMessage('Repo tab customize mode finished.');
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [customizeRepoTabs, draggedRepoId]);

    const moveRepoToIndex = useCallback((repoId: string, targetIndex: number) => {
        finishRepoReorder(moveRepoTabOrderToIndex(allRepoIdsRef.current, repoId, targetIndex));
    }, [allRepoIdsRef, finishRepoReorder]);

    const startRepoDrag = useCallback((event: ReactDragEvent<HTMLElement>, repoId: string) => {
        if (!customizeRepoTabs) {
            return;
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(REPO_TAB_DRAG_MIME, repoId);
        event.dataTransfer.setData('text/plain', repoId);
        setDraggedRepoId(repoId);
    }, [customizeRepoTabs]);

    const updateRepoDropTarget = useCallback((event: ReactDragEvent<HTMLElement>, targetId: string, orientation: 'horizontal' | 'vertical') => {
        if (!draggedRepoId || draggedRepoId === targetId) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setRepoDropIndicator({
            targetId,
            position: orientation === 'horizontal' ? getHorizontalDropPosition(event) : getVerticalDropPosition(event),
        });
    }, [draggedRepoId]);

    const dropRepoOnTarget = useCallback((event: ReactDragEvent<HTMLElement>, targetId: string, orientation: 'horizontal' | 'vertical') => {
        if (!draggedRepoId || draggedRepoId === targetId) {
            setDraggedRepoId(null);
            setRepoDropIndicator(null);
            return;
        }
        event.preventDefault();
        const sourceId = event.dataTransfer.getData(REPO_TAB_DRAG_MIME) || event.dataTransfer.getData('text/plain') || draggedRepoId;
        const position = repoDropIndicator?.targetId === targetId
            ? repoDropIndicator.position
            : (orientation === 'horizontal' ? getHorizontalDropPosition(event) : getVerticalDropPosition(event));
        finishRepoReorder(moveRepoTabOrder(allRepoIdsRef.current, sourceId, targetId, position));
    }, [allRepoIdsRef, draggedRepoId, finishRepoReorder, repoDropIndicator]);

    const cancelRepoDrag = useCallback(() => {
        setDraggedRepoId(null);
        setRepoDropIndicator(null);
    }, []);

    return {
        groupOrder,
        repoTabOrder,
        customizeRepoTabs,
        setCustomizeRepoTabs,
        draggedRepoId,
        repoDropIndicator,
        repoLiveMessage,
        enterCustomizeRepoTabs,
        resetRepoTabOrder,
        moveRepoToIndex,
        startRepoDrag,
        updateRepoDropTarget,
        dropRepoOnTarget,
        cancelRepoDrag,
    };
}
