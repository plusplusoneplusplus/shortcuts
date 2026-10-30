import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { editor as MonacoEditor, Selection } from 'monaco-editor';
import { attachSelectionToChat } from '../../features/chat/activeChatAttach';
import type { SessionContextAttachmentDragPayload } from '../../features/chat/sessionContextDrag';
import { isSessionContextAttachmentsEnabled } from '../../utils/config';
import { SELECTION_ACTION_BUTTON_CLASS, SelectionActionsGroup } from '../SelectionActionsGroup';

export interface MonacoSelectionAttachPillProps {
    editor: MonacoEditor.ICodeEditor | null;
    workspaceId: string;
    /** Concrete owner route, independent of the payload's server workspace ID. */
    destinationId?: string;
    onComment?: (selection: Selection, model: MonacoEditor.ITextModel, position: { top: number; left: number }) => void;
    buildPayload?: (selection: Selection, model: MonacoEditor.ITextModel) => SessionContextAttachmentDragPayload | null;
    /**
     * Keep the pill reachable while any part of the selection is in view:
     * flip above the end line when there is no room below it, and pin to the
     * bottom edge when the end is scrolled out of view.
     */
    keepInView?: boolean;
}

type VisiblePosition = { top: number; left: number; height: number };
type PillLayout = { width: number; height: number; contentLeft: number; contentWidth: number };

/** Pill coordinates for a selection, or null when it should not show. */
export function selectionPillPosition(
    start: VisiblePosition | null,
    end: VisiblePosition | null,
    layout: PillLayout,
    size: { width: number; height: number },
    keepInView: boolean,
): { left: number; top: number; maxWidth: number } | null {
    if (!end) return null;
    const pillHeight = size.height || 28;
    const left = Math.max(layout.contentLeft, Math.min(end.left, layout.width - (size.width || 150) - 8));
    const maxWidth = Math.max(0, layout.width - layout.contentLeft - 8);
    const below = end.top + end.height + 2;
    if (!keepInView) {
        if (end.top < 0 || below + pillHeight > layout.height
            || end.left < 0 || end.left > layout.contentLeft + layout.contentWidth) return null;
        return { left, top: below, maxWidth };
    }
    // Nothing selected is on screen: the selection ends above or starts below the viewport.
    if (end.top + end.height <= 0 || (start && start.top >= layout.height)) return null;
    const endVisible = end.top >= 0 && end.top + end.height <= layout.height;
    const top = endVisible && below + pillHeight <= layout.height ? below
        : endVisible && end.top - pillHeight - 2 >= 0 ? end.top - pillHeight - 2
        : Math.max(0, layout.height - pillHeight - 4);
    return { left, top, maxWidth };
}

/** Overlay coordinates are relative to the editor's positioned wrapper. */
export function MonacoSelectionAttachPill({ editor, workspaceId, destinationId = workspaceId, buildPayload, onComment, keepInView = false }: MonacoSelectionAttachPillProps) {
    const actionsRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [position, setPosition] = useState<{ left: number; top: number; maxWidth: number } | null>(null);
    const dismissRef = useRef<() => void>(() => {});
    const enabled = isSessionContextAttachmentsEnabled() && !!buildPayload;
    const visible = !!position;
    useLayoutEffect(() => {
        const node = actionsRef.current;
        if (!node) return;
        const measure = () => {
            const { width, height } = node.getBoundingClientRect();
            setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [visible, enabled, onComment]);

    useEffect(() => {
        setPosition(null);
        if ((!enabled && !onComment) || !editor || !workspaceId) return;
        let dismissed = false;
        const update = () => {
            const selection = editor.getSelection();
            const model = editor.getModel();
            if (dismissed || (!editor.hasWidgetFocus() && !actionsRef.current?.contains(document.activeElement)) || !selection || selection.isEmpty() || !model
                || (!onComment && !buildPayload?.(selection, model))) {
                setPosition(null);
                return;
            }
            const start = keepInView ? editor.getScrolledVisiblePosition(selection.getStartPosition()) : null;
            const end = editor.getScrolledVisiblePosition(selection.getEndPosition());
            const width = size.width || (onComment ? 230 : 150);
            setPosition(selectionPillPosition(start, end, editor.getLayoutInfo(), { width, height: size.height }, keepInView));
        };
        const listeners = [
            editor.onDidChangeCursorSelection(() => { dismissed = false; update(); }),
            editor.onDidFocusEditorWidget(update),
            editor.onDidScrollChange(update),
            editor.onDidLayoutChange(update),
            editor.onDidChangeModel(() => { dismissed = false; update(); }),
            editor.onDidBlurEditorWidget(() => {
                // Monaco's blur fires before the browser moves focus to the button.
                queueMicrotask(() => {
                    if (!actionsRef.current?.contains(document.activeElement)) setPosition(null);
                });
            }),
        ];
        const dismiss = () => { dismissed = true; setPosition(null); };
        // The button mounts only once a selection is visible; keep dismissal in
        // a ref so scrolling cannot resurrect a successfully attached selection.
        dismissRef.current = dismiss;
        update();
        return () => { listeners.forEach(listener => listener.dispose()); dismissRef.current = () => {}; };
    }, [editor, workspaceId, destinationId, buildPayload, enabled, onComment, size, keepInView]);

    if ((!enabled && !onComment) || !position) return null;
    return (
        <SelectionActionsGroup ref={actionsRef} style={position} onDismiss={() => setPosition(null)}>
            {onComment && <button type="button" className={SELECTION_ACTION_BUTTON_CLASS} onClick={event => {
                const selection = editor?.getSelection();
                const model = editor?.getModel();
                if (!selection || selection.isEmpty() || !model) return;
                const rect = event.currentTarget.getBoundingClientRect();
                dismissRef.current();
                onComment(selection, model, { top: rect.bottom + 4, left: rect.left });
            }}>Comment</button>}
            {enabled && <button type="button" className={SELECTION_ACTION_BUTTON_CLASS} onClick={() => {
                const selection = editor?.getSelection();
                const model = editor?.getModel();
                if (!selection || selection.isEmpty() || !model) return;
                const payload = buildPayload?.(selection, model);
                if (!payload) return;
                dismissRef.current();
                attachSelectionToChat(destinationId, payload);
            }}>Attach as context</button>}
        </SelectionActionsGroup>
    );
}
