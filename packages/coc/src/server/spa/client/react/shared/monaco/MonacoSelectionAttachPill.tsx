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
}

/** Overlay coordinates are relative to the editor's positioned wrapper. */
export function MonacoSelectionAttachPill({ editor, workspaceId, destinationId = workspaceId, buildPayload, onComment }: MonacoSelectionAttachPillProps) {
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
            const end = editor.getScrolledVisiblePosition(selection.getEndPosition());
            const layout = editor.getLayoutInfo();
            if (!end || end.top < 0 || end.top + end.height + (size.height || 28) + 2 > layout.height
                || end.left < 0 || end.left > layout.contentLeft + layout.contentWidth) {
                setPosition(null);
                return;
            }
            setPosition({ left: Math.max(layout.contentLeft, Math.min(end.left, layout.width - (size.width || (onComment ? 230 : 150)) - 8)), top: end.top + end.height + 2, maxWidth: Math.max(0, layout.width - layout.contentLeft - 8) });
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
    }, [editor, workspaceId, destinationId, buildPayload, enabled, onComment, size]);

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
