/**
 * PdfAnnotationsLayer — Goal 2 read/render half.
 *
 * On note load it GETs the paper-annotations sidecar and re-resolves each
 * annotation for this PDF against the live pdf.js DOM: a quote match → margin
 * chip, a `{page,rects}` anchor → overlay boxes, neither → orphan list. Clicking
 * reopens the stored answer; dismiss deletes it. These tests use the real
 * resolver / chip / overlay primitives against a hand-built container and mock
 * only `fetchApi` and the feature flag.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { useRef } from 'react';

const { fetchApiMock, enabledMock } = vi.hoisted(() => ({
    fetchApiMock: vi.fn(),
    enabledMock: vi.fn(() => true),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: fetchApiMock,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useQuickAskSidenotesEnabled', () => ({
    useQuickAskSidenotesEnabled: () => enabledMock(),
}));

import { PdfAnnotationsLayer }
    from '../../../../src/server/spa/client/react/features/notes/editor/extensions/PdfAnnotationsLayer';
import { PAPER_ANNOTATION_PERSISTED_EVENT }
    from '../../../../src/server/spa/client/react/features/notes/editor/extensions/usePaperAnnotations';
import type { PaperAnnotation }
    from '../../../../src/server/notes/paper-annotations-types';

const PDF_URL = 'https://arxiv.org/pdf/1802.05799';
const PAGE_TEXT = 'the paper describes a ring all-reduce communication pattern';

function annotation(partial: Partial<PaperAnnotation> & { id: string }): PaperAnnotation {
    return {
        createdAt: '2026-07-25T00:00:00.000Z',
        pdfUrl: PDF_URL,
        quote: {
            selectedText: 'ring all-reduce',
            contextBefore: 'describes a ',
            contextAfter: ' communication',
        },
        answer: 'A bandwidth-optimal collective.',
        ...partial,
    };
}

/** Sidecar-shaped GET response for the given annotations. */
function sidecar(...anns: PaperAnnotation[]) {
    const map: Record<string, PaperAnnotation> = {};
    for (const a of anns) {map[a.id] = a;}
    return { version: 1, annotations: map };
}

function Harness({ omitWorkspace = false }: { omitWorkspace?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div>
            {/* A minimal pdf.js-like page: text for the quote resolver + a page
                wrapper for overlay geometry. */}
            <div ref={ref} data-testid="pdf-container">
                <div className="pdfjs-page" data-page-number="2">
                    <div className="textLayer">{PAGE_TEXT}</div>
                </div>
            </div>
            <PdfAnnotationsLayer
                containerRef={ref as unknown as React.RefObject<HTMLElement | null>}
                workspaceId={omitWorkspace ? undefined : 'ws-1'}
                pdfUrl={PDF_URL}
                getNotePath={() => 'papers/deep.md'}
                getNoteRoot={() => undefined}
            />
        </div>
    );
}

beforeEach(() => {
    fetchApiMock.mockReset();
    fetchApiMock.mockResolvedValue(sidecar());
    enabledMock.mockReset();
    enabledMock.mockReturnValue(true);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('PdfAnnotationsLayer — load + re-resolve (AC-02/AC-03)', () => {
    it('GETs the sidecar for the note on mount', async () => {
        render(<Harness />);
        await waitFor(() => expect(fetchApiMock).toHaveBeenCalled());
        const [path, opts] = fetchApiMock.mock.calls[0];
        expect(path).toContain('/api/workspaces/ws-1/notes/paper-annotations');
        expect(path).toContain('path=papers%2Fdeep.md');
        expect(opts).toBeUndefined(); // plain GET
    });

    it('resolves the text quote to a margin 💡 chip', async () => {
        fetchApiMock.mockResolvedValue(sidecar(annotation({ id: 'a1' })));
        render(<Harness />);
        await waitFor(() =>
            expect(screen.getByTestId('quick-ask-chip-inline')).toBeInTheDocument());
        expect(screen.getByTestId('quick-ask-chip-inline').getAttribute('data-sidenote-id')).toBe('a1');
    });

    it('paints overlay boxes from the {page,rects} anchor', async () => {
        fetchApiMock.mockResolvedValue(sidecar(annotation({
            id: 'a1',
            position: { page: 2, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }] },
        })));
        render(<Harness />);
        await waitFor(() =>
            expect(screen.getByTestId('paper-annotation-overlay')).toBeInTheDocument());
    });

    it('ignores annotations belonging to a different PDF', async () => {
        fetchApiMock.mockResolvedValue(sidecar(
            annotation({ id: 'other', pdfUrl: 'https://elsewhere/x.pdf' }),
        ));
        render(<Harness />);
        await waitFor(() => expect(fetchApiMock).toHaveBeenCalled());
        await act(async () => { await new Promise(r => setTimeout(r, 60)); });
        expect(screen.queryByTestId('quick-ask-chip-inline')).toBeNull();
        expect(screen.queryByTestId('paper-annotation-orphans')).toBeNull();
    });
});

