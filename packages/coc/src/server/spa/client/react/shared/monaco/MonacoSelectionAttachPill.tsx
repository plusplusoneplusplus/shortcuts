import { useEffect, useRef, useState } from 'react';
import type { editor as MonacoEditor, Selection } from 'monaco-editor';
import { attachSelectionToChat } from '../../features/chat/activeChatAttach';
import type { SessionContextAttachmentDragPayload } from '../../features/chat/sessionContextDrag';
import { isSessionContextAttachmentsEnabled } from '../../utils/config';

export interface MonacoSelectionAttachPillProps {
    editor: MonacoEditor.ICodeEditor | null;
    workspaceId: string;
    /** Concrete owner route, independent of the payload's server workspace ID. */
    destinationId?: string;
    buildPayload: (selection: Selection, model: MonacoEditor.ITextModel) => SessionContextAttachmentDragPayload | null;
}

/** Overlay coordinates are relative to the editor's positioned wrapper. */
export function MonacoSelectionAttachPill({ editor, workspaceId, destinationId = workspaceId, buildPayload }: MonacoSelectionAttachPillProps) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
    const dismissRef = useRef<() => void>(() => {});
    const enabled = isSessionContextAttachmentsEnabled();

    useEffect(() => {
        setPosition(null);
        if (!enabled || !editor || !workspaceId) return;
        let dismissed = false;
        const update = () => {
            const selection = editor.getSelection();
            const model = editor.getModel();
            if (dismissed || (!editor.hasWidgetFocus() && document.activeElement !== buttonRef.current) || !selection || selection.isEmpty() || !model
                || !buildPayload(selection, model)) {
                setPosition(null);
                return;
            }
            const end = editor.getScrolledVisiblePosition(selection.getEndPosition());
            const layout = editor.getLayoutInfo();
            if (!end || end.top < 0 || end.top + end.height + 28 > layout.height
                || end.left < 0 || end.left > layout.contentLeft + layout.contentWidth) {
                setPosition(null);
                return;
            }
            setPosition({ left: Math.max(layout.contentLeft, Math.min(end.left, layout.width - 150)), top: end.top + end.height + 2 });
        };
        const listeners = [
            editor.onDidChangeCursorSelection(() => { dismissed = false; update(); }),
            editor.onDidScrollChange(update),
            editor.onDidLayoutChange(update),
            editor.onDidChangeModel(() => { dismissed = false; update(); }),
            editor.onDidBlurEditorWidget(() => {
                // Monaco's blur fires before the browser moves focus to the button.
                queueMicrotask(() => {
                    if (document.activeElement !== buttonRef.current) setPosition(null);
                });
            }),
        ];
        const dismiss = () => { dismissed = true; setPosition(null); };
        // The button mounts only once a selection is visible; keep dismissal in
        // a ref so scrolling cannot resurrect a successfully attached selection.
        dismissRef.current = dismiss;
        update();
        return () => { listeners.forEach(listener => listener.dispose()); dismissRef.current = () => {}; };
    }, [editor, workspaceId, destinationId, buildPayload, enabled]);

    if (!enabled || !position) return null;
    return (
        <button
            ref={buttonRef}
            type="button"
            className="pointer-events-auto absolute z-20 rounded-full border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 shadow dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            style={position}
            onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
            onBlur={() => setPosition(null)}
            onClick={() => {
                const selection = editor?.getSelection();
                const model = editor?.getModel();
                if (!selection || selection.isEmpty() || !model) return;
                const payload = buildPayload(selection, model);
                if (!payload) return;
                dismissRef.current();
                attachSelectionToChat(destinationId, payload);
            }}
        >Attach as context</button>
    );
}
