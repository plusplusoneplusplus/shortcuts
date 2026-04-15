/**
 * Tests for useConversationSelection hook.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@plusplusoneplusplus/forge', () => ({}));

import { useConversationSelection } from '../../../../src/server/spa/client/react/hooks/useConversationSelection';

function createMouseEvent(overrides: Partial<React.MouseEvent> = {}): React.MouseEvent {
    return {
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        ...overrides,
    } as React.MouseEvent;
}

describe('useConversationSelection', () => {
    it('starts with selection mode off and empty selection', () => {
        const { result } = renderHook(() => useConversationSelection());

        expect(result.current.isSelecting).toBe(false);
        expect(result.current.selectedTurns.size).toBe(0);
    });

    it('toggleSelecting enables and disables selection mode', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.toggleSelecting());
        expect(result.current.isSelecting).toBe(true);

        act(() => result.current.toggleSelecting());
        expect(result.current.isSelecting).toBe(false);
    });

    it('toggleSelecting clears selection when turning off', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.startSelecting());
        act(() => result.current.handleTurnClick(0, createMouseEvent()));
        expect(result.current.selectedTurns.size).toBe(1);

        act(() => result.current.toggleSelecting());
        expect(result.current.selectedTurns.size).toBe(0);
    });

    it('stopSelecting exits selection mode and clears selection', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.startSelecting());
        act(() => result.current.handleTurnClick(0, createMouseEvent()));

        act(() => result.current.stopSelecting());
        expect(result.current.isSelecting).toBe(false);
        expect(result.current.selectedTurns.size).toBe(0);
    });

    it('plain click in selection mode toggles a single turn', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.startSelecting());
        act(() => result.current.handleTurnClick(2, createMouseEvent()));

        expect(result.current.selectedTurns.has(2)).toBe(true);
        expect(result.current.selectedTurns.size).toBe(1);

        // Click again to deselect
        act(() => result.current.handleTurnClick(2, createMouseEvent()));
        expect(result.current.selectedTurns.has(2)).toBe(false);
        expect(result.current.selectedTurns.size).toBe(0);
    });

    it('does nothing when not in selection mode', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.handleTurnClick(0, createMouseEvent()));
        expect(result.current.selectedTurns.size).toBe(0);
    });

    it('Ctrl+Click toggles individual turns', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.startSelecting());
        act(() => result.current.handleTurnClick(0, createMouseEvent({ ctrlKey: true })));
        act(() => result.current.handleTurnClick(2, createMouseEvent({ ctrlKey: true })));

        expect(result.current.selectedTurns.has(0)).toBe(true);
        expect(result.current.selectedTurns.has(1)).toBe(false);
        expect(result.current.selectedTurns.has(2)).toBe(true);

        // Ctrl+Click again deselects
        act(() => result.current.handleTurnClick(0, createMouseEvent({ ctrlKey: true })));
        expect(result.current.selectedTurns.has(0)).toBe(false);
        expect(result.current.selectedTurns.has(2)).toBe(true);
    });

    it('Shift+Click performs range selection from anchor', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.startSelecting());

        // Click turn 1 to set anchor
        act(() => result.current.handleTurnClick(1, createMouseEvent()));
        expect(result.current.selectedTurns.has(1)).toBe(true);

        // Shift+Click turn 4 to range select 1-4
        act(() => result.current.handleTurnClick(4, createMouseEvent({ shiftKey: true })));

        expect(result.current.selectedTurns.has(1)).toBe(true);
        expect(result.current.selectedTurns.has(2)).toBe(true);
        expect(result.current.selectedTurns.has(3)).toBe(true);
        expect(result.current.selectedTurns.has(4)).toBe(true);
    });

    it('Shift+Click works in reverse direction', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.startSelecting());

        // Click turn 5 to set anchor
        act(() => result.current.handleTurnClick(5, createMouseEvent()));

        // Shift+Click turn 2 to range select 2-5
        act(() => result.current.handleTurnClick(2, createMouseEvent({ shiftKey: true })));

        expect(result.current.selectedTurns.has(2)).toBe(true);
        expect(result.current.selectedTurns.has(3)).toBe(true);
        expect(result.current.selectedTurns.has(4)).toBe(true);
        expect(result.current.selectedTurns.has(5)).toBe(true);
    });

    it('Shift+Click without anchor falls back to toggle', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.startSelecting());

        // Shift+Click without prior click (no anchor)
        act(() => result.current.handleTurnClick(3, createMouseEvent({ shiftKey: true })));

        // Should act like a toggle since there's no prior anchor
        // In our implementation, Shift without anchor will add range from null check
        // Actually, the check is `lastClickAnchorRef.current != null`, and it starts as null
        // So it falls through to the else branch
        expect(result.current.selectedTurns.has(3)).toBe(true);
    });

    it('clearSelection clears all without exiting selection mode', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.startSelecting());
        act(() => result.current.handleTurnClick(0, createMouseEvent()));
        act(() => result.current.handleTurnClick(1, createMouseEvent()));

        act(() => result.current.clearSelection());
        expect(result.current.selectedTurns.size).toBe(0);
        expect(result.current.isSelecting).toBe(true);
    });

    it('selectAll selects all turns up to maxIndex', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.startSelecting());
        act(() => result.current.selectAll(4));

        expect(result.current.selectedTurns.size).toBe(5);
        for (let i = 0; i <= 4; i++) {
            expect(result.current.selectedTurns.has(i)).toBe(true);
        }
    });

    it('metaKey works like ctrlKey for Mac support', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.startSelecting());
        act(() => result.current.handleTurnClick(0, createMouseEvent({ metaKey: true })));

        expect(result.current.selectedTurns.has(0)).toBe(true);
    });

    it('Shift+Click preserves existing selections', () => {
        const { result } = renderHook(() => useConversationSelection());

        act(() => result.current.startSelecting());

        // Select turn 0
        act(() => result.current.handleTurnClick(0, createMouseEvent()));

        // Set anchor at turn 2
        act(() => result.current.handleTurnClick(2, createMouseEvent({ ctrlKey: true })));

        // Shift+Click turn 4 (should add 2-4 to selection, preserving turn 0)
        act(() => result.current.handleTurnClick(4, createMouseEvent({ shiftKey: true })));

        expect(result.current.selectedTurns.has(0)).toBe(true);
        expect(result.current.selectedTurns.has(2)).toBe(true);
        expect(result.current.selectedTurns.has(3)).toBe(true);
        expect(result.current.selectedTurns.has(4)).toBe(true);
    });
});
