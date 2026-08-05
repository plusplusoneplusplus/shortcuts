/**
 * NoteQuickAskLayer — notes-quick-ask, AC-01 (pill/input) + AC-02 (grounded
 * one-shot answer) client half.
 *
 * Wires the shared Quick Ask pill / Cmd+J / popover to a WYSIWYG note text
 * selection and POSTs to the stateless `POST /api/quick-ask/answer` endpoint
 * (no processId, no persistence). These tests mock the selection reader, the
 * feature flag, and `fetchApi`, then drive the pill→input→answer flow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';

const {
    getSelectionMock,
    fetchApiMock,
    requestForWorkspaceMock,
    enabledMock,
    insertSidenoteRefMock,
    deleteSidenoteRefMock,
    updateSidenoteRefTurnsMock,
} = vi.hoisted(() => ({
    getSelectionMock: vi.fn(),
    fetchApiMock: vi.fn(),
    requestForWorkspaceMock: vi.fn(),
    enabledMock: vi.fn(() => true),
    insertSidenoteRefMock: vi.fn(() => true),
    deleteSidenoteRefMock: vi.fn(() => true),
    updateSidenoteRefTurnsMock: vi.fn(() => true),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/quick-ask/quick-ask-selection', () => ({
    getQuickAskSelection: getSelectionMock,
    deriveContext: () => ({ contextBefore: '', contextAfter: '' }),
    isSelectableText: () => true,
    MIN_SELECTION_CHARS: 2,
    CONTEXT_CHARS: 80,
}));
// The layer routes every request through `requestForWorkspace(workspaceId, …)`
// so it follows the workspace's clone. The adapter below keeps the existing
// `fetchApiMock(path, opts)` assertions readable; `requestForWorkspaceMock`
// additionally records the workspace id each call was routed with.
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    requestForWorkspace: requestForWorkspaceMock,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useQuickAskSidenotesEnabled', () => ({
    useQuickAskSidenotesEnabled: () => enabledMock(),
}));
// AC-03 persistence is exercised end-to-end against a real editor in
// sidenoteRefPlacement.test.ts; here we only assert the layer WIRES it (calls it
// on success with the anchor+payload, and never on error).
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/extensions/sidenoteRefPlacement', () => ({
    insertSidenoteRef: insertSidenoteRefMock,
    deleteSidenoteRef: deleteSidenoteRefMock,
    updateSidenoteRefTurns: updateSidenoteRefTurnsMock,
}));

import { NoteQuickAskLayer }
    from '../../../../src/server/spa/client/react/features/notes/editor/extensions/NoteQuickAskLayer';
import type { QuickAskSelection }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

/** A bounded selection: selected phrase + a ±window of note content, NOT the
 *  whole note (AC-02 grounding constraint). */
const SELECTION: QuickAskSelection = {
    turnIndex: 0,
    selectedText: 'gradient descent',
    contextBefore: 'we optimize the loss with ',
    contextAfter: ' over many epochs',
    rect: { top: 200, left: 120, bottom: 220, right: 260 },
};

/** `omitWorkspace` renders the layer with no workspaceId at all (default-param
 *  fallback would otherwise turn an explicit `undefined` back into 'ws-1'). */
/** A stand-in editor; the placement module is mocked, so the layer only needs to
 *  forward this reference — it is never actually driven here. */
const EDITOR_SENTINEL = { isDestroyed: false } as unknown as import('@tiptap/core').Editor;

function Harness({
    workspaceId = 'ws-1',
    omitWorkspace = false,
    editor = EDITOR_SENTINEL,
}: {
    workspaceId?: string;
    omitWorkspace?: boolean;
    editor?: import('@tiptap/core').Editor | null;
}) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div>
            <div ref={ref} data-testid="note-container">
                we optimize the loss with gradient descent over many epochs
            </div>
            <NoteQuickAskLayer
                containerRef={ref as unknown as React.RefObject<HTMLElement | null>}
                workspaceId={omitWorkspace ? undefined : workspaceId}
                editor={editor}
            />
        </div>
    );
}

const field = () => screen.getByTestId('quick-ask-input-field') as HTMLInputElement;

