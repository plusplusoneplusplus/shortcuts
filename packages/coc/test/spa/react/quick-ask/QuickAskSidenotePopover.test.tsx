import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuickAskSidenotePopover }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/QuickAskSidenotePopover';
import type { ClientSideNote } from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

function note(overrides: Partial<ClientSideNote> = {}): ClientSideNote {
    return {
        id: 'n1',
        processId: 'p1',
        turnIndex: 0,
        anchor: { selectedText: 'cascade', contextBefore: '', contextAfter: '', fingerprint: '' },
        answer: 'answer body',
        label: 'cascade',
        createdAt: '2026-07-25T00:00:00Z',
        status: 'ready',
        ...overrides,
    };
}

function renderPopover(onClose = vi.fn()) {
    render(
        <div>
            <button data-testid="outside">outside</button>
            <span data-testid="quick-ask-chip-n1">chip</span>
            <QuickAskSidenotePopover
                note={note()}
                position={{ top: 10, left: 10 }}
                onClose={onClose}
                onCopy={() => {}}
                onRetry={() => {}}
                onDelete={() => {}}
            />
        </div>,
    );
    return onClose;
}

describe('QuickAskSidenotePopover outside-click dismissal', () => {
    afterEach(() => {
        cleanup();
    });

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
