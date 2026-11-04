import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

interface SelectionSnapshot {
    text: string;
    start: Node;
    end: Node;
    startOffset: number;
    endOffset: number;
    rects: DOMRect[];
}

function sameSelection(a: SelectionSnapshot | null, b: SelectionSnapshot | null): boolean {
    return !!a && !!b && a.text === b.text && a.start === b.start && a.end === b.end
        && a.startOffset === b.startOffset && a.endOffset === b.endOffset;
}

/** Textareas expose offsets but no Range geometry. Mirror their typography and wrapping off screen. */
function textareaRects(editor: HTMLTextAreaElement): DOMRect[] {
    const doc = editor.ownerDocument;
    const win = doc.defaultView!;
    const mirror = doc.createElement('div');
    const style = win.getComputedStyle(editor);
    const bounds = editor.getBoundingClientRect();
    for (const property of ['box-sizing', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
        'letter-spacing', 'tab-size', 'text-align', 'text-indent', 'direction', 'padding', 'border-width', 'border-style']) {
        mirror.style.setProperty(property, style.getPropertyValue(property));
    }
    Object.assign(mirror.style, {
        position: 'fixed', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word', left: `${bounds.left}px`, top: `${bounds.top}px`,
        width: `${bounds.width}px`,
    });
    // Match the text viewport, including a native vertical scrollbar.
    if (editor.clientWidth) mirror.style.width = `${editor.clientWidth + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0)}px`;
    const text = doc.createTextNode(editor.value + '\u200b');
    mirror.appendChild(text);
    doc.body.appendChild(mirror);
    try {
        const range = doc.createRange();
        range.setStart(text, editor.selectionStart);
        range.setEnd(text, editor.selectionEnd);
        return typeof range.getClientRects === 'function'
            ? Array.from(range.getClientRects(), rect => new DOMRect(rect.x - editor.scrollLeft, rect.y - editor.scrollTop, rect.width, rect.height))
            : [];
    } finally {
        mirror.remove();
    }
}

