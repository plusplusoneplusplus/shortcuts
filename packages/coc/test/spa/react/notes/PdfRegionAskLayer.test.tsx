/**
 * PdfRegionAskLayer — Goal 4 AC-01 client capture half.
 *
 * Wires a drag-a-box region select over the pdf.js canvas to the vision path of
 * the stateless `POST /api/quick-ask/answer` endpoint (an `{image}` body) and
 * then persists a region-only annotation. These tests mock the crop helper
 * ({@link captureRegion}), the feature flag, and `fetchApi`, then drive
 * arm → drag → question → answer → persist.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';

const { captureMock, fetchApiMock, enabledMock } = vi.hoisted(() => ({
    captureMock: vi.fn(),
    fetchApiMock: vi.fn(),
    enabledMock: vi.fn(() => true),
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/extensions/paperRegionCapture', () => ({
    captureRegion: (...args: unknown[]) => captureMock(...(args as [])),
    MIN_REGION_PX: 8,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: fetchApiMock,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useQuickAskSidenotesEnabled', () => ({
    useQuickAskSidenotesEnabled: () => enabledMock(),
}));

import { PdfRegionAskLayer }
    from '../../../../src/server/spa/client/react/features/notes/editor/extensions/PdfRegionAskLayer';

const CAPTURE = {
    region: { page: 2, rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.15 } },
    image: 'data:image/png;base64,ABC',
    pageText: 'Figure 1: throughput vs nodes',
    rect: { top: 300, left: 120, bottom: 460, right: 320 },
};

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
            <div ref={ref} data-testid="pdf-container" />
            <PdfRegionAskLayer
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

/** Arm region mode and drag a box; the mocked captureRegion decides the result. */
function armAndDrag() {
    fireEvent.click(screen.getByTestId('pdf-region-ask-toggle'));
    const surface = screen.getByTestId('pdf-region-ask-surface');
    fireEvent.mouseDown(surface, { clientX: 120, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 320, clientY: 460 });
    fireEvent.mouseUp(document, { clientX: 320, clientY: 460 });
}

beforeEach(() => {
    captureMock.mockReset();
    captureMock.mockReturnValue(CAPTURE);
    fetchApiMock.mockReset();
    // Default fallback so an unqueued call (e.g. the best-effort persist that
    // follows a successful answer) resolves rather than returning undefined —
    // in production fetchApi always returns a Promise. Tests queue answer /
    // persist responses with mockResolvedValueOnce, which take precedence.
    fetchApiMock.mockResolvedValue({});
    enabledMock.mockReset();
    enabledMock.mockReturnValue(true);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('PdfRegionAskLayer — arm + drag capture', () => {
    it('renders the ▢ toggle and arms the capture surface on click', () => {
        render(<Harness />);
        const toggle = screen.getByTestId('pdf-region-ask-toggle');
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(screen.queryByTestId('pdf-region-ask-surface')).toBeNull();
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('pdf-region-ask-surface')).toBeInTheDocument();
    });

    it('a drag that captures a region opens the question input (no lookup yet)', async () => {
        render(<Harness pdfUrl="paper.pdf" notePath="notes/paper.md" />);
        armAndDrag();
        await waitFor(() => expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument());
        // captureRegion received the container + the viewport drag box.
        expect(captureMock).toHaveBeenCalledTimes(1);
        expect(captureMock.mock.calls[0][1]).toEqual({ left: 120, top: 300, width: 200, height: 160 });
        // Surface disarms after a capture; no request until a question is submitted.
        expect(screen.queryByTestId('pdf-region-ask-surface')).toBeNull();
        expect(fetchApiMock).not.toHaveBeenCalled();
    });

    it('a drag that captures nothing (too small / off-page) opens no input', async () => {
        captureMock.mockReturnValue(null);
        render(<Harness />);
        armAndDrag();
        await new Promise(r => setTimeout(r, 0));
        expect(screen.queryByTestId('quick-ask-input')).toBeNull();
        expect(fetchApiMock).not.toHaveBeenCalled();
    });

    it('Escape disarms region mode without capturing', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('pdf-region-ask-toggle'));
        expect(screen.getByTestId('pdf-region-ask-surface')).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('pdf-region-ask-surface')).toBeNull();
    });
});