beforeEach(() => {
    getSelectionMock.mockReset();
    getSelectionMock.mockReturnValue(SELECTION);
    fetchApiMock.mockReset();
    requestForWorkspaceMock.mockReset();
    requestForWorkspaceMock.mockImplementation(
        (_workspaceId: unknown, path: string, opts?: RequestInit) => fetchApiMock(path, opts));
    enabledMock.mockReset();
    enabledMock.mockReturnValue(true);
    insertSidenoteRefMock.mockReset();
    insertSidenoteRefMock.mockReturnValue(true);
    deleteSidenoteRefMock.mockReset();
    deleteSidenoteRefMock.mockReturnValue(true);
    updateSidenoteRefTurnsMock.mockReset();
    updateSidenoteRefTurnsMock.mockReturnValue(true);
});

afterEach(() => {
    // Explicitly unmount so each component's document-level selection listeners
    // (and portaled pill/popover nodes) are torn down before the next test.
    cleanup();
    vi.restoreAllMocks();
});

/** Raise the pill by simulating a pointer selection in the note container. */
async function raisePill() {
    fireEvent.mouseUp(document);
    await waitFor(() => expect(screen.getByTestId('quick-ask-pill')).toBeInTheDocument());
}

describe('NoteQuickAskLayer — AC-01 pill + input', () => {
    it('raises the ✨ Ask AI pill on a WYSIWYG text selection', async () => {
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

    it('dismisses the input on an outside pointer-down', async () => {
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument();
        fireEvent.mouseDown(document.body);
        await waitFor(() => expect(screen.queryByTestId('quick-ask-input')).toBeNull());
    });
});

describe('NoteQuickAskLayer — AC-01/AC-02 empty vs typed question', () => {
    it('a typed question is trimmed and forwarded with the bounded window', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'Iterative first-order optimization.', model: 'm1' });
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));

        fireEvent.change(field(), { target: { value: '  what is this?  ' } });
        fireEvent.keyDown(field(), { key: 'Enter' });

        // AC-02: stateless answer endpoint, never a chat process route.
        expect(fetchApiMock).toHaveBeenCalledTimes(1);
        const [path, opts] = fetchApiMock.mock.calls[0];
        expect(path).toBe('/api/quick-ask/answer?workspace=ws-1');
        expect(path).not.toContain('/processes/');
        expect(opts.method).toBe('POST');
        const body = JSON.parse(opts.body);
        // AC-02 grounding: selection ± a bounded window only — NOT the whole note.
        expect(body).toEqual({
            selectedText: 'gradient descent',
            contextBefore: 'we optimize the loss with ',
            contextAfter: ' over many epochs',
            question: 'what is this?',
        });
        // No whole-note / full-body field is ever sent.
        expect(body).not.toHaveProperty('noteBody');
        expect(body).not.toHaveProperty('fullNote');

        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());
        expect(screen.getByTestId('quick-ask-popover-answer').textContent)
            .toContain('first-order optimization');
    });

    it('empty question submits with question undefined (default explain-this fast path)', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'A.', model: 'm1' });
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));

        fireEvent.keyDown(field(), { key: 'Enter' });

        const body = JSON.parse(fetchApiMock.mock.calls[0][1].body);
        expect(body.question).toBeUndefined();
    });
});