/** Native Markdown selection lifecycle; actions share the editor pill's focus/pointer behavior. */
export function useCanvasSelection({ containerRef, contentRef, actionsRef, documentKey, enabled, editing, onSelectionChange, onComment, onAttach }: {
    containerRef: RefObject<HTMLDivElement>;
    contentRef: RefObject<HTMLDivElement>;
    actionsRef: RefObject<HTMLDivElement>;
    documentKey: string;
    enabled: boolean;
    editing: boolean;
    onSelectionChange: (text: string | null) => void;
    onComment: (text: string) => void;
    onAttach: (text: string) => void;
}) {
    const [position, setPosition] = useState<{ left: number; top: number; maxWidth: number } | null>(null);
    const dismissed = useRef<SelectionSnapshot | null>(null);
    const latest = useRef<SelectionSnapshot | null>(null);
    const updateRef = useRef<() => void>(() => {});
    const readRef = useRef<() => SelectionSnapshot | null>(() => null);
    const changeRef = useRef(onSelectionChange);
    changeRef.current = onSelectionChange;

    useLayoutEffect(() => {
        latest.current = null;
        if (!enabled) { setPosition(null); return; }
        const root = contentRef.current;
        const container = containerRef.current;
        if (!root || !container) return;
        const doc = root.ownerDocument;
        const win = doc.defaultView!;
        const viewport = win.visualViewport;
        let active = false;
        const read = (): SelectionSnapshot | null => {
            if (editing) {
                const editor = root.querySelector('textarea');
                if (!editor || (doc.activeElement !== editor && !actionsRef.current?.contains(doc.activeElement))) return null;
                const text = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
                return text ? { text, start: editor, end: editor, startOffset: editor.selectionStart, endOffset: editor.selectionEnd, rects: textareaRects(editor) } : null;
            }
            const selection = doc.getSelection();
            let range: Range;
            if (!selection || !selection.rangeCount || selection.isCollapsed) {
                const previous = latest.current;
                if (!actionsRef.current?.contains(doc.activeElement) || !previous
                    || !root.contains(previous.start) || !root.contains(previous.end)) return null;
                range = doc.createRange();
                try {
                    range.setStart(previous.start, previous.startOffset);
                    range.setEnd(previous.end, previous.endOffset);
                } catch { return null; }
                if (range.toString().trim() !== previous.text) return null;
            } else range = selection.getRangeAt(0);
            if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
            const text = range.toString().trim();
            return text ? { text, start: range.startContainer, end: range.endContainer,
                startOffset: range.startOffset, endOffset: range.endOffset,
                rects: typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [] } : null;
        };
        const hide = () => { setPosition(null); changeRef.current(null); };
        // Content, mode and owner changes revoke even a retained native selection.
        dismissed.current = read();
        hide();
        readRef.current = read;
        const update = () => {
            const selection = read();
            if (!selection) {
                dismissed.current = null;
                latest.current = null;
                hide();
                return;
            }
            if (sameSelection(dismissed.current, selection)) { hide(); return; }
            dismissed.current = null;
            latest.current = selection;
            const host = container.getBoundingClientRect();
            const content = root.getBoundingClientRect();
            let left = Math.max(host.left, content.left, viewport?.offsetLeft ?? 0);
            let top = Math.max(host.top, content.top, viewport?.offsetTop ?? 0);
            let right = Math.min(host.right, content.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? win.innerWidth));
            let bottom = Math.min(host.bottom, content.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? win.innerHeight));
            // A canvas can itself live in a scrolling/narrow host.
            for (let node = container.parentElement; node; node = node.parentElement) {
                const style = win.getComputedStyle(node);
                const bounds = node.getBoundingClientRect();
                if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
                if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
            }
            const rects = selection.rects.filter(rect => rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right);
            const end = rects.at(-1);
            if (!end || right <= left || bottom <= top) { hide(); return; }
            const size = actionsRef.current?.getBoundingClientRect();
            const width = size?.width || 230;
            const height = size?.height || 28;
            const below = end.bottom + 2;
            setPosition({
                left: Math.max(left + 4, Math.min(end.right, right - width - 4)) - host.left,
                top: Math.max(top, Math.min(below + height <= bottom ? below : end.top - height - 2, bottom - height)) - host.top,
                maxWidth: Math.max(0, right - left - 8),
            });
            changeRef.current(selection.text);
        };
        const onSelect = () => { active = true; update(); };
        const onLayout = () => { if (active) update(); };
        const onBlur = (event: FocusEvent) => {
            if (actionsRef.current?.contains(event.relatedTarget as Node) || root.contains(event.relatedTarget as Node)) return;
            dismissed.current = read() ?? latest.current;
            hide();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { dismissed.current = read(); hide(); }
        };
        updateRef.current = onLayout;
        doc.addEventListener('selectionchange', onSelect);
        root.addEventListener('select', onSelect, true);
        root.addEventListener('pointerup', onSelect);
        root.addEventListener('keyup', onSelect);
        root.addEventListener('focusout', onBlur);
        container.addEventListener('keydown', onKey);
        doc.addEventListener('scroll', onLayout, true);
        win.addEventListener('resize', onLayout);
        viewport?.addEventListener('resize', onLayout);
        viewport?.addEventListener('scroll', onLayout);
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onLayout);
        observer?.observe(container);
        return () => {
            readRef.current = () => null;
            updateRef.current = () => {};
            doc.removeEventListener('selectionchange', onSelect);
            root.removeEventListener('select', onSelect, true);
            root.removeEventListener('pointerup', onSelect);
            root.removeEventListener('keyup', onSelect);
            root.removeEventListener('focusout', onBlur);
            container.removeEventListener('keydown', onKey);
            doc.removeEventListener('scroll', onLayout, true);
            win.removeEventListener('resize', onLayout);
            viewport?.removeEventListener('resize', onLayout);
            viewport?.removeEventListener('scroll', onLayout);
            observer?.disconnect();
        };
    }, [containerRef, contentRef, actionsRef, documentKey, enabled, editing]);

    // Measure again after mount/wrapping, just like the Monaco selection pill.
    useEffect(() => {
        const node = actionsRef.current;
        if (!node || !position) return;
        updateRef.current();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => updateRef.current());
        observer?.observe(node);
        return () => observer?.disconnect();
    }, [!!position, actionsRef]);

    const dismiss = () => {
        dismissed.current = readRef.current() ?? latest.current;
        setPosition(null);
        changeRef.current(null);
    };
    const actOnSelection = (action: (text: string) => void) => {
        const current = readRef.current();
        if (!current || sameSelection(dismissed.current, current)) return;
        action(current.text);
        dismiss();
    };
    return { position, dismiss, comment: () => actOnSelection(onComment), attach: () => actOnSelection(onAttach) };
}
