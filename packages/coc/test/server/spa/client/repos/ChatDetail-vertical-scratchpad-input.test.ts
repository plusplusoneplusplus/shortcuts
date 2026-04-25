/**
 * @vitest-environment node
 *
 * Static analysis tests: verifies that ChatDetail places the follow-up input
 * area inside the chat column (not full-width) when the scratchpad is open in
 * vertical split mode.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SPA_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');

describe('ChatDetail vertical scratchpad input placement', () => {
    let source: string;
    let lines: string[];

    beforeAll(() => {
        source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');
        lines = source.split('\n');
    });

    it('derives isVerticalScratchpad from scratchpadEnabled, isOpen, and vertical layout', () => {
        expect(source).toMatch(
            /isVerticalScratchpad\s*=\s*scratchpadEnabled\s*&&\s*scratchpad\.isOpen\s*&&\s*scratchpadLayout\s*===\s*['"]vertical['"]/
        );
    });

    it('uses isVerticalScratchpad to toggle the scratchpad container flex direction', () => {
        expect(source).toMatch(/isVerticalScratchpad\s*\?\s*['"]flex-row['"]\s*:\s*['"]flex-col['"]/);
    });

    it('adds flex-col to the chat column (always, not conditional)', () => {
        // The chat column outer div uses flex-col always; only min-h-0 is toggled
        expect(source).toMatch(/relative flex flex-col min-w-0 overflow-hidden/);
        // min-h-0 is added conditionally for vertical scratchpad
        expect(source).toMatch(/isVerticalScratchpad\s*\?\s*['"]min-h-0['"]\s*:\s*['"]['"]/)
    });

    it('wraps ConversationArea and MiniMap in an inner row div', () => {
        expect(source).toMatch(/relative flex flex-1 min-h-0 overflow-hidden min-w-0/);
    });

    it('renders FollowUpInputArea inside chat column for vertical scratchpad', () => {
        // Both guards for the input area inside the chat column reference isVerticalScratchpad
        expect(source).toMatch(/isVerticalScratchpad\s*&&\s*!isPending\s*&&\s*noSessionForFollowUp\s*&&\s*!readOnly/);
        expect(source).toMatch(/isVerticalScratchpad\s*&&\s*!isPending\s*&&\s*!noSessionForFollowUp\s*&&\s*!readOnly/);
    });

    it('guards the outer input area with !isVerticalScratchpad for horizontal/closed scratchpad paths', () => {
        expect(source).toMatch(/!isVerticalScratchpad\s*&&\s*!isPending\s*&&\s*noSessionForFollowUp\s*&&\s*!readOnly/);
        expect(source).toMatch(/!isVerticalScratchpad\s*&&\s*!isPending\s*&&\s*!noSessionForFollowUp\s*&&\s*!readOnly/);
    });

    it('does not render FollowUpInputArea outside the chat column in vertical scratchpad mode', () => {
        // The outer conditions (guarding input rendered after the scratchpad container)
        // must always be preceded by !isVerticalScratchpad so they are suppressed in vertical mode.
        const outerNoSession = lines.filter(l =>
            l.includes('!isVerticalScratchpad') && l.includes('noSessionForFollowUp') && l.includes('!isPending')
        );
        const outerFollowUp = lines.filter(l =>
            l.includes('!isVerticalScratchpad') && l.includes('!noSessionForFollowUp') && l.includes('!isPending')
        );
        expect(outerNoSession.length).toBeGreaterThanOrEqual(1);
        expect(outerFollowUp.length).toBeGreaterThanOrEqual(1);
    });
});
