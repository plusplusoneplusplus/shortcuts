/**
 * PdfAnnotationsLayer — re-render persisted paper annotations back onto a PDF
 * (Goal 2 read/render half).
 *
 * On note load it fetches the per-note paper-annotations sidecar
 * ({@link usePaperAnnotations}) and, for every annotation belonging to this PDF,
 * re-resolves the dual anchor against the live pdf.js render:
 *
 *  - the text-quote selector via the shared {@link resolveSidenoteAnchor} → a
 *    persistent margin 💡 chip injected at the passage (AC-03), and
 *  - the `{page, rects}` geometric anchor → pixel-accurate overlay highlight
 *    boxes on the page (AC-02 fallback / visible highlight).
 *
 * Clicking either reopens the stored answer in the shared
 * {@link QuickAskSidenotePopover}. Annotations that resolve to neither (the PDF
 * re-extracted differently and the page is gone) are never silently dropped —
 * they fall back to a visible list (AC-04).
 *
 * The pdf.js pages render asynchronously, so a {@link MutationObserver} re-runs
 * resolution as pages/text-layers appear. Gated behind the same
 * `features.quickAskSidenotes` flag; a no-op without a workspace.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchApi } from '../../../../hooks/useApi';
import { useQuickAskSidenotesEnabled } from '../../../../hooks/feature-flags/useQuickAskSidenotesEnabled';
import { QuickAskSidenotePopover } from '../../../chat/quick-ask/QuickAskSidenotePopover';
import { resolveSidenoteAnchor } from '../../../chat/quick-ask/sidenoteAnchoring';
import { clearInlineChips, injectInlineChip } from '../../../chat/quick-ask/sidenoteInlineChips';
import type { ClientSideNote, QuickAskTurn } from '../../../chat/quick-ask/types';
import type { PaperAnnotation, PaperAnnotationTurn } from '../../../../../../../notes/paper-annotations-types';
import { usePaperAnnotations } from './usePaperAnnotations';
import {
    annotationsForPdf,
    clearAnnotationOverlays,
    paintAnnotationOverlay,
    regionToRectAnchor,
} from './paperAnnotationRender';
import {
    downloadMarkdown,
    exportAnnotationsFilename,
    paperAnnotationsExportUrl,
    type PaperAnnotationsExportResponse,
} from './paperAnnotationsExport';

export interface PdfAnnotationsLayerProps {
    /** The pdf.js text-layer container the annotations were captured against. */
    containerRef: React.RefObject<HTMLElement | null>;
    /** Workspace the sidecar endpoint runs against. No-op when absent. */
    workspaceId?: string;
    /** The PDF this layer renders annotations for. No-op when absent. */
    pdfUrl?: string;
    /** Live getter for the current note path (sidecar target). */
    getNotePath?: () => string | null | undefined;
    /** Live getter for the current notes root id, if any. */
    getNoteRoot?: () => string | undefined;
}

/** Soft cap on follow-up turns per thread (AC-02), mirroring the ask layers. */
const MAX_TURNS = 10;

/** One ordered prior Q/A turn sent as grounding history on a follow-up (AC-01). */
type HistoryTurn = { question?: string; answer: string };

function labelFor(selectedText: string): string {
    const collapsed = selectedText.replace(/\s+/g, ' ').trim();
    return collapsed.length <= 22 ? collapsed : collapsed.slice(0, 22).trimEnd() + '…';
}

/**
 * Reconstruct the full multi-turn thread from a persisted annotation (AC-03).
 * Prefers the stored `turns` array; falls back to the single top-level
 * `question`/`answer` pair so a legacy single-answer annotation still opens as a
 * one-turn thread.
 */
function annotationTurns(ann: PaperAnnotation): QuickAskTurn[] {
    if (ann.turns && ann.turns.length) {
        return ann.turns.map(t => ({ question: t.question, answer: t.answer, status: 'ready' as const }));
    }
    return [{ question: ann.question, answer: ann.answer, status: 'ready' as const }];
}

/**
 * A short display label for an annotation's chip / overlay / orphan entry. A
 * region annotation (Goal 4 AC-01) has no text quote, so fall back to its
 * question, then a generic "Figure region" marker.
 */
function annotationLabel(ann: PaperAnnotation): string {
    if (ann.quote?.selectedText) {return labelFor(ann.quote.selectedText);}
    if (ann.question) {return labelFor(ann.question);}
    return 'Figure region';
}

