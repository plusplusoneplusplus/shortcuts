/**
 * Regression coverage for chat Quick Ask follow-ups.
 *
 * The chat side-note popover used to be one-shot: it rendered a single answer
 * with Copy/Dismiss and no way to reply, because `QuickAskTurnLayer` never
 * passed the popover's `reply` control (only the notes/PDF surfaces did). These
 * tests pin the wiring so the reply row can't silently disappear again.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { QuickAskTurnLayer } from '../../../../src/server/spa/client/react/features/chat/quick-ask/QuickAskTurnLayer';
import { MAX_QUICK_ASK_TURNS }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';
import type { ClientSideNote, QuickAskTurn }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

const TURN_HTML = '<p>Each Mamba block also has a short causal conv1d kernel.</p>';

function note(overrides: Partial<ClientSideNote> = {}): ClientSideNote {
    return {
        id: 'n1',
        processId: 'p1',
        turnIndex: 0,
        anchor: {
            selectedText: 'causal conv1d',
            contextBefore: 'short ',
            contextAfter: ' kernel',
            fingerprint: '',
        },
        question: 'what is causal conv1d',
        answer: 'A one-dimensional convolution.',
        label: 'causal conv1d',
        createdAt: '2026-08-22T00:00:00Z',
        status: 'ready',
        ...overrides,
    };
}

function Harness({
    notes,
    onFollowUp,
    onRetryTurn,
    onCopy,
}: {
    notes: ClientSideNote[];
    onFollowUp?: (id: string, question: string) => void;
    onRetryTurn?: (id: string, turnIndex: number) => void;
    onCopy?: (note: ClientSideNote, text?: string) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div>
            <div ref={ref} data-testid="turn-content" dangerouslySetInnerHTML={{ __html: TURN_HTML }} />
            <QuickAskTurnLayer
                containerRef={ref as unknown as React.RefObject<HTMLElement | null>}
                turnIndex={0}
                notes={notes}
                onAsk={() => {}}
                onRetry={() => {}}
                onDelete={() => {}}
                onCopy={onCopy ?? (() => {})}
                onFollowUp={onFollowUp}
                onRetryTurn={onRetryTurn}
            />
        </div>
    );
}

/** Open the answer popover by clicking the note's inline chip. */
function openPopover(id = 'n1') {
    const chip = document.querySelector<HTMLElement>(`[data-sidenote-id="${id}"]`);
    if (!chip) {throw new Error(`no chip for ${id}`);}
    fireEvent.click(chip);
}

const thread = (n: number): QuickAskTurn[] =>
    Array.from({ length: n }, (_, i) => ({
        question: i === 0 ? 'what is causal conv1d' : `follow-up ${i}`,
        answer: `answer ${i}`,
        status: 'ready' as const,
    }));

describe('QuickAskTurnLayer — chat follow-ups', () => {
    it('renders the follow-up input when the host wires onFollowUp', () => {
        render(<Harness notes={[note()]} onFollowUp={() => {}} />);
        openPopover();
        expect(screen.getByTestId('quick-ask-reply-input')).toBeInTheDocument();
    });

    it('stays one-shot when the host does not wire onFollowUp', () => {
        render(<Harness notes={[note()]} />);
        openPopover();
        expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument();
        expect(screen.queryByTestId('quick-ask-reply-input')).toBeNull();
    });

    it('sends the typed follow-up on Enter', () => {
        const onFollowUp = vi.fn();
        render(<Harness notes={[note()]} onFollowUp={onFollowUp} />);
        openPopover();

        const input = screen.getByTestId('quick-ask-reply-input');
        fireEvent.change(input, { target: { value: 'why kernel width 4?' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onFollowUp).toHaveBeenCalledWith('n1', 'why kernel width 4?');
    });

    it('falls back to the note answer as turn 0 when no thread was hydrated', () => {
        render(<Harness notes={[note({ thread: undefined })]} onFollowUp={() => {}} />);
        openPopover();
        const turns = screen.getByTestId('quick-ask-thread');
        expect(turns.textContent).toContain('A one-dimensional convolution.');
        expect(turns.textContent).toContain('what is causal conv1d');
    });

    it('renders every hydrated turn of a multi-turn thread', () => {
        render(<Harness notes={[note({ thread: thread(3) })]} onFollowUp={() => {}} />);
        openPopover();
        const turns = screen.getByTestId('quick-ask-thread');
        expect(turns.textContent).toContain('answer 0');
        expect(turns.textContent).toContain('follow-up 2');
    });

    it('blocks the input while a turn is in flight', () => {
        const inFlight: QuickAskTurn[] = [
            ...thread(1),
            { question: 'why?', answer: '', status: 'asking' },
        ];
        render(<Harness notes={[note({ thread: inFlight })]} onFollowUp={() => {}} />);
        openPopover();
        expect(screen.getByTestId('quick-ask-reply-input')).toBeDisabled();
    });

    it('blocks the input and shows a notice at the turn cap', () => {
        render(<Harness notes={[note({ thread: thread(MAX_QUICK_ASK_TURNS) })]} onFollowUp={() => {}} />);
        openPopover();
        expect(screen.getByTestId('quick-ask-reply-input')).toBeDisabled();
        expect(screen.getByTestId('quick-ask-reply-cap-notice').textContent)
            .toContain(`max ${MAX_QUICK_ASK_TURNS} turns`);
    });

    it('keeps the one-shot popover for a note that has no answer yet', () => {
        render(<Harness notes={[note({ status: 'error', error: 'Lookup failed' })]} onFollowUp={() => {}} />);
        fireEvent.click(screen.getByTestId('quick-ask-chip-error'));
        expect(screen.queryByTestId('quick-ask-reply-input')).toBeNull();
        expect(screen.getByTestId('quick-ask-popover-retry')).toBeInTheDocument();
    });

    it('copies the whole transcript for a multi-turn thread', () => {
        const onCopy = vi.fn();
        render(<Harness notes={[note({ thread: thread(2) })]} onFollowUp={() => {}} onCopy={onCopy} />);
        openPopover();
        fireEvent.click(screen.getByTestId('quick-ask-popover-copy'));
        const [, text] = onCopy.mock.calls[0];
        expect(text).toContain('Q: follow-up 1');
        expect(text).toContain('A: answer 1');
    });
});
