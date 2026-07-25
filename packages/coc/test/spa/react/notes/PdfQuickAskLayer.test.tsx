/**
 * PdfQuickAskLayer — Goal 1 client half.
 *
 * Wires the shared Quick Ask pill / Cmd+J / popover to a PDF text-layer
 * selection and POSTs to the stateless `POST /api/quick-ask/answer` endpoint
 * (no persistence, no chat thread). These tests mock the selection reader, the
 * feature flag, and `fetchApi`, then drive the pill→input→answer flow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';

const { getSelectionMock, fetchApiMock, enabledMock, geomMock } = vi.hoisted(() => ({
    getSelectionMock: vi.fn(),
    fetchApiMock: vi.fn(),
    enabledMock: vi.fn(() => true),
    geomMock: vi.fn(() => null as unknown),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/quick-ask/quick-ask-selection', () => ({
    getQuickAskSelection: getSelectionMock,
    deriveContext: () => ({ contextBefore: '', contextAfter: '' }),
    isSelectableText: () => true,
    MIN_SELECTION_CHARS: 2,
    CONTEXT_CHARS: 80,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: fetchApiMock,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useQuickAskSidenotesEnabled', () => ({
    useQuickAskSidenotesEnabled: () => enabledMock(),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/extensions/paperAnchorGeometry', () => ({
    extractPaperRectAnchor: (...args: unknown[]) => geomMock(...(args as [])),
}));

import { PdfQuickAskLayer }
    from '../../../../src/server/spa/client/react/features/notes/editor/extensions/PdfQuickAskLayer';
import type { QuickAskSelection }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

const SELECTION: QuickAskSelection = {
    turnIndex: 0,
    selectedText: 'ring all-reduce',
    contextBefore: 'the paper describes a ',
    contextAfter: ' communication pattern',
    rect: { top: 200, left: 120, bottom: 220, right: 260 },
};

/** `omitWorkspace` renders the layer with no workspaceId at all (default-param
 *  fallback would otherwise turn an explicit `undefined` back into 'ws-1'). */
function Harness({
    workspaceId = 'ws-1',
    omitWorkspace = false,
    pdfUrl,
    notePath,
    noteRoot,
}: {
    workspaceId?: string;
    omitWorkspace?: boolean;
    pdfUrl?: string;
    notePath?: string | null;
    noteRoot?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div>
            <div ref={ref} data-testid="pdf-container">the paper describes a ring all-reduce communication pattern</div>
            <PdfQuickAskLayer
                containerRef={ref as unknown as React.RefObject<HTMLElement | null>}
                workspaceId={omitWorkspace ? undefined : workspaceId}
                pdfUrl={pdfUrl}
                getNotePath={() => notePath}
                getNoteRoot={() => noteRoot}
            />
        </div>
    );
}

const field = () => screen.getByTestId('quick-ask-input-field') as HTMLInputElement;

beforeEach(() => {
    getSelectionMock.mockReset();
    getSelectionMock.mockReturnValue(SELECTION);
    fetchApiMock.mockReset();
    enabledMock.mockReset();
    enabledMock.mockReturnValue(true);
    geomMock.mockReset();
    geomMock.mockReturnValue(null);
});

afterEach(() => {
    // Explicitly unmount so each component's document-level selection listeners
    // (and portaled pill/popover nodes) are torn down before the next test —
    // otherwise a leftover live listener re-raises a pill on the next mouseUp.
    cleanup();
    vi.restoreAllMocks();
});

/** Raise the pill by simulating a pointer selection in the PDF container. */
async function raisePill() {
    fireEvent.mouseUp(document);
    await waitFor(() => expect(screen.getByTestId('quick-ask-pill')).toBeInTheDocument());
}