function toClientNote(ann: PaperAnnotation): ClientSideNote {
    return {
        id: ann.id,
        processId: '',
        turnIndex: 0,
        anchor: {
            selectedText: ann.quote?.selectedText ?? '',
            contextBefore: ann.quote?.contextBefore ?? '',
            contextAfter: ann.quote?.contextAfter ?? '',
            fingerprint: '',
        },
        question: ann.question,
        answer: ann.answer,
        label: annotationLabel(ann),
        model: ann.model,
        createdAt: ann.createdAt,
        status: 'ready',
    };
}

interface OpenAnnotation {
    note: ClientSideNote;
    position: { top: number; left: number };
    /** The full multi-turn thread reconstructed from the annotation (AC-03). */
    turns: QuickAskTurn[];
    /**
     * Grounding for follow-ups: the original selection ± surrounding context.
     * Absent for a region-only annotation, which stays one-shot (no reply row).
     */
    grounding: { selectedText: string; contextBefore: string; contextAfter: string } | null;
}

/** Immutably patch turn `turnIndex` of the open thread and sync note-level
 * status/answer to the latest turn. No-op when the open id doesn't match. */
function patchTurn(
    prev: OpenAnnotation | null,
    id: string,
    turnIndex: number,
    patch: Partial<QuickAskTurn>,
): OpenAnnotation | null {
    if (!prev || prev.note.id !== id || !prev.turns[turnIndex]) {return prev;}
    const turns = prev.turns.map((t, i) => (i === turnIndex ? { ...t, ...patch } : t));
    const latest = turns[turns.length - 1];
    return {
        ...prev,
        turns,
        note: { ...prev.note, status: latest.status, answer: latest.answer, error: latest.error },
    };
}

/** Prior ready turns, in order, as follow-up grounding history. */
function historyBefore(turns: QuickAskTurn[], upto: number): HistoryTurn[] {
    return turns.slice(0, upto)
        .filter(t => t.status === 'ready')
        .map(t => ({ question: t.question, answer: t.answer }));
}

/** Accumulated ready turns as the `turns` array persisted to the sidecar. */
function readyTurns(turns: QuickAskTurn[]): PaperAnnotationTurn[] {
    return turns
        .filter(t => t.status === 'ready')
        .map(t => ({ question: t.question, answer: t.answer }));
}

/** Which annotations the reader shows. Resolved are hidden by default (AC-02). */
type AnnotationFilter = 'open' | 'resolved' | 'all';