describe('NoteQuickAskLayer — AC-02 loading / error / success', () => {
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

describe('NoteQuickAskLayer — AC-03 footnote persistence wiring', () => {
    it('embeds the answered note into the editor on success (anchor + payload)', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'Iterative first-order optimization.', model: 'm1' });
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        fireEvent.change(field(), { target: { value: 'what is this?' } });
        fireEvent.keyDown(field(), { key: 'Enter' });

        await waitFor(() => expect(insertSidenoteRefMock).toHaveBeenCalledTimes(1));
        const [editorArg, anchorArg, payloadArg] = insertSidenoteRefMock.mock.calls[0];
        expect(editorArg).toBe(EDITOR_SENTINEL);
        // Anchor is the bounded selection window, mirroring what was sent to the AI.
        expect(anchorArg).toEqual({
            selectedText: 'gradient descent',
            contextBefore: 'we optimize the loss with ',
            contextAfter: ' over many epochs',
        });
        // Payload carries a stable md-safe refId, the question, and the frozen answer.
        expect(payloadArg.answer).toBe('Iterative first-order optimization.');
        expect(payloadArg.question).toBe('what is this?');
        expect(payloadArg.refId).toEqual(expect.any(String));
        expect(payloadArg.refId).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('does not embed anything when the lookup fails (nothing to persist)', async () => {
        fetchApiMock.mockRejectedValueOnce(new Error('boom'));
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        fireEvent.keyDown(field(), { key: 'Enter' });

        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-error')).toBeInTheDocument());
        expect(insertSidenoteRefMock).not.toHaveBeenCalled();
    });

    it('forwards an undefined question for a default (empty) ask', async () => {
        fetchApiMock.mockResolvedValueOnce({ answer: 'A.', model: 'm1' });
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        fireEvent.keyDown(field(), { key: 'Enter' });

        await waitFor(() => expect(insertSidenoteRefMock).toHaveBeenCalledTimes(1));
        expect(insertSidenoteRefMock.mock.calls[0][2].question).toBeUndefined();
    });
});

/** A container holding a persisted `.qa-sidenote-ref` chip (as the loaded editor
 *  would render it) so AC-04 chip-click / popover / delete can be driven. */
function ChipHarness({ enabled = true }: { enabled?: boolean }) {
    enabledMock.mockReturnValue(enabled);
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div>
            <div ref={ref} data-testid="note-container">
                <p>
                    {'we optimize the loss with gradient descent'}
                    <span
                        className="qa-sidenote-ref"
                        data-qa-id="abc123"
                        data-qa-question="what is this?"
                        data-qa-answer="Iterative first-order optimization."
                        data-qa-selected-text="gradient descent"
                        data-qa-context-before="we optimize the loss with "
                        data-qa-context-after=" over many epochs"
                        data-testid="qa-chip"
                    >
                        ✨
                    </span>
                    {' over many epochs'}
                </p>
            </div>
            <NoteQuickAskLayer
                containerRef={ref as unknown as React.RefObject<HTMLElement | null>}
                workspaceId="ws-1"
                editor={EDITOR_SENTINEL}
            />
        </div>
    );
}