describe('PdfAnnotationsLayer — orphan fallback (AC-04)', () => {
    it('lists an annotation whose quote is gone and has no page anchor', async () => {
        fetchApiMock.mockResolvedValue(sidecar(annotation({
            id: 'orphan',
            quote: { selectedText: 'text that is not on this page', contextBefore: '', contextAfter: '' },
        })));
        render(<Harness />);
        await waitFor(() =>
            expect(screen.getByTestId('paper-annotation-orphans')).toBeInTheDocument());
        expect(screen.getByTestId('paper-annotation-orphan-item')).toBeInTheDocument();
        expect(screen.queryByTestId('quick-ask-chip-inline')).toBeNull();
    });
});

describe('PdfAnnotationsLayer — reopen + dismiss', () => {
    it('clicking the chip reopens the stored answer in the popover', async () => {
        fetchApiMock.mockResolvedValue(sidecar(annotation({ id: 'a1', question: 'What is it?' })));
        render(<Harness />);
        const chip = await screen.findByTestId('quick-ask-chip-inline');
        fireEvent.click(chip);
        expect(await screen.findByTestId('quick-ask-popover')).toBeInTheDocument();
        expect(screen.getByTestId('quick-ask-popover-answer')).toHaveTextContent('bandwidth-optimal');
        expect(screen.getByTestId('quick-ask-popover-question')).toHaveTextContent('What is it?');
    });

    it('dismiss deletes the annotation and removes its chip', async () => {
        fetchApiMock.mockResolvedValue(sidecar(annotation({ id: 'a1' })));
        render(<Harness />);
        const chip = await screen.findByTestId('quick-ask-chip-inline');
        fireEvent.click(chip);
        const dismiss = await screen.findByTestId('quick-ask-popover-dismiss');

        fetchApiMock.mockResolvedValue(undefined); // DELETE
        fireEvent.click(dismiss);

        await waitFor(() => {
            const del = fetchApiMock.mock.calls.find(
                ([, o]) => (o as RequestInit | undefined)?.method === 'DELETE');
            expect(del).toBeTruthy();
            expect(del![0]).toContain('/paper-annotations/annotation/a1');
        });
        await waitFor(() => expect(screen.queryByTestId('quick-ask-chip-inline')).toBeNull());
    });
});

describe('PdfAnnotationsLayer — export annotations (Goal 4 AC-03)', () => {
    it('shows the export button once the paper has an annotation', async () => {
        fetchApiMock.mockResolvedValue(sidecar(annotation({ id: 'a1' })));
        render(<Harness />);
        expect(await screen.findByTestId('paper-annotations-export')).toBeInTheDocument();
    });

    it('hides the export button when the paper has no annotations', async () => {
        fetchApiMock.mockResolvedValue(sidecar()); // empty
        render(<Harness />);
        await waitFor(() => expect(fetchApiMock).toHaveBeenCalled());
        await act(async () => { await new Promise(r => setTimeout(r, 40)); });
        expect(screen.queryByTestId('paper-annotations-export')).toBeNull();
    });

    it('GETs the export route and downloads the returned markdown on click', async () => {
        fetchApiMock.mockResolvedValue(sidecar(annotation({ id: 'a1' })));

        // jsdom does not implement the blob-URL primitives; stub them so the
        // transient <a download> click path runs without throwing.
        const createObjectURL = vi.fn(() => 'blob:paper');
        const revokeObjectURL = vi.fn();
        (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
        (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
        const clickSpy = vi
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {});

        render(<Harness />);
        const exportBtn = await screen.findByTestId('paper-annotations-export');

        fetchApiMock.mockResolvedValue({ markdown: '# Paper annotations\n', count: 1 });
        fireEvent.click(exportBtn);

        await waitFor(() => {
            const call = fetchApiMock.mock.calls.find(([p]) =>
                String(p).includes('/paper-annotations/export'));
            expect(call).toBeTruthy();
            expect(String(call![0])).toContain('path=papers%2Fdeep.md');
        });
        await waitFor(() => expect(clickSpy).toHaveBeenCalled());
        expect(createObjectURL).toHaveBeenCalled();
        expect(revokeObjectURL).toHaveBeenCalled();

        delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
        delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    });
});

describe('PdfAnnotationsLayer — reload + gating', () => {
    it('reloads the sidecar when a new annotation is persisted', async () => {
        render(<Harness />);
        await waitFor(() => expect(fetchApiMock).toHaveBeenCalledTimes(1));
        fetchApiMock.mockResolvedValue(sidecar(annotation({ id: 'fresh' })));
        act(() => { window.dispatchEvent(new Event(PAPER_ANNOTATION_PERSISTED_EVENT)); });
        await waitFor(() =>
            expect(screen.getByTestId('quick-ask-chip-inline')).toBeInTheDocument());
    });

    it('is a no-op with no workspace', async () => {
        render(<Harness omitWorkspace />);
        await act(async () => { await new Promise(r => setTimeout(r, 40)); });
        expect(fetchApiMock).not.toHaveBeenCalled();
    });

    it('is a no-op when the flag is off', async () => {
        enabledMock.mockReturnValue(false);
        render(<Harness />);
        await act(async () => { await new Promise(r => setTimeout(r, 40)); });
        expect(fetchApiMock).not.toHaveBeenCalled();
    });
});
