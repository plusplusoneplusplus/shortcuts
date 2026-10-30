import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { attachSelectionToChat } from '../../features/chat/activeChatAttach';
import { createFileSelectionContextPayload, type FileSelectionContextPayload } from '../../features/chat/sessionContextDrag';
import { isSessionContextAttachmentsEnabled } from '../../utils/config';
import { SELECTION_ACTION_BUTTON_CLASS, SelectionActionsGroup } from '../SelectionActionsGroup';
import { markdownPreviewSelectionLines } from './markdownSelectionContext';

export interface MarkdownSelectionAttachPillProps {
    /** The rendered preview; the pill is positioned against it, so render both in one positioned wrapper. */
    containerRef: RefObject<HTMLElement | null>;
    /** Raw file text the preview was rendered from, used to map selections back to source lines. */
    content: string;
    /** Plain server workspace id of the file owner. */
    workspaceId: string;
    /** Repo-relative path of the previewed file. */
    filePath: string;
    /** Concrete owner route, independent of the payload's server workspace ID. */
    destinationId?: string;
}

/**
 * "Attach as context" for a text selection in a rendered Markdown preview:
 * the Monaco editor pill's DOM-selection twin. It attaches the selected
 * excerpt with its raw-file line range through the shared file-selection flow.
 */
export function MarkdownSelectionAttachPill({ containerRef, content, workspaceId, filePath, destinationId = workspaceId }: MarkdownSelectionAttachPillProps) {
    const actionsRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [position, setPosition] = useState<{ left: number; top: number; maxWidth: number } | null>(null);
    const dismissedRef = useRef<Range | null>(null);
    const enabled = isSessionContextAttachmentsEnabled();
    const visible = !!position;

    const buildPayload = useCallback((): FileSelectionContextPayload | null => {
        const root = containerRef.current;
        const selection = root?.ownerDocument.getSelection();
        if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
        const range = selection.getRangeAt(0);
        const lines = markdownPreviewSelectionLines(content, root, range);
        return lines ? createFileSelectionContextPayload({ sourceWorkspaceId: workspaceId, filePath, range: lines, snippet: selection.toString() }) : null;
    }, [containerRef, content, workspaceId, filePath]);

    useLayoutEffect(() => {
        const node = actionsRef.current;
        if (!node) return;
        const { width, height } = node.getBoundingClientRect();
        setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    }, [visible]);

    // A new document or owner makes any dismissed selection stale.
    useEffect(() => { dismissedRef.current = null; }, [content, workspaceId, filePath, destinationId]);

    useEffect(() => {
        setPosition(null);
        const root = containerRef.current;
        if (!enabled || !root || !workspaceId) return;
        const doc = root.ownerDocument;
        const update = () => {
            const selection = doc.getSelection();
            const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
            if (!range || range.collapsed || !buildPayload()) {
                if (!actionsRef.current?.contains(doc.activeElement)) setPosition(null);
                return;
            }
            const dismissed = dismissedRef.current;
            if (dismissed && sameRange(dismissed, range)) {
                setPosition(null);
                return;
            }
            dismissedRef.current = null;
            const host = root.getBoundingClientRect();
            const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
            const end = rects && rects.length > 0 ? rects[rects.length - 1] : host;
            setPosition({
                left: Math.max(0, Math.min(end.right - host.left, host.width - (size.width || 150) - 8)),
                top: end.bottom - host.top + 2,
                maxWidth: Math.max(0, host.width - 8),
            });
        };
        doc.addEventListener('selectionchange', update);
        update();
        return () => doc.removeEventListener('selectionchange', update);
    }, [containerRef, content, workspaceId, filePath, destinationId, enabled, buildPayload, size]);

    if (!enabled || !position) return null;
    return (
        <SelectionActionsGroup ref={actionsRef} style={position} onDismiss={() => setPosition(null)}>
            <button type="button" className={SELECTION_ACTION_BUTTON_CLASS} onClick={() => {
                const payload = buildPayload();
                if (!payload) { setPosition(null); return; }
                const selection = containerRef.current?.ownerDocument.getSelection();
                // Keep the selection for copy, but do not offer it again until it changes.
                dismissedRef.current = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
                setPosition(null);
                attachSelectionToChat(destinationId, payload);
            }}>Attach as context</button>
        </SelectionActionsGroup>
    );
}

function sameRange(a: Range, b: Range): boolean {
    try {
        return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0;
    } catch {
        return false;
    }
}