describe('NoteQuickAskLayer — AC-04 chip, popover, delete', () => {
    it('clicking a persisted chip opens the popover with the frozen question + answer', async () => {
        render(<ChipHarness />);
        fireEvent.click(screen.getByTestId('qa-chip'));

        await waitFor(() => expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument());
        expect(screen.getByTestId('quick-ask-popover-answer').textContent)
            .toContain('first-order optimization');
        expect(screen.getByTestId('quick-ask-popover-question').textContent).toContain('what is this?');
        // The quoted term comes from the exact persisted selection.
        expect(screen.getByTestId('quick-ask-popover').textContent).toContain('gradient descent');
    });

    it('dismisses the popover on an outside pointer-down (mirrors chat)', async () => {
        render(<ChipHarness />);
        fireEvent.click(screen.getByTestId('qa-chip'));
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument());

        fireEvent.mouseDown(document.body);
        await waitFor(() => expect(screen.queryByTestId('quick-ask-popover')).toBeNull());
    });

    it('re-clicking the same chip toggles the popover closed', async () => {
        render(<ChipHarness />);
        fireEvent.click(screen.getByTestId('qa-chip'));
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('qa-chip'));
        await waitFor(() => expect(screen.queryByTestId('quick-ask-popover')).toBeNull());
    });

    it('the delete control removes the marker node and closes the popover', async () => {
        render(<ChipHarness />);
        fireEvent.click(screen.getByTestId('qa-chip'));
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('quick-ask-popover-dismiss'));

        // Delete removes the persisted marker → marker + bottom definition both
        // vanish on the next save (AC-04 DoD#3).
        expect(deleteSidenoteRefMock).toHaveBeenCalledTimes(1);
        expect(deleteSidenoteRefMock).toHaveBeenCalledWith(EDITOR_SENTINEL, 'abc123');
        await waitFor(() => expect(screen.queryByTestId('quick-ask-popover')).toBeNull());
    });

    it('no popover opens on chip click when the flag is off (existing content untouched)', async () => {
        render(<ChipHarness enabled={false} />);
        fireEvent.click(screen.getByTestId('qa-chip'));
        await new Promise(r => setTimeout(r, 0));
        expect(screen.queryByTestId('quick-ask-popover')).toBeNull();
        // The persisted chip itself still renders (unconditional node registration).
        expect(screen.getByTestId('qa-chip')).toBeInTheDocument();
    });

    it('reconstructs the full multi-turn thread from data-qa-turns on chip reopen (AC-03)', async () => {
        function ThreadChipHarness() {
            const ref = useRef<HTMLDivElement>(null);
            const turns = JSON.stringify([
                { q: 'what is this?', a: 'Iterative first-order optimization.' },
                { q: 'give an example', a: 'For example, SGD.' },
            ]);
            return (
                <div>
                    <div ref={ref} data-testid="note-container">
                        <p>
                            {'we optimize the loss with gradient descent'}
                            <span
                                className="qa-sidenote-ref"
                                data-qa-id="thread1"
                                data-qa-turns={turns}
                                data-qa-question="what is this?"
                                data-qa-answer="Iterative first-order optimization."
                                data-qa-selected-text="gradient descent"
                                data-qa-context-before="we optimize the loss with "
                                data-qa-context-after=" over many epochs"
                                data-testid="thread-chip"
                            >
                                ✨
                            </span>
                            {' over many epochs'}
                        </p>
                    </div>
                    <NoteQuickAskLayer
                        containerRef={ref as unknown as React.RefObject<HTMLElement | null>}
                        workspaceId="ws-1"
                        editor={EDITOR_SENTINEL}
                    />
                </div>
            );
        }

        render(<ThreadChipHarness />);
        fireEvent.click(screen.getByTestId('thread-chip'));

        await waitFor(() => expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument());
        // Both persisted turns render as separate Q/A blocks.
        const answers = screen.getAllByTestId('quick-ask-popover-answer');
        expect(answers).toHaveLength(2);
        expect(answers[0].textContent).toContain('first-order optimization');
        expect(answers[1].textContent).toContain('For example, SGD');
    });

    it('falls back to preceding text for a legacy chip without anchor data', async () => {
        function LegacyHarness() {
            const ref = useRef<HTMLDivElement>(null);
            return (
                <div>
                    <div ref={ref}>
                        <p>
                            {'legacy phrase'}
                            <span
                                className="qa-sidenote-ref"
                                data-qa-id="legacy"
                                data-qa-answer="Legacy answer"
                                data-testid="legacy-chip"
                            >
                                ✨
                            </span>
                        </p>
                    </div>
                    <NoteQuickAskLayer
                        containerRef={ref as React.RefObject<HTMLElement | null>}
                        workspaceId="ws-1"
                        editor={EDITOR_SENTINEL}
                    />
                </div>
            );
        }

        render(<LegacyHarness />);
        fireEvent.click(screen.getByTestId('legacy-chip'));
        await waitFor(() =>
            expect(screen.getByTestId('quick-ask-popover').textContent)
                .toContain('legacy phrase'),
        );
    });
});

