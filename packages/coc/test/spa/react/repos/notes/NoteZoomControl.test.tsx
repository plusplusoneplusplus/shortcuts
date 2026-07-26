/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteZoomControl } from '../../../../../src/server/spa/client/react/features/notes/editor/NoteZoomControl';
import { useNoteZoom } from '../../../../../src/server/spa/client/react/features/notes/editor/useNoteZoom';

const WS = 'ws-zoom-ctl';
const NOTE = 'folder/note.md';

/** Harness: drives the real `useNoteZoom` store so the control behaves as in-app. */
function Harness() {
    const zoom = useNoteZoom(WS, NOTE);
    return <NoteZoomControl zoom={zoom} />;
}

function readout(): string {
    return screen.getByTestId('note-zoom-readout').textContent ?? '';
}

describe('NoteZoomControl (AC-01)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('renders −, an always-visible percentage readout (even at 100%), and +', () => {
        render(<Harness />);
        expect(screen.getByTestId('note-zoom-out')).toBeTruthy();
        expect(screen.getByTestId('note-zoom-in')).toBeTruthy();
        // Percentage is always shown, including at the 100% default.
        expect(readout()).toBe('100%');
    });

    it('+ / − step the zoom by 10%', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('note-zoom-in'));
        fireEvent.click(screen.getByTestId('note-zoom-in'));
        expect(readout()).toBe('120%');
        fireEvent.click(screen.getByTestId('note-zoom-out'));
        fireEvent.click(screen.getByTestId('note-zoom-out'));
        fireEvent.click(screen.getByTestId('note-zoom-out'));
        expect(readout()).toBe('90%');
    });

    it('clamps at 200% and disables + at the max', () => {
        render(<Harness />);
        for (let i = 0; i < 20; i++) fireEvent.click(screen.getByTestId('note-zoom-in'));
        expect(readout()).toBe('200%');
        expect((screen.getByTestId('note-zoom-in') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('note-zoom-out') as HTMLButtonElement).disabled).toBe(false);
    });

    it('clamps at 50% and disables − at the min', () => {
        render(<Harness />);
        for (let i = 0; i < 20; i++) fireEvent.click(screen.getByTestId('note-zoom-out'));
        expect(readout()).toBe('50%');
        expect((screen.getByTestId('note-zoom-out') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('note-zoom-in') as HTMLButtonElement).disabled).toBe(false);
    });

    it('opens the preset menu and selects an exact level', () => {
        render(<Harness />);
        expect(screen.queryByTestId('note-zoom-menu')).toBeNull();
        fireEvent.click(screen.getByTestId('note-zoom-readout'));
        // All presets are listed.
        for (const p of [50, 67, 80, 90, 100, 110, 125, 150, 175, 200]) {
            expect(screen.getByTestId(`note-zoom-preset-${p}`)).toBeTruthy();
        }
        fireEvent.click(screen.getByTestId('note-zoom-preset-150'));
        expect(readout()).toBe('150%');
        // Menu closes after selecting.
        expect(screen.queryByTestId('note-zoom-menu')).toBeNull();
    });

    it('offers a reset to 100% in the preset menu', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('note-zoom-in'));
        expect(readout()).toBe('110%');
        fireEvent.click(screen.getByTestId('note-zoom-readout'));
        fireEvent.click(screen.getByTestId('note-zoom-reset'));
        expect(readout()).toBe('100%');
    });
});
