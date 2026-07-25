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

const { getSelectionMock, fetchApiMock, enabledMock } = vi.hoisted(() => ({
    getSelectionMock: vi.fn(),
    fetchApiMock: vi.fn(),
    enabledMock: vi.fn(() => true),
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
function Harness({ workspaceId = 'ws-1', omitWorkspace = false }: { workspaceId?: string; omitWorkspace?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div>
            <div ref={ref} data-testid="pdf-container">the paper describes a ring all-reduce communication pattern</div>
            <PdfQuickAskLayer
                containerRef={ref as unknown as React.RefObject<HTMLElement | null>}
                workspaceId={omitWorkspace ? undefined : workspaceId}
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
