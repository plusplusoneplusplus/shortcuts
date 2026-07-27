import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuickAskSidenotePopover, type QuickAskReply }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/QuickAskSidenotePopover';
import type { ClientSideNote, QuickAskTurn }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

function note(overrides: Partial<ClientSideNote> = {}): ClientSideNote {
    return {
        id: 'n1',
        processId: 'p1',
        turnIndex: 0,
        anchor: { selectedText: 'GroupedGEMM', contextBefore: '', contextAfter: '', fingerprint: '' },
        answer: 'A fused batched matmul kernel.',
        label: 'GroupedGEMM',
        createdAt: '2026-07-25T00:00:00Z',
        status: 'ready',
        ...overrides,
    };
}

const noop = () => {};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function renderPopover(onClose = vi.fn()) {
    render(
        <div>
            <button data-testid="outside">outside</button>
            <span data-testid="quick-ask-chip-n1">chip</span>
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 10, left: 10 }}
                onClose={onClose}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
            />
        </div>,
    );
    return onClose;
}

describe('QuickAskSidenotePopover outside-click dismissal', () => {
    it('closes when the user mousedowns outside the popover', () => {
        const onClose = renderPopover();
        expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument();

        fireEvent.mouseDown(screen.getByTestId('outside'));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when the user mousedowns inside the popover', () => {
        const onClose = renderPopover();

        fireEvent.mouseDown(screen.getByTestId('quick-ask-popover-answer'));

        expect(onClose).not.toHaveBeenCalled();
    });

    it('does not close on mousedown over a side-note chip', () => {
        const onClose = renderPopover();

        fireEvent.mouseDown(screen.getByTestId('quick-ask-chip-n1'));

        expect(onClose).not.toHaveBeenCalled();
    });

    it('still closes on Escape', () => {
        const onClose = renderPopover();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('QuickAskSidenotePopover - drag & resize', () => {
    it('drags the popover by its header, updating its fixed top/left', () => {
        render(
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 40, left: 60 }}
                onClose={noop}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
            />,
        );
        const popover = screen.getByTestId('quick-ask-popover');
        const header = screen.getByTestId('quick-ask-popover-header');
        const startTop = parseFloat(popover.style.top);
        const startLeft = parseFloat(popover.style.left);

        fireEvent.mouseDown(header, { clientX: 100, clientY: 100 });
        fireEvent.mouseMove(document, { clientX: 130, clientY: 125 });
        fireEvent.mouseUp(document);

        expect(parseFloat(popover.style.left)).toBe(startLeft + 30);
        expect(parseFloat(popover.style.top)).toBe(startTop + 25);
    });

    it('does not start a drag from the header close button', () => {
        const onClose = vi.fn();
        render(
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 40, left: 60 }}
                onClose={onClose}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
            />,
        );
        const popover = screen.getByTestId('quick-ask-popover');
        const startLeft = parseFloat(popover.style.left);

        fireEvent.mouseDown(screen.getByTestId('quick-ask-popover-close'), { clientX: 100, clientY: 100 });
        fireEvent.mouseMove(document, { clientX: 140, clientY: 100 });
        fireEvent.mouseUp(document);

        expect(parseFloat(popover.style.left)).toBe(startLeft);
    });

    it('resizes the popover from the bottom-right grip', () => {
        render(
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 40, left: 60 }}
                onClose={noop}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
            />,
        );
        const popover = screen.getByTestId('quick-ask-popover');
        expect(popover.style.width).toBe('');

        fireEvent.mouseDown(screen.getByTestId('quick-ask-popover-resize'), { clientX: 0, clientY: 0 });
        fireEvent.mouseMove(document, { clientX: 400, clientY: 500 });
        fireEvent.mouseUp(document);

        // jsdom reports a 0×0 rect, so the size is just the drag delta (clamped
        // to the minimum), which here is well above it.
        expect(parseFloat(popover.style.width)).toBe(400);
        expect(parseFloat(popover.style.height)).toBe(500);
    });

    it('clamps resize to a usable minimum', () => {
        render(
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 40, left: 60 }}
                onClose={noop}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
            />,
        );
        const popover = screen.getByTestId('quick-ask-popover');

        fireEvent.mouseDown(screen.getByTestId('quick-ask-popover-resize'), { clientX: 0, clientY: 0 });
        fireEvent.mouseMove(document, { clientX: -1000, clientY: -1000 });
        fireEvent.mouseUp(document);

        expect(parseFloat(popover.style.width)).toBe(240);
        expect(parseFloat(popover.style.height)).toBe(160);
    });
});

