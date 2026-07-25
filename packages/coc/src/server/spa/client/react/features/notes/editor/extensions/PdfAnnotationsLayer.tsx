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
import type { ClientSideNote } from '../../../chat/quick-ask/types';
import type { PaperAnnotation } from '../../../../../../../notes/paper-annotations-types';
import { usePaperAnnotations } from './usePaperAnnotations';
import {
    annotationsForPdf,
    clearAnnotationOverlays,
    paintAnnotationOverlay,
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

function labelFor(selectedText: string): string {
    const collapsed = selectedText.replace(/\s+/g, ' ').trim();
    return collapsed.length <= 22 ? collapsed : collapsed.slice(0, 22).trimEnd() + '…';
}

function toClientNote(ann: PaperAnnotation): ClientSideNote {
    return {
        id: ann.id,
        processId: '',
        turnIndex: 0,
        anchor: {
            selectedText: ann.quote.selectedText,
            contextBefore: ann.quote.contextBefore,
            contextAfter: ann.quote.contextAfter,
            fingerprint: '',
        },
        question: ann.question,
        answer: ann.answer,
        label: labelFor(ann.quote.selectedText),
        model: ann.model,
        createdAt: ann.createdAt,
        status: 'ready',
    };
}

interface OpenAnnotation {
    note: ClientSideNote;
    position: { top: number; left: number };
}

export function PdfAnnotationsLayer({
    containerRef,
    workspaceId,
    pdfUrl,
    getNotePath,
    getNoteRoot,
}: PdfAnnotationsLayerProps) {
    const enabled = useQuickAskSidenotesEnabled() && !!workspaceId;
    const { annotations, removeLocal } = usePaperAnnotations(
        workspaceId,
        getNotePath,
        getNoteRoot,
        enabled,
    );

    const [orphans, setOrphans] = useState<PaperAnnotation[]>([]);
    const [open, setOpen] = useState<OpenAnnotation | null>(null);
    const [exporting, setExporting] = useState(false);

    const forThisPdf = useMemo(
        () => annotationsForPdf(annotations, pdfUrl),
        [annotations, pdfUrl],
    );

    const openFromElement = useCallback((ann: PaperAnnotation, el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        setOpen({ note: toClientNote(ann), position: { top: rect.bottom + 6, left: rect.left } });
    }, []);

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
        for (const ann of forThisPdf) {
            let anchored = false;
            const label = labelFor(ann.quote.selectedText);
            if (ann.position) {
                const boxes = paintAnnotationOverlay(
                    container,
                    ann.id,
                    ann.position,
                    label,
                    el => openFromElement(ann, el),
                );
                if (boxes.length) {anchored = true;}
            }
            const res = resolveSidenoteAnchor(container, {
                selectedText: ann.quote.selectedText,
                contextBefore: ann.quote.contextBefore,
                contextAfter: ann.quote.contextAfter,
                fingerprint: '',
            });
            if (res.located) {
                injectInlineChip(container, res.range, {
                    id: ann.id,
                    label,
                    onActivate: chip => openFromElement(ann, chip),
                });
                anchored = true;
            }
            if (!anchored) {nextOrphans.push(ann);}
        }
        setOrphans(nextOrphans);
    }, [containerRef, enabled, forThisPdf, openFromElement]);

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

    const handleCopy = useCallback((note: ClientSideNote) => {
        try {
            void navigator.clipboard?.writeText(note.answer);
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
                            title={ann.quote.selectedText}
                            onClick={e => openFromElement(ann, e.currentTarget)}
                        >
                            💡 {labelFor(ann.quote.selectedText)}
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
                />
            )}
        </>
    );
}