describe('PdfQuickAskLayer — AC-01 pill + Cmd/Ctrl+J', () => {
    it('raises the ✨ Ask AI pill on a text-layer selection', async () => {
        render(<Harness />);
        await raisePill();
        expect(screen.getByTestId('quick-ask-pill')).toBeInTheDocument();
    });

    it('clicking the pill expands into the question input (no lookup yet)', async () => {
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument();
        expect(screen.queryByTestId('quick-ask-pill')).toBeNull();
        expect(fetchApiMock).not.toHaveBeenCalled();
    });

    it('Cmd/Ctrl+J on a selection opens the input directly', async () => {
        render(<Harness />);
        fireEvent.keyDown(document, { key: 'j', ctrlKey: true });
        await waitFor(() => expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument());
        expect(fetchApiMock).not.toHaveBeenCalled();
    });
});

describe('PdfQuickAskLayer — AC-02/AC-03/AC-04 ask → answer', () => {
    it('submitting posts selection+context+question to the stateless endpoint and shows the answer', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'It is a bandwidth-optimal collective.', model: 'm1' });
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));

        fireEvent.change(field(), { target: { value: '  what is this?  ' } });
        fireEvent.keyDown(field(), { key: 'Enter' });

        // AC-04: goes to the stateless answer endpoint, never a chat process route.
        expect(fetchApiMock).toHaveBeenCalledTimes(1);
        const [path, opts] = fetchApiMock.mock.calls[0];
        expect(path).toBe('/api/quick-ask/answer?workspace=ws-1');
        expect(path).not.toContain('/processes/');
        expect(opts.method).toBe('POST');
        const body = JSON.parse(opts.body);
        // AC-03: selection ± page context forwarded; question trimmed.
        expect(body).toEqual({
            selectedText: 'ring all-reduce',
            contextBefore: 'the paper describes a ',
            contextAfter: ' communication pattern',
            question: 'what is this?',
        });

        // AC-02: answer shown in the shared side-note popover.
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());
        expect(screen.getByTestId('quick-ask-popover-answer').textContent)
            .toContain('bandwidth-optimal collective');
    });

    it('empty question submits with question undefined (default-explain fast path)', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'A.', model: 'm1' });
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));

        fireEvent.keyDown(field(), { key: 'Enter' });

        const body = JSON.parse(fetchApiMock.mock.calls[0][1].body);
        expect(body.question).toBeUndefined();
    });

    it('shows the asking state before the answer resolves', async () => {
        let resolvePost: (v: unknown) => void = () => {};
        fetchApiMock.mockImplementationOnce(() => new Promise(res => { resolvePost = res; }));
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        fireEvent.keyDown(field(), { key: 'Enter' });

        expect(screen.getByTestId('quick-ask-popover-loading')).toBeInTheDocument();
        resolvePost({ answer: 'done', model: 'm1' });
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());
    });

    it('renders an error with retry when the lookup fails, and retry re-posts', async () => {
        fetchApiMock.mockRejectedValueOnce(new Error('boom'));
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        fireEvent.keyDown(field(), { key: 'Enter' });

        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-error')).toBeInTheDocument());

        fetchApiMock.mockResolvedValueOnce({ answer: 'recovered', model: 'm1' });
        fireEvent.click(screen.getByTestId('quick-ask-popover-retry'));
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());
        expect(fetchApiMock).toHaveBeenCalledTimes(2);
    });

    it('treats a missing answer field as a failure', async () => {
        fetchApiMock.mockResolvedValueOnce({ model: 'm1' });
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        fireEvent.keyDown(field(), { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-error')).toBeInTheDocument());
    });
});

