import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuickAskSidenotePopover }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/QuickAskSidenotePopover';
import type { ClientSideNote }
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
