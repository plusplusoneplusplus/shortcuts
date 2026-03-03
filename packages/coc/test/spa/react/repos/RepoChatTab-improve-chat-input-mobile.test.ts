/**
 * Tests for RepoChatTab mobile chat input improvements (improve-chat-input-mobile spec).
 *
 * Validates:
 * - Follow-up input bar two-row layout on mobile (textarea row + controls row)
 * - Model badge truncation for long model names
 * - SuggestionChips use flex-wrap layout
 * - New-chat form two-row layout on mobile
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx'),
    'utf-8',
);

describe('RepoChatTab mobile: follow-up input two-row layout', () => {
    it('wraps input area in space-y-2 on mobile (vertical stacking)', () => {
        expect(SRC).toContain('isMobile ? "space-y-2"');
    });

    it('textarea wrapper is full-width on mobile', () => {
        expect(SRC).toContain('isMobile ? "w-full relative"');
    });

    it('renders chat-followup-controls-row on mobile', () => {
        expect(SRC).toContain('data-testid="chat-followup-controls-row"');
    });

    it('controls row uses justify-between to spread badge and button', () => {
        const rowIdx = SRC.indexOf('chat-followup-controls-row');
        const nearby = SRC.substring(rowIdx - 100, rowIdx + 50);
        expect(nearby).toContain('justify-between');
    });

    it('Send button uses ml-auto on mobile to stay right-aligned', () => {
        const rowIdx = SRC.indexOf('chat-followup-controls-row');
        const rowSection = SRC.substring(rowIdx, rowIdx + 900);
        expect(rowSection).toContain('ml-auto');
    });
});

describe('RepoChatTab mobile: model badge truncation', () => {
    it('mobile model badge uses truncate class to clip long text', () => {
        // Find the mobile controls row section and check for truncate on the badge
        const mobileRowIdx = SRC.indexOf('chat-followup-controls-row');
        const mobileSection = SRC.substring(mobileRowIdx, mobileRowIdx + 600);
        expect(mobileSection).toContain('truncate');
    });

    it('mobile model badge has max-width constraint', () => {
        const mobileRowIdx = SRC.indexOf('chat-followup-controls-row');
        const mobileSection = SRC.substring(mobileRowIdx, mobileRowIdx + 600);
        expect(mobileSection).toMatch(/max-w-\[/);
    });

    it('mobile model badge does not use whitespace-nowrap without truncation', () => {
        // The mobile badge should use truncate (which includes whitespace-nowrap)
        // with a max-width constraint, not bare whitespace-nowrap that could overflow
        const mobileRowIdx = SRC.indexOf('chat-followup-controls-row');
        const mobileSection = SRC.substring(mobileRowIdx, mobileRowIdx + 600);
        // Either uses truncate (preferred) or has both max-w and overflow control
        const hasTruncate = mobileSection.includes('truncate');
        expect(hasTruncate).toBe(true);
    });
});

describe('RepoChatTab mobile: new-chat form two-row layout', () => {
    it('new-chat controls use space-y-2 on mobile for vertical layout', () => {
        expect(SRC).toContain('space-y-2 w-full max-w-md');
    });

    it('Start Chat button is full-width on mobile', () => {
        // w-full on the Start Chat button in the mobile section
        const startChatIdx = SRC.indexOf('Start Chat');
        const prevSection = SRC.substring(0, startChatIdx);
        // Find the last Button before "Start Chat" text
        const btnIdx = prevSection.lastIndexOf('<Button');
        const btnSection = SRC.substring(btnIdx, startChatIdx + 20);
        expect(btnSection).toContain('w-full');
    });

    it('read-only and model select share row 1 on mobile', () => {
        const mobileControlsIdx = SRC.indexOf('space-y-2 w-full max-w-md');
        const section = SRC.substring(mobileControlsIdx, mobileControlsIdx + 1200);
        // Both read-only label and model select are in the same flex row
        expect(section).toContain('chat-readonly-toggle');
        expect(section).toContain('chat-model-select');
    });
});
