// @vitest-environment jsdom
/**
 * Render tests for NoteContextBanner — the slim switched-note warning strip.
 *
 * The banner now renders NOTHING in the common (non-switched) case, keeping the
 * Notes Chat surface to a single header row. It only appears as an amber
 * one-line warning strip when the chat is attached to a different note than the
 * one currently selected. The note title/path + path-reference affordance moved
 * to NotesChatHeader's 📎 button.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteContextBanner } from '../../../../../../src/server/spa/client/react/features/notes/editor/NoteContextBanner';

describe('NoteContextBanner (render)', () => {
    it('renders nothing when not switched (single-row common case)', () => {
        const { container } = render(
            <NoteContextBanner chatNotePath="Plans/roadmap.md" chatNoteTitle="roadmap" isSwitched={false} />,
        );
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByTestId('note-context-banner')).toBeNull();
        expect(screen.queryByTestId('note-anchor-hint')).toBeNull();
    });

    it('renders the amber warning strip when switched', () => {
        render(
            <NoteContextBanner chatNotePath="Plans/roadmap.md" chatNoteTitle="roadmap" isSwitched={true} />,
        );
        expect(screen.getByTestId('note-context-banner')).toBeTruthy();
        const hint = screen.getByTestId('note-anchor-hint');
        expect(hint).toHaveTextContent('This chat is about roadmap');
    });

    it('uses amber warning styling on the switched strip', () => {
        render(
            <NoteContextBanner chatNotePath="Plans/roadmap.md" chatNoteTitle="roadmap" isSwitched={true} />,
        );
        expect(screen.getByTestId('note-context-banner').className).toContain('bg-[#fff8c5]');
        expect(screen.getByTestId('note-anchor-hint').className).toContain('text-[#9a6700]');
    });

    it('derives the display title from the path when chatNoteTitle is missing', () => {
        render(
            <NoteContextBanner chatNotePath="Plans/roadmap.md" chatNoteTitle={null} isSwitched={true} />,
        );
        expect(screen.getByTestId('note-anchor-hint')).toHaveTextContent('This chat is about roadmap');
    });

    it('does not render the removed path-reference chip', () => {
        render(
            <NoteContextBanner chatNotePath="Plans/roadmap.md" chatNoteTitle="roadmap" isSwitched={true} />,
        );
        expect(screen.queryByTestId('note-status-chip')).toBeNull();
        expect(screen.queryByText('📎 Path reference')).toBeNull();
    });

    describe('actions', () => {
        it('renders neither action when no handler is supplied', () => {
            render(<NoteContextBanner chatNotePath="Plans/roadmap.md" chatNoteTitle="roadmap" isSwitched />);
            expect(screen.queryByTestId('note-context-continue-here')).toBeNull();
            expect(screen.queryByTestId('note-context-use-section-scope')).toBeNull();
        });

        it('invokes onContinueHere', () => {
            const onContinueHere = vi.fn();
            render(
                <NoteContextBanner
                    chatNotePath="Plans/roadmap.md"
                    chatNoteTitle="roadmap"
                    isSwitched
                    onContinueHere={onContinueHere}
                />,
            );
            fireEvent.click(screen.getByTestId('note-context-continue-here'));
            expect(onContinueHere).toHaveBeenCalledTimes(1);
        });

        it('invokes onUseSectionScope', () => {
            const onUseSectionScope = vi.fn();
            render(
                <NoteContextBanner
                    chatNotePath="Plans/roadmap.md"
                    chatNoteTitle="roadmap"
                    isSwitched
                    onUseSectionScope={onUseSectionScope}
                />,
            );
            fireEvent.click(screen.getByTestId('note-context-use-section-scope'));
            expect(onUseSectionScope).toHaveBeenCalledTimes(1);
        });

        it('renders nothing at all when not switched, actions or no actions', () => {
            const { container } = render(
                <NoteContextBanner
                    chatNotePath="Plans/roadmap.md"
                    chatNoteTitle="roadmap"
                    isSwitched={false}
                    onContinueHere={vi.fn()}
                    onUseSectionScope={vi.fn()}
                />,
            );
            expect(container).toBeEmptyDOMElement();
        });
    });
});