describe('QuickAskSidenotePopover - AC-03 question rendering', () => {
    it('shows a "Q:" line when the note carries a custom question', () => {
        render(
            <QuickAskSidenotePopover
                note={note({ question: 'why does this matter?' })}
                position={{ top: 100, left: 100 }}
                onClose={noop}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
            />,
        );

        const q = screen.getByTestId('quick-ask-popover-question');
        expect(q).toBeInTheDocument();
        expect(q.textContent).toContain('why does this matter?');
        expect(q.textContent).toContain('Q:');
    });

    it('renders no question line for the default-explain case (no question)', () => {
        render(
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 100, left: 100 }}
                onClose={noop}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
            />,
        );

        expect(screen.queryByTestId('quick-ask-popover-question')).toBeNull();
        expect(screen.getByTestId('quick-ask-popover-answer')).toBeInTheDocument();
    });
});

describe('QuickAskSidenotePopover - resolve/reopen control (Goal 4 AC-02)', () => {
    it('has no resolve button by default (chat side-notes)', () => {
        render(
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 100, left: 100 }}
                onClose={noop}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
            />,
        );
        expect(screen.queryByTestId('quick-ask-popover-resolve')).toBeNull();
    });

    it('shows "Resolve" for an open annotation and toggles it resolved on click', () => {
        const onToggle = vi.fn();
        const onClose = vi.fn();
        render(
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 100, left: 100 }}
                onClose={onClose}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
                resolve={{ resolved: false, onToggle }}
            />,
        );
        const btn = screen.getByTestId('quick-ask-popover-resolve');
        expect(btn).toHaveTextContent('Resolve');
        fireEvent.click(btn);
        expect(onToggle).toHaveBeenCalledWith('n1', true);
        expect(onClose).toHaveBeenCalled();
    });

    it('shows "Reopen" for a resolved annotation and reopens it on click', () => {
        const onToggle = vi.fn();
        render(
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 100, left: 100 }}
                onClose={noop}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
                resolve={{ resolved: true, onToggle }}
            />,
        );
        const btn = screen.getByTestId('quick-ask-popover-resolve');
        expect(btn).toHaveTextContent('Reopen');
        fireEvent.click(btn);
        expect(onToggle).toHaveBeenCalledWith('n1', false);
    });

    it('hides the resolve button while the answer is still loading', () => {
        const onToggle = vi.fn();
        render(
            <QuickAskSidenotePopover
                note={note({ status: 'asking' })}
                position={{ top: 100, left: 100 }}
                onClose={noop}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
                resolve={{ resolved: false, onToggle }}
            />,
        );
        expect(screen.queryByTestId('quick-ask-popover-resolve')).toBeNull();
    });
});

/** A ready thread turn. */
function turn(overrides: Partial<QuickAskTurn> = {}): QuickAskTurn {
    return { question: undefined, answer: 'A fused batched matmul kernel.', status: 'ready', ...overrides };
}

function renderWithReply(reply: Partial<QuickAskReply> = {}, onDelete = vi.fn()) {
    const full: QuickAskReply = {
        turns: [turn()],
        onSend: vi.fn(),
        onRetry: vi.fn(),
        ...reply,
    };
    render(
        <QuickAskSidenotePopover
            note={note()}
            position={{ top: 100, left: 100 }}
            onClose={noop}
            onCopy={noop}
            onRetry={noop}
            onDelete={onDelete}
            reply={full}
        />,
    );
    return full;
}