describe('NoteQuickAskLayer — AC-02 follow-up thread', () => {
    /** Drive the pill → input → first answer, returning after turn 1 is ready. */
    async function askFirst(answer = 'Iterative first-order optimization.') {
        fetchApiMock.mockResolvedValueOnce({ answer, model: 'm1' });
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        fireEvent.change(field(), { target: { value: 'what is this?' } });
        fireEvent.keyDown(field(), { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());
    }

    it('sends a follow-up with the prior turn as history and appends a new Q/A', async () => {
        await askFirst();
        fetchApiMock.mockResolvedValueOnce({ answer: 'For example, SGD.', model: 'm1' });

        const replyInput = screen.getByTestId('quick-ask-reply-input') as HTMLTextAreaElement;
        fireEvent.change(replyInput, { target: { value: 'give an example' } });
        fireEvent.keyDown(replyInput, { key: 'Enter' });

        // Second POST carries the ordered prior turn as grounding history (AC-01).
        await waitFor(() => expect(fetchApiMock).toHaveBeenCalledTimes(2));
        const body = JSON.parse(fetchApiMock.mock.calls[1][1].body);
        expect(body.selectedText).toBe('gradient descent');
        expect(body.question).toBe('give an example');
        expect(body.history).toEqual([
            { question: 'what is this?', answer: 'Iterative first-order optimization.' },
        ]);

        // Both turns now render in the thread.
        await waitFor(() => expect(screen.getAllByTestId('quick-ask-popover-answer')).toHaveLength(2));
        const answers = screen.getAllByTestId('quick-ask-popover-answer');
        expect(answers[1].textContent).toContain('For example, SGD');
    });

    it('a follow-up re-writes the marker turns (AC-03) rather than re-embedding it', async () => {
        await askFirst();
        expect(insertSidenoteRefMock).toHaveBeenCalledTimes(1);
        // Turn 0 embeds the marker with the one-turn thread persisted.
        expect(insertSidenoteRefMock.mock.calls[0][2].turns).toEqual([
            { question: 'what is this?', answer: 'Iterative first-order optimization.' },
        ]);
        fetchApiMock.mockResolvedValueOnce({ answer: 'second', model: 'm1' });

        const replyInput = screen.getByTestId('quick-ask-reply-input');
        fireEvent.change(replyInput, { target: { value: 'and?' } });
        fireEvent.keyDown(replyInput, { key: 'Enter' });

        await waitFor(() => expect(updateSidenoteRefTurnsMock).toHaveBeenCalledTimes(1));
        // No new marker embed — the follow-up folds into the existing one.
        expect(insertSidenoteRefMock).toHaveBeenCalledTimes(1);
        const [, refId, turns] = updateSidenoteRefTurnsMock.mock.calls[0];
        expect(refId).toEqual(insertSidenoteRefMock.mock.calls[0][2].refId);
        // Both ready turns are persisted, in order.
        expect(turns).toEqual([
            { question: 'what is this?', answer: 'Iterative first-order optimization.' },
            { question: 'and?', answer: 'second' },
        ]);
    });

    it('a failed follow-up shows a per-turn error+retry that preserves turn 1', async () => {
        await askFirst();
        fetchApiMock.mockRejectedValueOnce(new Error('boom'));

        const replyInput = screen.getByTestId('quick-ask-reply-input');
        fireEvent.change(replyInput, { target: { value: 'boom please' } });
        fireEvent.keyDown(replyInput, { key: 'Enter' });

        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-error')).toBeInTheDocument());
        // Turn 1's answer is still on screen.
        expect(screen.getByTestId('quick-ask-popover-answer').textContent).toContain('first-order optimization');

        fetchApiMock.mockResolvedValueOnce({ answer: 'recovered', model: 'm1' });
        fireEvent.click(screen.getByTestId('quick-ask-popover-retry'));
        await waitFor(() => expect(screen.getAllByTestId('quick-ask-popover-answer')).toHaveLength(2));
        expect(fetchApiMock).toHaveBeenCalledTimes(3);
    });
});

describe('NoteQuickAskLayer — dismiss during in-flight request still persists', () => {
    /** A fetch that resolves only when the returned `resolve` is called, so the
     *  test can dismiss the popover before the answer lands. */
    function deferFetch() {
        let resolve!: (v: { answer?: string; model?: string }) => void;
        fetchApiMock.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        return { resolve };
    }

    /** Pill → input → submit turn 0, leaving the request pending. */
    async function askPending(question = 'what is this?') {
        const deferred = deferFetch();
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        fireEvent.change(field(), { target: { value: question } });
        fireEvent.keyDown(field(), { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-loading')).toBeInTheDocument());
        return deferred;
    }

    it('turn 0: closing via the close button before resolve still inserts the marker', async () => {
        const { resolve } = await askPending();

        fireEvent.click(screen.getByTestId('quick-ask-popover-close'));
        await waitFor(() => expect(screen.queryByTestId('quick-ask-popover')).toBeNull());

        resolve({ answer: 'because it descends the gradient', model: 'm' });
        await waitFor(() => expect(insertSidenoteRefMock).toHaveBeenCalledTimes(1));
        const [editorArg, anchorArg, payloadArg] = insertSidenoteRefMock.mock.calls[0];
        expect(editorArg).toBe(EDITOR_SENTINEL);
        expect(anchorArg).toEqual({
            selectedText: 'gradient descent',
            contextBefore: 'we optimize the loss with ',
            contextAfter: ' over many epochs',
        });
        expect(payloadArg.answer).toBe('because it descends the gradient');
        expect(payloadArg.question).toBe('what is this?');
        expect(payloadArg.turns).toEqual([
            { question: 'what is this?', answer: 'because it descends the gradient' },
        ]);
    });

    it('turn 0: an outside pointer-down before resolve still inserts the marker', async () => {
        const { resolve } = await askPending();

        fireEvent.mouseDown(document.body);
        await waitFor(() => expect(screen.queryByTestId('quick-ask-popover')).toBeNull());

        resolve({ answer: 'because it descends the gradient', model: 'm' });
        await waitFor(() => expect(insertSidenoteRefMock).toHaveBeenCalledTimes(1));
    });

    it('turn 0: the delete control before resolve still inserts the marker (no crash)', async () => {
        const { resolve } = await askPending();

        // Delete while asking closes the popover (nothing embedded yet to remove).
        fireEvent.click(screen.getByTestId('quick-ask-popover-dismiss'));
        await waitFor(() => expect(screen.queryByTestId('quick-ask-popover')).toBeNull());

        resolve({ answer: 'because it descends the gradient', model: 'm' });
        await waitFor(() => expect(insertSidenoteRefMock).toHaveBeenCalledTimes(1));
    });

    it('follow-up: closing before resolve still re-writes the marker turns', async () => {
        // Turn 0 lands normally.
        fetchApiMock.mockResolvedValueOnce({ answer: 'Iterative first-order optimization.', model: 'm1' });
        render(<Harness />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        fireEvent.change(field(), { target: { value: 'what is this?' } });
        fireEvent.keyDown(field(), { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument());
        expect(insertSidenoteRefMock).toHaveBeenCalledTimes(1);

        // Follow-up request is left pending, then the popover is dismissed.
        const { resolve } = deferFetch();
        const replyInput = screen.getByTestId('quick-ask-reply-input');
        fireEvent.change(replyInput, { target: { value: 'give an example' } });
        fireEvent.keyDown(replyInput, { key: 'Enter' });
        fireEvent.click(screen.getByTestId('quick-ask-popover-close'));
        await waitFor(() => expect(screen.queryByTestId('quick-ask-popover')).toBeNull());

        resolve({ answer: 'For example, SGD.', model: 'm1' });
        await waitFor(() => expect(updateSidenoteRefTurnsMock).toHaveBeenCalledTimes(1));
        // No re-embed; the full accumulated thread is persisted.
        expect(insertSidenoteRefMock).toHaveBeenCalledTimes(1);
        const [, refId, turns] = updateSidenoteRefTurnsMock.mock.calls[0];
        expect(refId).toEqual(insertSidenoteRefMock.mock.calls[0][2].refId);
        expect(turns).toEqual([
            { question: 'what is this?', answer: 'Iterative first-order optimization.' },
            { question: 'give an example', answer: 'For example, SGD.' },
        ]);
    });

    it('AC-05: a deleted anchor (insert returns false) still calls insert once and does not throw', async () => {
        // The placement helper — not the layer — owns the drop decision: it returns
        // false when the phrase is gone. The layer persists unconditionally.
        insertSidenoteRefMock.mockReturnValue(false);
        const { resolve } = await askPending();

        fireEvent.mouseDown(document.body);
        await waitFor(() => expect(screen.queryByTestId('quick-ask-popover')).toBeNull());

        resolve({ answer: 'because it descends the gradient', model: 'm' });
        await waitFor(() => expect(insertSidenoteRefMock).toHaveBeenCalledTimes(1));
    });
});

describe('NoteQuickAskLayer — disabled paths', () => {
    it('is a no-op with no workspaceId (no pill, no listeners)', async () => {
        render(<Harness omitWorkspace />);
        fireEvent.mouseUp(document);
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
