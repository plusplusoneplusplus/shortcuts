import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { QuickAskTurnLayer } from '../../../../src/server/spa/client/react/features/chat/quick-ask/QuickAskTurnLayer';
import { SIDENOTE_FLASH_CLASS, SIDENOTE_HIGHLIGHT_ATTR }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/sidenoteHighlight';
import type { ClientSideNote, QuickAskAnchor } from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

const TURN_HTML =
    '<p>The Megatron GroupedGEMM kernel and the attention mechanism are fast.</p>';

function note(id: string, anchor: Partial<QuickAskAnchor>, label: string): ClientSideNote {
    return {
        id,
        processId: 'p1',
        turnIndex: 0,
        anchor: { selectedText: '', contextBefore: '', contextAfter: '', fingerprint: '', ...anchor },
        answer: `answer for ${label}`,
        label,
        createdAt: '2026-07-25T00:00:00Z',
        status: 'ready',
    };
}

/** Renders the turn content container + the layer sharing one ref (mirrors the
 *  real mount where `containerRef` is the rendered-turn content element). */
function Harness({ notes }: { notes: ClientSideNote[] }) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div>
            <div
                ref={ref}
                data-testid="turn-content"
                dangerouslySetInnerHTML={{ __html: TURN_HTML }}
            />
            <QuickAskTurnLayer
                containerRef={ref as unknown as React.RefObject<HTMLElement | null>}
                turnIndex={0}
                notes={notes}
                onAsk={() => {}}
                onRetry={() => {}}
                onDelete={() => {}}
                onCopy={() => {}}
            />
        </div>
    );
}

function highlightSpans(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(`[${SIDENOTE_HIGHLIGHT_ATTR}]`));
}

const groupedGemm = note('a', { selectedText: 'GroupedGEMM', contextBefore: 'Megatron ', contextAfter: ' kernel' }, 'grouped');
const attention = note('b', { selectedText: 'attention', contextBefore: 'the ', contextAfter: ' mechanism' }, 'attn');
const missing = note('c', { selectedText: 'nonexistent phrase', contextBefore: 'x', contextAfter: 'y' }, 'missing');

let scrollSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    // jsdom does not implement scrollIntoView; install a spy so AC-01's
    // scroll-into-view can be asserted.
    scrollSpy = vi.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollSpy;
});

afterEach(() => {
    // Note: do NOT wipe document.body here — Testing Library's auto-cleanup
    // unmounts the React root in its own afterEach, and clearing the DOM first
    // makes React's unmount throw "node to be removed is not a child".
    delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    vi.restoreAllMocks();
});

describe('QuickAskTurnLayer — AC-01/AC-02 chip click', () => {
    it('locates + highlights the source and opens the popover on one click', () => {
        render(<Harness notes={[groupedGemm]} />);
        fireEvent.click(screen.getByTestId('quick-ask-chip'));

        // AC-01: source phrase highlighted + scrolled into view.
        const spans = highlightSpans();
        expect(spans.map(s => s.textContent).join('')).toBe('GroupedGEMM');
        expect(scrollSpy).toHaveBeenCalled();
        // AC-02: popover opened on the same click.
        expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument();
    });

    it('re-clicking the same chip closes the popover and clears the highlight', () => {
        render(<Harness notes={[groupedGemm]} />);
        const chip = screen.getByTestId('quick-ask-chip');
        fireEvent.click(chip);
        expect(highlightSpans().length).toBeGreaterThan(0);
        expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument();

        fireEvent.click(chip);
        expect(highlightSpans()).toHaveLength(0);
        expect(screen.queryByTestId('quick-ask-popover')).toBeNull();
    });

    it('switching to a different chip moves the highlight to the new source', () => {
        render(<Harness notes={[groupedGemm, attention]} />);
        const chips = screen.getAllByTestId('quick-ask-chip');
        fireEvent.click(chips[0]);
        expect(highlightSpans().map(s => s.textContent).join('')).toBe('GroupedGEMM');

        fireEvent.click(chips[1]);
        const spans = highlightSpans();
        expect(spans.map(s => s.textContent).join('')).toBe('attention');
        // Only the new highlight remains (prior one cleared).
        expect(spans).toHaveLength(1);
    });

    it('clears the highlight when clicking a blank area', () => {
        render(<Harness notes={[groupedGemm]} />);
        fireEvent.click(screen.getByTestId('quick-ask-chip'));
        expect(highlightSpans().length).toBeGreaterThan(0);

        fireEvent.mouseDown(document.body);
        expect(highlightSpans()).toHaveLength(0);
    });

    it('not-located note flashes the whole turn and still opens the popover', () => {
        render(<Harness notes={[missing]} />);
        fireEvent.click(screen.getByTestId('quick-ask-chip'));

        // AC-04 fallback: no source highlight, whole turn flashed, turn scrolled.
        expect(highlightSpans()).toHaveLength(0);
        expect(screen.getByTestId('turn-content').classList.contains(SIDENOTE_FLASH_CLASS)).toBe(true);
        expect(scrollSpy).toHaveBeenCalled();
        // AC-02: popover still opens.
        expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument();
    });
});
