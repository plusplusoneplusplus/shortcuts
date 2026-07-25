import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';

const { getSelectionMock } = vi.hoisted(() => ({ getSelectionMock: vi.fn() }));

vi.mock('../../../../src/server/spa/client/react/features/chat/quick-ask/quick-ask-selection', () => ({
    getQuickAskSelection: getSelectionMock,
    // deriveContext is imported by the hook, not this layer; keep a stub for safety.
    deriveContext: () => ({ contextBefore: '', contextAfter: '' }),
    isSelectableText: () => true,
    MIN_SELECTION_CHARS: 2,
    CONTEXT_CHARS: 80,
}));

import { QuickAskTurnLayer } from '../../../../src/server/spa/client/react/features/chat/quick-ask/QuickAskTurnLayer';
import type { QuickAskSelection } from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

const SELECTION: QuickAskSelection = {
    turnIndex: 0,
    selectedText: 'GroupedGEMM',
    contextBefore: 'the ',
    contextAfter: ' kernel',
    rect: { top: 200, left: 120, bottom: 220, right: 260 },
};

function Harness({ onAsk }: { onAsk: (s: QuickAskSelection, q?: string) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div>
            <div ref={ref} data-testid="turn-content">The GroupedGEMM kernel is fast.</div>
            <QuickAskTurnLayer
                containerRef={ref as unknown as React.RefObject<HTMLElement | null>}
                turnIndex={0}
                notes={[]}
                onAsk={onAsk}
                onRetry={() => {}}
                onDelete={() => {}}
                onCopy={() => {}}
            />
        </div>
    );
}

const field = () => screen.getByTestId('quick-ask-input-field') as HTMLInputElement;

beforeEach(() => {
    getSelectionMock.mockReset();
    getSelectionMock.mockReturnValue(SELECTION);
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Raise the pill by simulating a pointer selection in the turn. */
async function raisePill() {
    fireEvent.mouseUp(document);
    await waitFor(() => expect(screen.getByTestId('quick-ask-pill')).toBeInTheDocument());
}

describe('QuickAskTurnLayer — Ask AI custom input (AC-01/AC-02)', () => {
    it('clicking the pill expands into the input instead of firing immediately', async () => {
        const onAsk = vi.fn();
        render(<Harness onAsk={onAsk} />);
        await raisePill();

        fireEvent.click(screen.getByTestId('quick-ask-pill'));

        // Pill replaced by the input; no lookup fired yet.
        expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument();
        expect(screen.queryByTestId('quick-ask-pill')).toBeNull();
        expect(onAsk).not.toHaveBeenCalled();
    });

    it('submitting a typed question calls onAsk with the trimmed question', async () => {
        const onAsk = vi.fn();
        render(<Harness onAsk={onAsk} />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));

        fireEvent.change(field(), { target: { value: '  why does this matter?  ' } });
        fireEvent.keyDown(field(), { key: 'Enter' });

        expect(onAsk).toHaveBeenCalledTimes(1);
        expect(onAsk).toHaveBeenCalledWith(SELECTION, 'why does this matter?');
        // Input dismissed after submit.
        expect(screen.queryByTestId('quick-ask-input')).toBeNull();
    });

    it('empty submit calls onAsk with question undefined (default-explain fast path)', async () => {
        const onAsk = vi.fn();
        render(<Harness onAsk={onAsk} />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));

        fireEvent.keyDown(field(), { key: 'Enter' });

        expect(onAsk).toHaveBeenCalledWith(SELECTION, undefined);
    });

    it('whitespace-only submit also leaves question undefined', async () => {
        const onAsk = vi.fn();
        render(<Harness onAsk={onAsk} />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));

        fireEvent.change(field(), { target: { value: '   ' } });
        fireEvent.keyDown(field(), { key: 'Enter' });

        expect(onAsk).toHaveBeenCalledWith(SELECTION, undefined);
    });

    it('Escape cancels the input without creating a side-note', async () => {
        const onAsk = vi.fn();
        render(<Harness onAsk={onAsk} />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));

        fireEvent.keyDown(field(), { key: 'Escape' });

        expect(onAsk).not.toHaveBeenCalled();
        expect(screen.queryByTestId('quick-ask-input')).toBeNull();
    });

    it('Cmd/Ctrl+J opens the input instead of firing the lookup', async () => {
        const onAsk = vi.fn();
        render(<Harness onAsk={onAsk} />);

        fireEvent.keyDown(document, { key: 'j', ctrlKey: true });

        await waitFor(() => expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument());
        expect(onAsk).not.toHaveBeenCalled();

        fireEvent.change(field(), { target: { value: 'clarify' } });
        fireEvent.keyDown(field(), { key: 'Enter' });
        expect(onAsk).toHaveBeenCalledWith(SELECTION, 'clarify');
    });

    it('pointer-down outside the input dismisses it', async () => {
        const onAsk = vi.fn();
        render(<Harness onAsk={onAsk} />);
        await raisePill();
        fireEvent.click(screen.getByTestId('quick-ask-pill'));
        expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('quick-ask-input')).toBeNull();
        expect(onAsk).not.toHaveBeenCalled();
    });
});
