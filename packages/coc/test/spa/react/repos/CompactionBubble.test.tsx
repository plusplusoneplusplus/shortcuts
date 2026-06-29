/**
 * Tests for the synthetic in-progress `/compact` bubble (AC-02).
 *
 * The bubble is a PURE client render shown while compaction runs — it is never
 * persisted as a conversation turn and never enters model history. It must read
 * as a recognizable user `/compact` action and show a live "Compacting context…"
 * status, surfacing any custom instructions the user typed.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CompactionBubble } from '../../../../src/server/spa/client/react/features/chat/CompactionBubble';

afterEach(() => cleanup());

describe('CompactionBubble', () => {
    it('renders the in-progress "Compacting context…" status', () => {
        render(<CompactionBubble />);
        expect(screen.getByTestId('compaction-bubble')).toBeTruthy();
        expect(screen.getByTestId('compaction-bubble-status').textContent).toMatch(/Compacting context/);
    });

    it('represents the action as a recognizable /compact command', () => {
        render(<CompactionBubble />);
        // No custom instructions → bare command, no trailing space.
        expect(screen.getByTestId('compaction-bubble-command').textContent).toBe('/compact');
    });

    it('surfaces custom instructions after the /compact token', () => {
        render(<CompactionBubble instructions="focus on the auth refactor" />);
        expect(screen.getByTestId('compaction-bubble-command').textContent).toBe('/compact focus on the auth refactor');
    });

    it('trims whitespace-only instructions back to the bare command', () => {
        render(<CompactionBubble instructions="   " />);
        expect(screen.getByTestId('compaction-bubble-command').textContent).toBe('/compact');
    });

    it('is styled as a user-message-style bubble (right-aligned)', () => {
        render(<CompactionBubble />);
        const bubble = screen.getByTestId('compaction-bubble');
        expect(bubble.className).toContain('justify-end');
        expect(bubble.className).toContain('chat-message');
    });
});
