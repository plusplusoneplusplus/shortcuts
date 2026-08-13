import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';

const { getSelectionMock } = vi.hoisted(() => ({ getSelectionMock: vi.fn() }));

vi.mock('../../../../src/server/spa/client/react/features/chat/quick-ask/quick-ask-selection', () => ({
    getQuickAskSelection: getSelectionMock,
    deriveContext: () => ({ contextBefore: '', contextAfter: '' }),
    isSelectableText: () => true,
    MIN_SELECTION_CHARS: 2,
    CONTEXT_CHARS: 80,
}));

import { QuickAskTurnLayer } from '../../../../src/server/spa/client/react/features/chat/quick-ask/QuickAskTurnLayer';
import type { QuickAskSelection } from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

const SELECTION: QuickAskSelection = {
    turnIndex: 3,
    selectedText: 'GroupedGEMM',
    contextBefore: 'the ',
    contextAfter: ' kernel',
    rect: { top: 200, left: 120, bottom: 220, right: 260 },
};

type AttachFn = (turnIndex: number, role: 'user' | 'assistant', snippet: string) => void;

function Harness({ onAttachContext, onAsk }: { onAttachContext?: AttachFn; onAsk?: (s: QuickAskSelection, q?: string) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div>
            <div ref={ref} data-testid="turn-content">The GroupedGEMM kernel is fast.</div>
            <QuickAskTurnLayer
                containerRef={ref as unknown as React.RefObject<HTMLElement | null>}
                turnIndex={3}
                notes={[]}
                onAsk={onAsk ?? (() => {})}
                onRetry={() => {}}
                onDelete={() => {}}
                onCopy={() => {}}
                onAttachContext={onAttachContext}
            />
        </div>
    );
}

/** Raise the pill by simulating a pointer selection in the turn. */
async function raisePill() {
    fireEvent.mouseUp(document);
    await waitFor(() => expect(screen.getByTestId('quick-ask-pill')).toBeInTheDocument());
}

beforeEach(() => {
    getSelectionMock.mockReset();
    getSelectionMock.mockReturnValue(SELECTION);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('QuickAskTurnLayer — 📎 Attach split pill', () => {
    it('renders the attach action only when onAttachContext is supplied', async () => {
        const { unmount } = render(<Harness />);
        await raisePill();
        expect(screen.queryByTestId('quick-ask-attach-pill')).toBeNull();
        unmount();

        render(<Harness onAttachContext={vi.fn()} />);
        await raisePill();
        expect(screen.getByTestId('quick-ask-attach-pill')).toBeInTheDocument();
    });

    it('clicking attach calls the handler with turnIndex, assistant role and the selected text', async () => {
        const onAttachContext = vi.fn();
        render(<Harness onAttachContext={onAttachContext} />);
        await raisePill();

        fireEvent.click(screen.getByTestId('quick-ask-attach-pill'));

        expect(onAttachContext).toHaveBeenCalledTimes(1);
        expect(onAttachContext).toHaveBeenCalledWith(3, 'assistant', 'GroupedGEMM');
    });

    it('dismisses the pill after attaching, without opening the ask input', async () => {
        const onAsk = vi.fn();
        render(<Harness onAttachContext={vi.fn()} onAsk={onAsk} />);
        await raisePill();

        fireEvent.click(screen.getByTestId('quick-ask-attach-pill'));

        await waitFor(() => expect(screen.queryByTestId('quick-ask-pill')).toBeNull());
        expect(screen.queryByTestId('quick-ask-attach-pill')).toBeNull();
        expect(screen.queryByTestId('quick-ask-input')).toBeNull();
        expect(onAsk).not.toHaveBeenCalled();
    });

    it('keeps mousedown on either pill action from clearing the selection', async () => {
        render(<Harness onAttachContext={vi.fn()} />);
        await raisePill();

        fireEvent.mouseDown(screen.getByTestId('quick-ask-attach-pill'));
        expect(screen.getByTestId('quick-ask-attach-pill')).toBeInTheDocument();

        fireEvent.mouseDown(screen.getByTestId('quick-ask-pill'));
        expect(screen.getByTestId('quick-ask-pill')).toBeInTheDocument();
    });

    it('regression: Ask AI still expands into the question input alongside attach', async () => {
        const onAttachContext = vi.fn();
        const onAsk = vi.fn();
        render(<Harness onAttachContext={onAttachContext} onAsk={onAsk} />);
        await raisePill();

        fireEvent.click(screen.getByTestId('quick-ask-pill'));

        expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument();
        expect(screen.queryByTestId('quick-ask-pill')).toBeNull();
        expect(onAttachContext).not.toHaveBeenCalled();
        expect(onAsk).not.toHaveBeenCalled();
    });
});
