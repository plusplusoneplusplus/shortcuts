/**
 * PdfRegionAskLayer — drag-a-box "ask about a figure/equation" over a PDF
 * (Goal 4 AC-01, client capture half).
 *
 * The text-selection {@link PdfQuickAskLayer} can only ask about real glyphs, so
 * a figure, chart, or rendered equation is unreachable. This layer adds the
 * missing gesture: a ▢ toggle arms a rubber-band mode; the reader drags a box
 * over a page; on release the covered region is
 *
 *   1. cropped from the page's `<canvas>` to a PNG data URL ({@link captureRegion}),
 *   2. sent — with an optional question — to the same stateless
 *      `POST /api/quick-ask/answer` endpoint, which routes an `{image}` body to a
 *      vision-capable model (Goal 4 AC-01 server half), and
 *   3. persisted as a **region-only** dual-anchor annotation (no text quote) via
 *      the paper-annotations sidecar, so the box re-highlights on reload
 *      ({@link PdfAnnotationsLayer} paints it).
 *
 * It reuses the shared {@link QuickAskInput} (optional question) and
 * {@link QuickAskSidenotePopover} (answer) wholesale, and — like the Quick Ask
 * layer — the answer never enters a chat thread. Gated behind the same
 * `features.quickAskSidenotes` flag; a no-op without a `workspaceId`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { fetchApi } from '../../../../hooks/useApi';
import { useQuickAskSidenotesEnabled } from '../../../../hooks/feature-flags/useQuickAskSidenotesEnabled';
import { QuickAskInput } from '../../../chat/quick-ask/QuickAskInput';
import { QuickAskSidenotePopover } from '../../../chat/quick-ask/QuickAskSidenotePopover';
import type { ClientSideNote } from '../../../chat/quick-ask/types';
import { captureRegion, type RegionCapture, type RegionViewportBox } from './paperRegionCapture';
import { PAPER_ANNOTATION_PERSISTED_EVENT } from './usePaperAnnotations';

export interface PdfRegionAskLayerProps {
    /** The pdf.js render container whose page canvases the box is cropped from. */
    containerRef: React.RefObject<HTMLElement | null>;
    /** Workspace the answer endpoint runs against. Layer is a no-op when absent. */
    workspaceId?: string;
    /** The PDF this layer annotates (persistence target for the region anchor). */
    pdfUrl?: string;
    /** Live getter for the current note path (persistence target). */
    getNotePath?: () => string | null | undefined;
    /** Live getter for the current notes root id, if any. */
    getNoteRoot?: () => string | undefined;
}

function newId(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        /* ignore */
    }
    return 'tmp-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function labelFor(text: string): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    return collapsed.length <= 22 ? collapsed : collapsed.slice(0, 22).trimEnd() + '…';
}

/** Viewport box spanning two drag points. */
function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): RegionViewportBox {
    return {
        left: Math.min(a.x, b.x),
        top: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
    };
}

interface OpenNote {
    note: ClientSideNote;
    position: { top: number; left: number };
    /** The region this answer is about, kept for retry + persistence. */
    capture: RegionCapture;
    /** The custom question, if any (kept for retry). */
    question: string | undefined;
}