describe('PdfRegionAskLayer — ask → vision answer', () => {
    it('submitting posts the crop image + question to the answer endpoint and shows the answer', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'A throughput chart.', model: 'm1', usedVision: true });
        render(<Harness pdfUrl="paper.pdf" notePath="notes/paper.md" />);
        armAndDrag();
        await waitFor(() => expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument());

        fireEvent.change(field(), { target: { value: '  what does this show?  ' } });
        fireEvent.keyDown(field(), { key: 'Enter' });

        const [path, opts] = fetchApiMock.mock.calls[0];
        expect(path).toBe('/api/quick-ask/answer?workspace=ws-1');
        expect(opts.method).toBe('POST');
        const body = JSON.parse(opts.body);
        expect(body.image).toBe('data:image/png;base64,ABC');
        expect(body.question).toBe('what does this show?');
        // Loose grounding: the page's selectable text rides along as context.
        expect(body.contextBefore).toBe('Figure 1: throughput vs nodes');
        // No text selection is sent for a figure region.
        expect(body.selectedText).toBeUndefined();

        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());
        expect(screen.getByTestId('quick-ask-popover-answer').textContent).toContain('throughput chart');
    });

    it('an empty question submits with question undefined (default-explain)', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'A.', model: 'm1' });
        render(<Harness pdfUrl="paper.pdf" notePath="notes/paper.md" />);
        armAndDrag();
        await waitFor(() => expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument());
        fireEvent.keyDown(field(), { key: 'Enter' });
        expect(JSON.parse(fetchApiMock.mock.calls[0][1].body).question).toBeUndefined();
    });

    it('shows the asking state before the answer resolves', async () => {
        let resolvePost: (v: unknown) => void = () => {};
        fetchApiMock.mockImplementationOnce(() => new Promise(res => { resolvePost = res; }));
        render(<Harness pdfUrl="paper.pdf" notePath="notes/paper.md" />);
        armAndDrag();
        await waitFor(() => expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument());
        fireEvent.keyDown(field(), { key: 'Enter' });
        expect(screen.getByTestId('quick-ask-popover-loading')).toBeInTheDocument();
        resolvePost({ answer: 'done', model: 'm1' });
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());
    });

    it('renders an error with retry, and retry re-posts the same crop', async () => {
        fetchApiMock.mockRejectedValueOnce(new Error('boom'));
        render(<Harness pdfUrl="paper.pdf" notePath="notes/paper.md" />);
        armAndDrag();
        await waitFor(() => expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument());
        fireEvent.keyDown(field(), { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-error')).toBeInTheDocument());

        fetchApiMock.mockResolvedValueOnce({ answer: 'recovered', model: 'm1' });
        fireEvent.click(screen.getByTestId('quick-ask-popover-retry'));
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());
        // Both calls carry the crop image (retry re-posts the region).
        expect(JSON.parse(fetchApiMock.mock.calls[1][1].body).image).toBe('data:image/png;base64,ABC');
    });
});

describe('PdfRegionAskLayer — region-only persistence', () => {
    /** Arm → drag → submit → wait for the answer to render. */
    async function askAndAnswer(props: Parameters<typeof Harness>[0]) {
        render(<Harness {...props} />);
        armAndDrag();
        await waitFor(() => expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument());
        fireEvent.keyDown(field(), { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());
    }

    it('persists a region-only annotation (no text quote) after the answer resolves', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'A chart.', model: 'm1' });
        fetchApiMock.mockResolvedValueOnce({ annotation: { id: 'r1' } });

        await askAndAnswer({ pdfUrl: 'paper.pdf', notePath: 'notes/paper.md', noteRoot: 'r1' });

        await waitFor(() => expect(fetchApiMock).toHaveBeenCalledTimes(2));
        const [path, opts] = fetchApiMock.mock.calls[1];
        expect(path).toBe('/api/workspaces/ws-1/notes/paper-annotations/annotation');
        expect(opts.method).toBe('POST');
        const body = JSON.parse(opts.body);
        expect(body.path).toBe('notes/paper.md');
        expect(body.root).toBe('r1');
        expect(body.annotation).toEqual({
            pdfUrl: 'paper.pdf',
            region: CAPTURE.region,
            question: undefined,
            answer: 'A chart.',
            model: 'm1',
        });
        // A region annotation carries no text quote.
        expect(body.annotation.quote).toBeUndefined();
    });

    it('does NOT persist without a note path', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'A.', model: 'm1' });
        await askAndAnswer({ pdfUrl: 'paper.pdf', notePath: null });
        await new Promise(r => setTimeout(r, 0));
        expect(fetchApiMock).toHaveBeenCalledTimes(1);
        expect(fetchApiMock.mock.calls[0][0]).toBe('/api/quick-ask/answer?workspace=ws-1');
    });

    it('does NOT persist without a pdfUrl', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'A.', model: 'm1' });
        await askAndAnswer({ notePath: 'notes/paper.md' });
        await new Promise(r => setTimeout(r, 0));
        expect(fetchApiMock).toHaveBeenCalledTimes(1);
    });

    it('keeps showing the answer even if the sidecar write fails', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'still here', model: 'm1' });
        fetchApiMock.mockRejectedValueOnce(new Error('disk full'));
        await askAndAnswer({ pdfUrl: 'paper.pdf', notePath: 'notes/paper.md' });
        expect(screen.getByTestId('quick-ask-popover-answer').textContent).toContain('still here');
    });
});

describe('PdfRegionAskLayer — disabled paths', () => {
    it('renders nothing without a workspaceId', () => {
        render(<Harness omitWorkspace />);
        expect(screen.queryByTestId('pdf-region-ask-toggle')).toBeNull();
    });

    it('renders nothing when the feature flag is off', () => {
        enabledMock.mockReturnValue(false);
        render(<Harness />);
        expect(screen.queryByTestId('pdf-region-ask-toggle')).toBeNull();
    });
});