export function PdfAnnotationsLayer({
    containerRef,
    workspaceId,
    pdfUrl,
    getNotePath,
    getNoteRoot,
}: PdfAnnotationsLayerProps) {
    const enabled = useQuickAskSidenotesEnabled() && !!workspaceId;
    const { annotations, removeLocal, setResolved, setTurns } = usePaperAnnotations(
        workspaceId,
        getNotePath,
        getNoteRoot,
        enabled,
    );

    const [orphans, setOrphans] = useState<PaperAnnotation[]>([]);
    const [open, setOpen] = useState<OpenAnnotation | null>(null);
    const [exporting, setExporting] = useState(false);
    const [filter, setFilter] = useState<AnnotationFilter>('open');

    // Latest open thread, read at answer-landing time to fold in the freshly
    // answered turn when persisting (state updates lag one render).
    const openRef = useRef<OpenAnnotation | null>(null);
    openRef.current = open;

    const forThisPdf = useMemo(
        () => annotationsForPdf(annotations, pdfUrl),
        [annotations, pdfUrl],
    );
    const openCount = useMemo(() => forThisPdf.filter(a => !a.resolved).length, [forThisPdf]);
    const resolvedCount = forThisPdf.length - openCount;

    // Annotations actually painted for the current filter. Resolved ones are
    // hidden under the default 'open' filter (AC-02).
    const visible = useMemo(
        () => forThisPdf.filter(a =>
            filter === 'all' ? true : filter === 'resolved' ? !!a.resolved : !a.resolved),
        [forThisPdf, filter],
    );

    // Resolved state of the annotation whose answer is currently open, so the
    // popover can offer Resolve vs Reopen.
    const openResolved = useMemo(
        () => (open ? !!annotations.find(a => a.id === open.note.id)?.resolved : false),
        [open, annotations],
    );

    const openFromElement = useCallback((ann: PaperAnnotation, el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        // Follow-ups need a text selection to re-ground each turn; a region-only
        // annotation (vision ask) has none, so it stays a one-shot read.
        const grounding = ann.quote?.selectedText
            ? {
                selectedText: ann.quote.selectedText,
                contextBefore: ann.quote.contextBefore,
                contextAfter: ann.quote.contextAfter,
            }
            : null;
        setOpen({
            note: toClientNote(ann),
            position: { top: rect.bottom + 6, left: rect.left },
            turns: annotationTurns(ann),
            grounding,
        });
    }, []);

    // Run one stateless grounded follow-up turn on a reopened annotation (AC-03),
    // updating that turn in place and re-persisting the accumulated thread to the
    // sidecar via `setTurns`. Grounding = the original selection ± context plus the
    // prior ready turns as history. Reopened threads have no persisted full-paper
    // flag, so follow-ups fall back to selection-only grounding.
    const postTurn = useCallback((
        id: string,
        question: string,
        history: HistoryTurn[],
        turnIndex: number,
        grounding: { selectedText: string; contextBefore: string; contextAfter: string },
    ) => {
        if (!workspaceId) {return;}
        const path = `/api/quick-ask/answer?workspace=${encodeURIComponent(workspaceId)}`;
        fetchApi(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                selectedText: grounding.selectedText,
                contextBefore: grounding.contextBefore,
                contextAfter: grounding.contextAfter,
                question,
                ...(history.length ? { history } : {}),
            }),
        })
            .then((data: { answer?: string; model?: string }) => {
                const answer = typeof data?.answer === 'string' ? data.answer : '';
                if (!answer) {throw new Error('Malformed response');}
                // Persist the whole thread (fold this just-answered turn in — the
                // setOpen below hasn't landed yet, so read openRef and patch it).
                const current = openRef.current;
                if (current && current.note.id === id) {
                    const persistTurns = readyTurns(current.turns.map((t, i) =>
                        (i === turnIndex ? { ...t, answer, status: 'ready' as const } : t)));
                    setTurns(id, persistTurns);
                }
                setOpen(prev => patchTurn(prev, id, turnIndex, { status: 'ready', answer, error: undefined }));
            })
            .catch(() => {
                setOpen(prev => patchTurn(prev, id, turnIndex, { status: 'error', error: 'Lookup failed' }));
            });
    }, [workspaceId, setTurns]);

    // Send a follow-up (AC-02): append an asking turn and post it with the
    // accumulated ready turns as grounding history. Blocked at the soft cap.
    const handleSend = useCallback((question: string) => {
        setOpen(prev => {
            if (!prev || !prev.grounding || prev.turns.length >= MAX_TURNS) {return prev;}
            const turnIndex = prev.turns.length;
            postTurn(prev.note.id, question, historyBefore(prev.turns, turnIndex), turnIndex, prev.grounding);
            const turns: QuickAskTurn[] = [...prev.turns, { question, answer: '', status: 'asking' }];
            return { ...prev, turns, note: { ...prev.note, status: 'asking' } };
        });
    }, [postTurn]);

    // Per-turn retry (AC-02): re-run turn `turnIndex` with its question and the
    // prior ready turns as history, preserving the rest of the thread.
    const handleReplyRetry = useCallback((turnIndex: number) => {
        setOpen(prev => {
            if (!prev || !prev.grounding) {return prev;}
            const turn = prev.turns[turnIndex];
            if (!turn || turnIndex === 0) {return prev;} // turn 0 is a persisted answer, never retried
            postTurn(prev.note.id, turn.question ?? '', historyBefore(prev.turns, turnIndex), turnIndex, prev.grounding);
            const turns = prev.turns.map((t, i) =>
                (i === turnIndex ? { ...t, status: 'asking' as const, error: undefined } : t));
            return { ...prev, turns, note: { ...prev.note, status: 'asking', error: undefined } };
        });
    }, [postTurn]);

    // Re-resolve every annotation against the current DOM: overlay boxes for the
    // geometric anchor, a margin chip for a quote match, else an orphan.
    const rerender = useCallback(() => {
        const container = containerRef.current;
        if (!container) {return;}
        clearInlineChips(container);
        clearAnnotationOverlays(container);
        if (!enabled) {
            setOrphans([]);
            return;
        }
        const nextOrphans: PaperAnnotation[] = [];
        for (const ann of visible) {
            let anchored = false;
            const label = annotationLabel(ann);
            if (ann.position) {
                const boxes = paintAnnotationOverlay(
                    container,
                    ann.id,
                    ann.position,
                    label,
                    el => openFromElement(ann, el),
                );
                if (boxes.length) {
                    // Resolved highlights are shown greyed-out (AC-02).
                    if (ann.resolved) {
                        boxes.forEach(b => b.classList.add('paper-annotation-overlay-resolved'));
                    }
                    anchored = true;
                }
            }
            // Region anchor (figure/equation drag-a-box, Goal 4 AC-01) → a single
            // overlay box reusing the same percentage-geometry paint path, tagged
            // with a region class so it reads as a box rather than a text tint.
            if (ann.region) {
                const boxes = paintAnnotationOverlay(
                    container,
                    ann.id,
                    regionToRectAnchor(ann.region),
                    label,
                    el => openFromElement(ann, el),
                );
                if (boxes.length) {
                    boxes.forEach(b => b.classList.add('paper-annotation-overlay-region'));
                    if (ann.resolved) {
                        boxes.forEach(b => b.classList.add('paper-annotation-overlay-resolved'));
                    }
                    anchored = true;
                }
            }
            // Text-quote anchor — a region-only annotation has none, so skip the
            // (textContent-based) resolver when there is no quote to locate.
            if (ann.quote?.selectedText) {
                const res = resolveSidenoteAnchor(container, {
                    selectedText: ann.quote.selectedText,
                    contextBefore: ann.quote.contextBefore,
                    contextAfter: ann.quote.contextAfter,
                    fingerprint: '',
                });
                if (res.located) {
                    const chip = injectInlineChip(container, res.range, {
                        id: ann.id,
                        label,
                        fullText: ann.quote.selectedText,
                        onActivate: chip => openFromElement(ann, chip),
                    });
                    if (chip && ann.resolved) {
                        chip.classList.add('paper-annotation-chip-resolved');
                    }
                    anchored = true;
                }
            }
            if (!anchored) {nextOrphans.push(ann);}
        }
        setOrphans(nextOrphans);
    }, [containerRef, enabled, visible, openFromElement]);

    // Run resolution now and whenever the pdf.js render mutates (pages arrive
    // asynchronously). The observer is disconnected while we inject our own
    // chips/overlays so those mutations never re-trigger it (no loop).
    useEffect(() => {
        const container = containerRef.current;
        if (!container) {return;}
        if (!enabled) {
            clearInlineChips(container);
            clearAnnotationOverlays(container);
            setOrphans([]);
            return;
        }
        let timer: ReturnType<typeof setTimeout> | null = null;
        const observer = new MutationObserver(() => {
            if (timer) {return;}
            timer = setTimeout(() => {
                timer = null;
                observer.disconnect();
                rerender();
                observer.observe(container, { childList: true, subtree: true });
            }, 30);
        });
        observer.disconnect();
        rerender();
        observer.observe(container, { childList: true, subtree: true });
        return () => {
            if (timer) {clearTimeout(timer);}
            observer.disconnect();
            clearInlineChips(container);
            clearAnnotationOverlays(container);
        };
    }, [enabled, rerender, containerRef]);

    const closePopover = useCallback(() => setOpen(null), []);

    const handleCopy = useCallback((note: ClientSideNote, text?: string) => {
        try {
            void navigator.clipboard?.writeText(text ?? note.answer);
        } catch {
            /* best-effort */
        }
    }, []);

    // Ready annotations never enter the error state, so retry is inert here.
    const handleRetry = useCallback(() => { /* no-op for persisted answers */ }, []);

    // Dismiss = delete the persisted annotation (best-effort) + prune locally so
    // its chip/overlay is removed on the next resolve pass.
    const handleDelete = useCallback((id: string) => {
        const notePath = getNotePath?.();
        if (workspaceId && notePath) {
            const params = new URLSearchParams({ path: notePath });
            const root = getNoteRoot?.();
            if (root) {params.set('root', root);}
            const path = `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/paper-annotations/annotation/${encodeURIComponent(id)}?${params.toString()}`;
            void fetchApi(path, { method: 'DELETE' }).catch(() => { /* best-effort */ });
        }
        removeLocal(id);
        setOpen(null);
    }, [workspaceId, getNotePath, getNoteRoot, removeLocal]);

    // Resolve / reopen the annotation (Goal 4 AC-02). The hook updates local
    // state optimistically and PATCHes the sidecar; the popover closes itself.
    const handleToggleResolved = useCallback((id: string, resolved: boolean) => {
        setResolved(id, resolved);
    }, [setResolved]);

    // Export this note's paper annotations (all papers) as a downloaded `.md`.
    // The server route renders the full sidecar; offered once per paper that has
    // annotations. Best-effort — a failed fetch just leaves nothing downloaded.
    const handleExport = useCallback(() => {
        const notePath = getNotePath?.();
        if (!workspaceId || !notePath) {return;}
        setExporting(true);
        const url = paperAnnotationsExportUrl(workspaceId, notePath, getNoteRoot?.());
        fetchApi(url)
            .then((data: PaperAnnotationsExportResponse) => {
                downloadMarkdown(exportAnnotationsFilename(notePath), data?.markdown ?? '');
            })
            .catch(() => { /* best-effort */ })
            .finally(() => setExporting(false));
    }, [workspaceId, getNotePath, getNoteRoot]);

    if (!enabled) {return null;}

    return (
        <>
            {forThisPdf.length > 0 && (
                <div className="paper-annotation-actions" data-testid="paper-annotation-actions">
                    <div
                        className="paper-annotation-filter"
                        data-testid="paper-annotation-filter"
                        role="group"
                        aria-label="Filter paper annotations"
                    >
                        <button
                            type="button"
                            className={`paper-annotation-filter-btn${filter === 'open' ? ' is-active' : ''}`}
                            data-testid="paper-annotation-filter-open"
                            aria-pressed={filter === 'open'}
                            onClick={() => setFilter('open')}
                        >
                            Open ({openCount})
                        </button>
                        <button
                            type="button"
                            className={`paper-annotation-filter-btn${filter === 'resolved' ? ' is-active' : ''}`}
                            data-testid="paper-annotation-filter-resolved"
                            aria-pressed={filter === 'resolved'}
                            onClick={() => setFilter('resolved')}
                        >
                            Resolved ({resolvedCount})
                        </button>
                        <button
                            type="button"
                            className={`paper-annotation-filter-btn${filter === 'all' ? ' is-active' : ''}`}
                            data-testid="paper-annotation-filter-all"
                            aria-pressed={filter === 'all'}
                            onClick={() => setFilter('all')}
                        >
                            All ({forThisPdf.length})
                        </button>
                    </div>
                    <button
                        type="button"
                        className="paper-annotation-export"
                        data-testid="paper-annotations-export"
                        title="Export all paper annotations for this note to Markdown"
                        onClick={handleExport}
                        disabled={exporting}
                    >
                        ⬇ {exporting ? 'Exporting…' : 'Export annotations'}
                    </button>
                </div>
            )}

            {orphans.length > 0 && (
                <div className="paper-annotation-orphans" data-testid="paper-annotation-orphans">
                    <div className="paper-annotation-orphans-title">
                        Unresolved annotations ({orphans.length})
                    </div>
                    {orphans.map(ann => (
                        <button
                            key={ann.id}
                            type="button"
                            className="paper-annotation-orphan-item"
                            data-testid="paper-annotation-orphan-item"
                            title={ann.quote?.selectedText ?? annotationLabel(ann)}
                            onClick={e => openFromElement(ann, e.currentTarget)}
                        >
                            💡 {annotationLabel(ann)}
                        </button>
                    ))}
                </div>
            )}

            {open && (
                <QuickAskSidenotePopover
                    note={open.note}
                    position={open.position}
                    onClose={closePopover}
                    onCopy={handleCopy}
                    onRetry={handleRetry}
                    onDelete={handleDelete}
                    resolve={{ resolved: openResolved, onToggle: handleToggleResolved }}
                    reply={open.grounding ? {
                        turns: open.turns,
                        onSend: handleSend,
                        onRetry: handleReplyRetry,
                        disabled: open.turns.some(t => t.status === 'asking'),
                        atCap: open.turns.length >= MAX_TURNS,
                        maxTurns: MAX_TURNS,
                    } : undefined}
                />
            )}
        </>
    );
}