export function PdfRegionAskLayer({
    containerRef,
    workspaceId,
    pdfUrl,
    getNotePath,
    getNoteRoot,
}: PdfRegionAskLayerProps) {
    const enabled = useQuickAskSidenotesEnabled() && !!workspaceId;

    // ▢ region-select mode is armed / disarmed by the toggle.
    const [armed, setArmed] = useState(false);
    // Live rubber-band box (viewport coords) while dragging, else null.
    const [dragBox, setDragBox] = useState<RegionViewportBox | null>(null);
    // A captured region awaiting the optional question, else null.
    const [input, setInput] = useState<RegionCapture | null>(null);
    // The open answer popover, else null.
    const [open, setOpen] = useState<OpenNote | null>(null);

    const inputRef = useRef<RegionCapture | null>(null);
    inputRef.current = input;

    // Live persistence context — read at write time, never captured at mount.
    const persistRef = useRef({ pdfUrl, getNotePath, getNoteRoot });
    persistRef.current = { pdfUrl, getNotePath, getNoteRoot };

    // Best-effort: persist an answered region as a region-only annotation (no
    // text quote). No-op unless the host supplied a pdfUrl and a note path.
    const persistRegionAnnotation = useCallback((
        capture: RegionCapture,
        question: string | undefined,
        answer: string,
        model: string | undefined,
    ) => {
        if (!workspaceId) {return;}
        const { pdfUrl: url, getNotePath: notePathGetter, getNoteRoot: rootGetter } = persistRef.current;
        const notePath = notePathGetter?.();
        if (!url || !notePath) {return;}
        const path = `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/paper-annotations/annotation`;
        void fetchApi(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: notePath,
                root: rootGetter?.(),
                annotation: {
                    pdfUrl: url,
                    // Region-only anchor — a figure/equation has no text quote.
                    region: capture.region,
                    question,
                    answer,
                    model,
                },
            }),
        })
            .then(() => {
                // Let the read/render layer pick up the new annotation (it reloads
                // the sidecar and paints the region box).
                try {
                    window.dispatchEvent(new Event(PAPER_ANNOTATION_PERSISTED_EVENT));
                } catch {
                    /* environments without Event ctor: reload on next note open */
                }
            })
            .catch(() => {
                /* persistence is best-effort; the answer already shows */
            });
    }, [workspaceId]);

    // Run the one-shot vision lookup for a captured region, updating the note by id.
    const runVisionLookup = useCallback((
        capture: RegionCapture,
        question: string | undefined,
        noteId: string,
    ) => {
        if (!workspaceId) {return;}
        const path = `/api/quick-ask/answer?workspace=${encodeURIComponent(workspaceId)}`;
        fetchApi(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: capture.image,
                question,
                // Loose grounding: the selectable text on the region's page, if any.
                contextBefore: capture.pageText || undefined,
            }),
        })
            .then((data: { answer?: string; model?: string }) => {
                const answer = typeof data?.answer === 'string' ? data.answer : '';
                if (!answer) {throw new Error('Malformed response');}
                setOpen(prev => (prev && prev.note.id === noteId
                    ? { ...prev, note: { ...prev.note, status: 'ready', answer, model: data.model } }
                    : prev));
                persistRegionAnnotation(capture, question, answer, data.model);
            })
            .catch(() => {
                setOpen(prev => (prev && prev.note.id === noteId
                    ? { ...prev, note: { ...prev.note, status: 'error', error: 'Lookup failed' } }
                    : prev));
            });
    }, [workspaceId, persistRegionAnnotation]);

    // Begin a rubber-band drag from the armed capture surface. Document-level
    // move/up listeners track the box so the drag continues off the surface.
    const startRegionDrag = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const start = { x: e.clientX, y: e.clientY };
        setDragBox({ left: start.x, top: start.y, width: 0, height: 0 });

        const onMove = (ev: MouseEvent) => {
            setDragBox(boxBetween(start, { x: ev.clientX, y: ev.clientY }));
        };
        const onUp = (ev: MouseEvent) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            const box = boxBetween(start, { x: ev.clientX, y: ev.clientY });
            setDragBox(null);
            setArmed(false);
            const capture = captureRegion(containerRef.current, box);
            if (capture) {setInput(capture);}
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [containerRef]);

    // Escape disarms region mode without capturing.
    useEffect(() => {
        if (!armed) {return;}
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {setArmed(false);}
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [armed]);

    // Dismiss the pending question input on an outside pointer-down.
    useEffect(() => {
        if (!input) {return;}
        const onDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('[data-testid="quick-ask-input"]')) {return;}
            setInput(null);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [input]);

    // Submit the (optional) question: fire the vision lookup and open the popover
    // with an optimistic "asking" note anchored just below the region box.
    const submitInput = useCallback((question: string) => {
        const capture = inputRef.current;
        setInput(null);
        if (!capture) {return;}
        const trimmed = question.trim() || undefined;
        const id = newId();
        const note: ClientSideNote = {
            id,
            processId: '',
            turnIndex: 0,
            // A region has no text quote; the popover surfaces the question + answer.
            anchor: { selectedText: '', contextBefore: '', contextAfter: '', fingerprint: '' },
            question: trimmed,
            answer: '',
            label: trimmed ? labelFor(trimmed) : 'Figure region',
            createdAt: new Date().toISOString(),
            status: 'asking',
        };
        setOpen({
            note,
            position: { top: capture.rect.bottom + 6, left: capture.rect.left },
            capture,
            question: trimmed,
        });
        runVisionLookup(capture, trimmed, id);
    }, [runVisionLookup]);

    const cancelInput = useCallback(() => setInput(null), []);
    const closePopover = useCallback(() => setOpen(null), []);

    const handleCopy = useCallback((note: ClientSideNote) => {
        try {
            void navigator.clipboard?.writeText(note.answer);
        } catch {
            /* best-effort */
        }
    }, []);

    const handleRetry = useCallback((id: string) => {
        setOpen(prev => {
            if (!prev || prev.note.id !== id) {return prev;}
            runVisionLookup(prev.capture, prev.question, id);
            return { ...prev, note: { ...prev.note, status: 'asking', error: undefined } };
        });
    }, [runVisionLookup]);

    const handleDelete = useCallback(() => setOpen(null), []);

    if (!enabled) {return null;}

    return (
        <>
            <button
                type="button"
                className={`pdf-region-ask-toggle${armed ? ' is-armed' : ''}`}
                data-testid="pdf-region-ask-toggle"
                aria-pressed={armed}
                title={armed
                    ? 'Cancel — click, or press Esc'
                    : 'Ask about a figure or equation (drag a box over it)'}
                aria-label="Ask about a figure region"
                onClick={() => setArmed(a => !a)}
            >
                ▢ {armed ? 'Drag a box…' : 'Ask a figure'}
            </button>

            {armed && (
                <div
                    className="pdf-region-ask-surface"
                    data-testid="pdf-region-ask-surface"
                    onMouseDown={startRegionDrag}
                />
            )}

            {dragBox && ReactDOM.createPortal(
                <div
                    className="pdf-region-ask-marquee"
                    data-testid="pdf-region-ask-marquee"
                    style={{
                        position: 'fixed',
                        top: dragBox.top,
                        left: dragBox.left,
                        width: dragBox.width,
                        height: dragBox.height,
                        zIndex: 10004,
                        pointerEvents: 'none',
                    }}
                />,
                document.body,
            )}

            {input && (
                <QuickAskInput
                    rect={input.rect}
                    onSubmit={submitInput}
                    onCancel={cancelInput}
                />
            )}

            {open && (
                <QuickAskSidenotePopover
                    note={open.note}
                    position={open.position}
                    onClose={closePopover}
                    onCopy={handleCopy}
                    onRetry={handleRetry}
                    onDelete={handleDelete}
                />
            )}
        </>
    );
}