describe('PdfQuickAskLayer — Goal 2 persistence (write path)', () => {
    const RECT_ANCHOR = { page: 3, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }] };

    /** Drive pill → input → submit and wait for the answer to render. */
    async function askAndAnswer(props: Parameters<typeof Harness>[0]) {
        render(<Harness {...props} />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        fireEvent.keyDown(field(), { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());
    }

    it('persists a dual-anchor annotation to the sidecar after the answer resolves', async () => {
        geomMock.mockReturnValue(RECT_ANCHOR);
        fetchApiMock.mockResolvedValueOnce({ answer: 'A bandwidth-optimal collective.', model: 'm1' });
        fetchApiMock.mockResolvedValueOnce({ annotation: { id: 'a1' } });

        await askAndAnswer({ pdfUrl: 'paper.pdf', notePath: 'notes/paper.md', noteRoot: 'r1' });

        // Two calls: the stateless answer, then the sidecar persist.
        await waitFor(() => expect(fetchApiMock).toHaveBeenCalledTimes(2));
        const [path, opts] = fetchApiMock.mock.calls[1];
        expect(path).toBe('/api/workspaces/ws-1/notes/paper-annotations/annotation');
        expect(opts.method).toBe('POST');
        const body = JSON.parse(opts.body);
        expect(body.path).toBe('notes/paper.md');
        expect(body.root).toBe('r1');
        expect(body.annotation).toEqual({
            pdfUrl: 'paper.pdf',
            quote: {
                selectedText: 'ring all-reduce',
                contextBefore: 'the paper describes a ',
                contextAfter: ' communication pattern',
            },
            position: RECT_ANCHOR,
            question: undefined,
            answer: 'A bandwidth-optimal collective.',
            model: 'm1',
        });
    });

    it('omits position when no geometric anchor could be captured', async () => {
        geomMock.mockReturnValue(null);
        fetchApiMock.mockResolvedValueOnce({ answer: 'A.', model: 'm1' });
        fetchApiMock.mockResolvedValueOnce({ annotation: { id: 'a2' } });

        await askAndAnswer({ pdfUrl: 'paper.pdf', notePath: 'notes/paper.md' });

        await waitFor(() => expect(fetchApiMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchApiMock.mock.calls[1][1].body);
        expect(body.annotation.position).toBeUndefined();
    });

    it('does NOT persist when the note path is absent (no persistence context)', async () => {
        geomMock.mockReturnValue(RECT_ANCHOR);
        fetchApiMock.mockResolvedValueOnce({ answer: 'A.', model: 'm1' });

        await askAndAnswer({ pdfUrl: 'paper.pdf', notePath: null });

        // Only the answer call fires; no sidecar write without a note path.
        await new Promise(r => setTimeout(r, 0));
        expect(fetchApiMock).toHaveBeenCalledTimes(1);
        expect(fetchApiMock.mock.calls[0][0]).toBe('/api/quick-ask/answer?workspace=ws-1');
    });

    it('does NOT persist when pdfUrl is absent', async () => {
        geomMock.mockReturnValue(RECT_ANCHOR);
        fetchApiMock.mockResolvedValueOnce({ answer: 'A.', model: 'm1' });

        await askAndAnswer({ notePath: 'notes/paper.md' });

        await new Promise(r => setTimeout(r, 0));
        expect(fetchApiMock).toHaveBeenCalledTimes(1);
    });

    it('keeps showing the answer even if the sidecar write fails', async () => {
        geomMock.mockReturnValue(RECT_ANCHOR);
        fetchApiMock.mockResolvedValueOnce({ answer: 'still here', model: 'm1' });
        fetchApiMock.mockRejectedValueOnce(new Error('disk full'));

        await askAndAnswer({ pdfUrl: 'paper.pdf', notePath: 'notes/paper.md' });

        expect(screen.getByTestId('quick-ask-popover-answer').textContent).toContain('still here');
    });
});

describe('PdfQuickAskLayer — Goal 3 AC-04 "use full paper" toggle', () => {
    /** A rendered cached-paper embed URL (ingested arXiv paper). */
    const PAPER_URL = '/api/workspaces/ws-1/notes/image?path=' + encodeURIComponent('.papers/1802.05799.pdf');

    async function openInput(props: Parameters<typeof Harness>[0]) {
        render(<Harness {...props} />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
    }

    it('offers the toggle only for a cached arXiv paper embed', async () => {
        await openInput({ pdfUrl: PAPER_URL, notePath: 'notes/paper.md' });
        expect(screen.getByTestId('quick-ask-full-paper-toggle')).toBeInTheDocument();
    });

    it('hides the toggle for a non-cached PDF (uploaded / hotlinked)', async () => {
        await openInput({ pdfUrl: 'https://arxiv.org/pdf/1802.05799', notePath: 'notes/paper.md' });
        expect(screen.queryByTestId('quick-ask-full-paper-toggle')).toBeNull();
    });

    it('defaults OFF — a plain submit stays the cheap selection-only path', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'A.', model: 'm1', usedFullPaper: false });
        await openInput({ pdfUrl: PAPER_URL, notePath: 'notes/paper.md', noteRoot: 'r1' });

        fireEvent.keyDown(field(), { key: 'Enter' });

        const body = JSON.parse(fetchApiMock.mock.calls[0][1].body);
        expect(body.useFullPaper).toBeUndefined();
        expect(body.paperPath).toBeUndefined();
        expect(body.root).toBeUndefined();
    });

    it('when toggled ON, POSTs useFullPaper + the cache relpath + root', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'Grounded.', model: 'm1', usedFullPaper: true });
        await openInput({ pdfUrl: PAPER_URL, notePath: 'notes/paper.md', noteRoot: 'r1' });

        fireEvent.click(screen.getByTestId('quick-ask-full-paper-toggle'));
        expect(screen.getByTestId('quick-ask-full-paper-toggle').getAttribute('aria-pressed')).toBe('true');
        fireEvent.keyDown(field(), { key: 'Enter' });

        const body = JSON.parse(fetchApiMock.mock.calls[0][1].body);
        expect(body.useFullPaper).toBe(true);
        expect(body.paperPath).toBe('.papers/1802.05799.pdf');
        expect(body.root).toBe('r1');
        // selection context still forwarded alongside.
        expect(body.selectedText).toBe('ring all-reduce');
    });

    it('retry re-posts with the same full-paper grounding choice', async () => {
        fetchApiMock.mockRejectedValueOnce(new Error('boom'));
        await openInput({ pdfUrl: PAPER_URL, notePath: 'notes/paper.md', noteRoot: 'r1' });
        fireEvent.click(screen.getByTestId('quick-ask-full-paper-toggle'));
        fireEvent.keyDown(field(), { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-error')).toBeInTheDocument());

        fetchApiMock.mockResolvedValueOnce({ answer: 'recovered', model: 'm1', usedFullPaper: true });
        fireEvent.click(screen.getByTestId('quick-ask-popover-retry'));
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());

        expect(JSON.parse(fetchApiMock.mock.calls[1][1].body).useFullPaper).toBe(true);
    });

    it('resets to OFF for the next question after one is asked', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'A.', model: 'm1' });
        await openInput({ pdfUrl: PAPER_URL, notePath: 'notes/paper.md' });
        fireEvent.click(screen.getByTestId('quick-ask-full-paper-toggle'));
        fireEvent.keyDown(field(), { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());

        // Open a fresh input: toggle should be back to off.
        fireEvent.keyDown(document, { key: 'j', ctrlKey: true });
        await waitFor(() => expect(screen.getByTestId('quick-ask-full-paper-toggle')).toBeInTheDocument());
        expect(screen.getByTestId('quick-ask-full-paper-toggle').getAttribute('aria-pressed')).toBe('false');
    });
});

describe('PdfQuickAskLayer — disabled paths', () => {
    it('is a no-op with no workspaceId (no pill, no listeners)', async () => {
        render(<Harness omitWorkspace />);
        fireEvent.mouseUp(document);
        // Give the deferred capture a tick.
        await new Promise(r => setTimeout(r, 0));
        expect(screen.queryByTestId('quick-ask-pill')).toBeNull();
    });

    it('is a no-op when the feature flag is off', async () => {
        enabledMock.mockReturnValue(false);
        render(<Harness />);
        fireEvent.mouseUp(document);
        await new Promise(r => setTimeout(r, 0));
        expect(screen.queryByTestId('quick-ask-pill')).toBeNull();
    });
});