describe('QuickAskSidenotePopover - AC-02 reply row', () => {
    it('renders no reply input without the reply prop (chat side-notes unchanged)', () => {
        render(
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 100, left: 100 }}
                onClose={noop}
                onCopy={noop}
                onRetry={noop}
                onDelete={noop}
            />,
        );
        expect(screen.queryByTestId('quick-ask-reply-input')).toBeNull();
        // The one-shot Copy/Dismiss keep their text labels.
        expect(screen.getByTestId('quick-ask-popover-dismiss')).toHaveTextContent('Dismiss');
    });

    it('renders the always-visible reply input + icon-only Copy/Dismiss with the reply prop', () => {
        renderWithReply();
        expect(screen.getByTestId('quick-ask-reply-input')).toBeInTheDocument();
        // Icon-only on the reply row (no "Copy"/"Dismiss" word).
        expect(screen.getByTestId('quick-ask-popover-copy')).not.toHaveTextContent('Copy');
        expect(screen.getByTestId('quick-ask-popover-dismiss')).not.toHaveTextContent('Dismiss');
    });

    it('renders every thread turn as a stacked Q/A block', () => {
        renderWithReply({
            turns: [
                turn({ question: undefined, answer: 'first answer' }),
                turn({ question: 'give an example', answer: 'second answer' }),
            ],
        });
        expect(screen.getAllByTestId('quick-ask-thread-turn')).toHaveLength(2);
        const answers = screen.getAllByTestId('quick-ask-popover-answer');
        expect(answers[0].textContent).toContain('first answer');
        expect(answers[1].textContent).toContain('second answer');
        expect(screen.getByTestId('quick-ask-popover-question').textContent).toContain('give an example');
    });

    it('Enter (no modifier) sends a trimmed follow-up and clears the input', () => {
        const reply = renderWithReply();
        const input = screen.getByTestId('quick-ask-reply-input') as HTMLTextAreaElement;
        fireEvent.change(input, { target: { value: '  give an example  ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(reply.onSend).toHaveBeenCalledTimes(1);
        expect(reply.onSend).toHaveBeenCalledWith('give an example');
        expect(input.value).toBe('');
    });

    it('Enter on an empty input is a no-op', () => {
        const reply = renderWithReply();
        const input = screen.getByTestId('quick-ask-reply-input');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(reply.onSend).not.toHaveBeenCalled();
    });

    it('Shift+Enter does NOT send (newline)', () => {
        const reply = renderWithReply();
        const input = screen.getByTestId('quick-ask-reply-input');
        fireEvent.change(input, { target: { value: 'a follow-up' } });
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
        expect(reply.onSend).not.toHaveBeenCalled();
    });

    it('does not send while a follow-up is in flight (disabled)', () => {
        const reply = renderWithReply({ disabled: true });
        const input = screen.getByTestId('quick-ask-reply-input') as HTMLTextAreaElement;
        expect(input.disabled).toBe(true);
        fireEvent.change(input, { target: { value: 'blocked' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(reply.onSend).not.toHaveBeenCalled();
    });

    it('shows a cap notice and disables the input at the soft cap', () => {
        const reply = renderWithReply({ atCap: true, maxTurns: 10 });
        const input = screen.getByTestId('quick-ask-reply-input') as HTMLTextAreaElement;
        expect(input.disabled).toBe(true);
        const notice = screen.getByTestId('quick-ask-reply-cap-notice');
        expect(notice.textContent).toContain('10');
        fireEvent.change(input, { target: { value: 'too many' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(reply.onSend).not.toHaveBeenCalled();
    });

    it('a per-turn error shows an inline Retry keyed to its turn index', () => {
        const reply = renderWithReply({
            turns: [
                turn({ answer: 'first answer' }),
                turn({ question: 'and?', answer: '', status: 'error', error: 'Lookup failed' }),
            ],
        });
        expect(screen.getByTestId('quick-ask-popover-error')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('quick-ask-popover-retry'));
        expect(reply.onRetry).toHaveBeenCalledWith(1);
    });

    it('hides Copy until at least one turn is ready', () => {
        renderWithReply({ turns: [turn({ question: 'q', answer: '', status: 'asking' })] });
        expect(screen.queryByTestId('quick-ask-popover-copy')).toBeNull();
        expect(screen.getByTestId('quick-ask-popover-loading')).toBeInTheDocument();
    });

    it('Dismiss on the reply row deletes the note and closes', () => {
        const onDelete = vi.fn();
        renderWithReply({}, onDelete);
        fireEvent.click(screen.getByTestId('quick-ask-popover-dismiss'));
        expect(onDelete).toHaveBeenCalledWith('n1');
    });

    it('Copy on a multi-turn thread passes the full Q/A transcript (AC-03)', () => {
        const onCopy = vi.fn();
        const full: QuickAskReply = {
            turns: [
                turn({ question: undefined, answer: 'first answer' }),
                turn({ question: 'give an example', answer: 'second answer' }),
            ],
            onSend: vi.fn(),
            onRetry: vi.fn(),
        };
        render(
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 100, left: 100 }}
                onClose={noop}
                onCopy={onCopy}
                onRetry={noop}
                onDelete={noop}
                reply={full}
            />,
        );
        fireEvent.click(screen.getByTestId('quick-ask-popover-copy'));
        expect(onCopy).toHaveBeenCalledTimes(1);
        const text = onCopy.mock.calls[0][1] as string;
        expect(text).toContain('first answer');
        expect(text).toContain('Q: give an example');
        expect(text).toContain('A: second answer');
    });

    it('Copy on a single-turn thread passes just the answer (parity with one-shot)', () => {
        const onCopy = vi.fn();
        const full: QuickAskReply = {
            turns: [turn({ question: 'q', answer: 'only answer' })],
            onSend: vi.fn(),
            onRetry: vi.fn(),
        };
        render(
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 100, left: 100 }}
                onClose={noop}
                onCopy={onCopy}
                onRetry={noop}
                onDelete={noop}
                reply={full}
            />,
        );
        fireEvent.click(screen.getByTestId('quick-ask-popover-copy'));
        expect(onCopy.mock.calls[0][1]).toBe('only answer');
    });
});
