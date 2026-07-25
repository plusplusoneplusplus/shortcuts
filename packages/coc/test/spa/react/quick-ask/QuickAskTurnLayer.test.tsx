import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { QuickAskTurnLayer } from '../../../../src/server/spa/client/react/features/chat/quick-ask/QuickAskTurnLayer';
import { SIDENOTE_ANCHOR_INDICATOR_ATTR, SIDENOTE_FLASH_CLASS, SIDENOTE_HIGHLIGHT_ATTR }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/sidenoteHighlight';
import { SIDENOTE_INLINE_ATTR }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/sidenoteInlineChips';
import type { ClientSideNote, QuickAskAnchor } from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

const TURN_HTML =
    '<p>The Megatron GroupedGEMM kernel and the attention mechanism are fast.</p>';
const TURN_TEXT = 'The Megatron GroupedGEMM kernel and the attention mechanism are fast.';

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

function inlineChips(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(`[${SIDENOTE_INLINE_ATTR}]`));
}

function anchorIndicators(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(`[${SIDENOTE_ANCHOR_INDICATOR_ATTR}]`));
}

/** The inline chip injected for a given side-note id. */
function inlineChipFor(id: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-sidenote-id="${id}"]`);
    if (!el) {throw new Error(`no inline chip for ${id}`);}
    return el;
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

describe('QuickAskTurnLayer — AC-01/AC-02 chip click (via the inline chip)', () => {
    it('locates + highlights the source and opens the popover on one click', () => {
        render(<Harness notes={[groupedGemm]} />);
        fireEvent.click(inlineChipFor('a'));

        // AC-01: source phrase highlighted + scrolled into view.
        const spans = highlightSpans();
        expect(spans.map(s => s.textContent).join('')).toBe('GroupedGEMM');
        expect(scrollSpy).toHaveBeenCalled();
        // AC-02: popover opened on the same click.
        expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument();
    });

    it('re-clicking the same chip closes the popover and clears the highlight', () => {
        render(<Harness notes={[groupedGemm]} />);
        fireEvent.click(inlineChipFor('a'));
        expect(highlightSpans().length).toBeGreaterThan(0);
        expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument();

        fireEvent.click(inlineChipFor('a'));
        expect(highlightSpans()).toHaveLength(0);
        expect(screen.queryByTestId('quick-ask-popover')).toBeNull();
    });

    it('switching to a different chip moves the highlight to the new source', () => {
        render(<Harness notes={[groupedGemm, attention]} />);
        fireEvent.click(inlineChipFor('a'));
        expect(highlightSpans().map(s => s.textContent).join('')).toBe('GroupedGEMM');

        fireEvent.click(inlineChipFor('b'));
        const spans = highlightSpans();
        expect(spans.map(s => s.textContent).join('')).toBe('attention');
        // Only the new highlight remains (prior one cleared).
        expect(spans).toHaveLength(1);
    });

    it('clears the highlight when clicking a blank area', () => {
        render(<Harness notes={[groupedGemm]} />);
        fireEvent.click(inlineChipFor('a'));
        expect(highlightSpans().length).toBeGreaterThan(0);

        fireEvent.mouseDown(document.body);
        expect(highlightSpans()).toHaveLength(0);
    });

    it('not-located note flashes the whole turn and still opens the popover', () => {
        render(<Harness notes={[missing]} />);
        // A not-located note stays in the footer row.
        fireEvent.click(screen.getByTestId('quick-ask-chip'));

        // AC-04 fallback: no source highlight, whole turn flashed, turn scrolled.
        expect(highlightSpans()).toHaveLength(0);
        expect(screen.getByTestId('turn-content').classList.contains(SIDENOTE_FLASH_CLASS)).toBe(true);
        expect(scrollSpy).toHaveBeenCalled();
        // AC-02: popover still opens.
        expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument();
    });
});

describe('QuickAskTurnLayer — AC-03 inline chip placement', () => {
    it('renders a located note as an inline chip at its source, not in the footer', () => {
        render(<Harness notes={[groupedGemm]} />);

        // Inline chip injected inside the rendered turn, right after "GroupedGEMM".
        const chip = inlineChipFor('a');
        expect(screen.getByTestId('turn-content').contains(chip)).toBe(true);
        const prev = chip.previousSibling as Text | null;
        expect(prev?.textContent?.endsWith('GroupedGEMM')).toBe(true);

        // Located → not in the footer; with nothing left, the footer row is gone.
        expect(screen.queryByTestId('quick-ask-chip')).toBeNull();
        expect(screen.queryByTestId('quick-ask-sidenote-row')).toBeNull();
    });

    it('keeps an un-located note in the footer with no inline chip', () => {
        render(<Harness notes={[missing]} />);

        expect(inlineChips()).toHaveLength(0);
        expect(screen.getByTestId('quick-ask-chip')).toBeInTheDocument();
        expect(screen.getByTestId('quick-ask-sidenote-row')).toBeInTheDocument();
    });

    it('partitions mixed notes: located inline, un-located in the footer', () => {
        render(<Harness notes={[groupedGemm, missing]} />);

        // groupedGemm resolves → inline; missing does not → footer.
        expect(inlineChips().map(c => c.getAttribute('data-sidenote-id'))).toEqual(['a']);
        const footerChips = screen.getAllByTestId('quick-ask-chip');
        expect(footerChips).toHaveLength(1);
        expect(footerChips[0].getAttribute('title')).toBe('nonexistent phrase');
        // Footer count reflects only the fallback (un-located) notes.
        expect(screen.getByTestId('quick-ask-sidenote-row').textContent).toContain('Side notes (1)');
    });

    it('inline injection leaves container.textContent unchanged (no pollution)', () => {
        render(<Harness notes={[groupedGemm, attention]} />);
        // Both notes resolve inline; the injected markers add no characters.
        expect(inlineChips()).toHaveLength(2);
        expect(screen.getByTestId('turn-content').textContent).toBe(TURN_TEXT);
    });

    it('clicking the inline chip highlights the source and opens the popover', () => {
        render(<Harness notes={[groupedGemm]} />);
        fireEvent.click(inlineChipFor('a'));
        expect(highlightSpans().map(s => s.textContent).join('')).toBe('GroupedGEMM');
        expect(screen.getByTestId('quick-ask-popover')).toBeInTheDocument();
    });

    it('renders no inline chips and no footer when there are no notes', () => {
        render(<Harness notes={[]} />);
        expect(inlineChips()).toHaveLength(0);
        expect(screen.queryByTestId('quick-ask-sidenote-row')).toBeNull();
    });

    it('renders both the inline chip and the persistent anchor indicator for a located note', () => {
        render(<Harness notes={[groupedGemm]} />);

        const chip = inlineChipFor('a');
        expect(screen.getByTestId('turn-content').contains(chip)).toBe(true);
        const indicators = anchorIndicators();
        expect(indicators).toHaveLength(1);
        expect(indicators[0].textContent).toBe('GroupedGEMM');
        expect(screen.getByTestId('turn-content').contains(indicators[0])).toBe(true);
    });

    it('does not add an indicator or chip for an un-located note', () => {
        render(<Harness notes={[missing]} />);
        expect(anchorIndicators()).toHaveLength(0);
        expect(inlineChips()).toHaveLength(0);
    });

    it('clears both the chip and the indicator on re-render when the note is removed', () => {
        const { rerender } = render(<Harness notes={[groupedGemm]} />);
        expect(inlineChips()).toHaveLength(1);
        expect(anchorIndicators()).toHaveLength(1);

        rerender(<Harness notes={[]} />);
        expect(inlineChips()).toHaveLength(0);
        expect(anchorIndicators()).toHaveLength(0);
        expect(screen.getByTestId('turn-content').textContent).toBe(TURN_TEXT);
    });

    it('sets data-tip on the inline chip to the full selected text', () => {
        render(<Harness notes={[groupedGemm]} />);
        expect(inlineChipFor('a').getAttribute('data-tip')).toBe('GroupedGEMM');
    });
});
