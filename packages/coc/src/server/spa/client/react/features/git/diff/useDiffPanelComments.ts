import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { isFileDiffComment, type DiffComment, type DiffCommentSelection } from '../../../../comments/diff-comment-types';
import { isDiffComment, type AnyComment } from '../../../../comments/shared-comment-types';
import type { TaskCommentCategory } from '../../../../comments/task-comments-types';

type PopupState = {
    position: { top: number; left: number };
    selection: DiffCommentSelection;
    selectedText: string;
} | null;

/** Transient comment UI belongs to one concrete owner/comparison/file, not to the mounted panel. */
export function useDiffPanelComments(
    identity: string,
    addComment: (selection: DiffCommentSelection, selectedText: string, text: string, category: TaskCommentCategory) => Promise<unknown>,
) {
    const [popupState, setPopupState] = useState<PopupState>(null);
    const [activePopoverComment, setActivePopoverComment] = useState<AnyComment | null>(null);
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
    const current = useRef({ identity, mounted: true, popupState });
    current.current.identity = identity;
    current.current.popupState = popupState;
    useEffect(() => {
        setPopupState(null);
        setActivePopoverComment(null);
        setPopoverPos(null);
    }, [identity]);
    useEffect(() => {
        current.current.mounted = true;
        return () => { current.current.mounted = false; };
    }, []);
    const handleAddComment = useCallback((selection: DiffCommentSelection, selectedText: string, position: { top: number; left: number }) => {
        setPopupState({ selection, selectedText, position });
    }, []);
    const handleCommentClick = useCallback((comment: DiffComment, event: MouseEvent) => {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        setPopoverPos({ top: rect.bottom + 8, left: Math.max(8, rect.left) });
        setActivePopoverComment(comment);
    }, []);
    const handlePopupSubmit = useCallback(async (text: string, category: TaskCommentCategory) => {
        if (!popupState) return;
        await addComment(popupState.selection, popupState.selectedText, text, category);
        if (current.current.mounted && current.current.identity === identity && current.current.popupState === popupState) {
            setPopupState(null);
        }
    }, [addComment, popupState, identity]);
    return { popupState, setPopupState, activePopoverComment, setActivePopoverComment, popoverPos,
        handleAddComment, handleCommentClick, handlePopupSubmit };
}

export function useRevealDiffComment(
    identity: string,
    containerRef: RefObject<HTMLDivElement | null>,
    editorRef: RefObject<{ revealComment(id: string): void } | null>,
    showEditor: boolean,
) {
    const highlights = useRef(new Map<HTMLElement, ReturnType<typeof setTimeout>>());
    useEffect(() => {
        const active = highlights.current;
        return () => {
            for (const [element, timer] of active) {
                clearTimeout(timer);
                element.classList.remove('ring-2', 'ring-yellow-400');
            }
            active.clear();
        };
    }, [identity]);
    return useCallback((comment: AnyComment) => {
        if (!isDiffComment(comment)) return;
        const fileCard = isFileDiffComment(comment)
            ? containerRef.current?.querySelector<HTMLElement>(`[data-file-comment-id="${comment.id.replace(/["\\]/g, '\\$&')}"]`)
            : null;
        if (!fileCard && showEditor) {
            editorRef.current?.revealComment(comment.id);
            return;
        }
        const line = comment.selection?.diffLineStart;
        const element = fileCard ?? (line == null ? null : containerRef.current?.querySelector<HTMLElement>(`[data-diff-line-index="${line}"]`));
        if (!element) return;
        if (fileCard) element.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        else element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clearTimeout(highlights.current.get(element));
        element.classList.add('ring-2', 'ring-yellow-400');
        highlights.current.set(element, setTimeout(() => {
            element.classList.remove('ring-2', 'ring-yellow-400');
            highlights.current.delete(element);
        }, 1500));
    }, [containerRef, editorRef, showEditor]);
}
