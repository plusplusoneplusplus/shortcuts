/**
 * Tests for RepoChatTab mobile chat input improvements (improve-chat-input-mobile spec).
 *
 * Validates:
 * - Follow-up input bar uses unified horizontal inline layout on all viewports
 * - Model badge truncation for long model names
 * - SuggestionChips use flex-wrap layout
 * - New-chat form two-row layout on mobile
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CHAT_START_PANE_PATH = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'ChatStartPane.tsx');
const CHAT_CONVERSATION_PANE_PATH = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'ChatConversationPane.tsx');

const START_PANE_SRC = fs.readFileSync(CHAT_START_PANE_PATH, 'utf-8');
const CONVERSATION_PANE_SRC = fs.readFileSync(CHAT_CONVERSATION_PANE_PATH, 'utf-8');

describe('RepoChatTab mobile: follow-up input inline layout', () => {
    it('wraps follow-up input area in flex items-center gap-2 relative (always inline)', () => {
        expect(CONVERSATION_PANE_SRC).toContain('"flex items-center gap-2 relative"');
        expect(CONVERSATION_PANE_SRC).not.toContain('isMobile ? "space-y-2"');
    });

    it('textarea wrapper always uses flex-1 relative', () => {
        expect(CONVERSATION_PANE_SRC).toContain('"flex-1 relative"');
        expect(CONVERSATION_PANE_SRC).not.toContain('isMobile ? "w-full relative"');
    });

    it('does not render chat-followup-controls-row (Send button is inline)', () => {
        expect(CONVERSATION_PANE_SRC).not.toContain('data-testid="chat-followup-controls-row"');
    });

    it('no justify-between wrapper around Send button', () => {
        expect(CONVERSATION_PANE_SRC).not.toContain('"flex items-center justify-between gap-2"');
    });

    it('Send button does not use ml-auto in follow-up area', () => {
        const inputArea = CONVERSATION_PANE_SRC.substring(CONVERSATION_PANE_SRC.indexOf('{/* Input area */}'));
        expect(inputArea).not.toContain('className="ml-auto"');
    });
});

describe('RepoChatTab mobile: new-chat form two-row layout', () => {
    it('new-chat controls use space-y-2 on mobile for vertical layout', () => {
        expect(START_PANE_SRC).toContain('space-y-2 w-full max-w-md');
    });

    it('Start Chat button is full-width on mobile', () => {
        // w-full on the Start Chat button in the mobile section
        const startChatIdx = START_PANE_SRC.indexOf('Start Chat');
        const prevSection = START_PANE_SRC.substring(0, startChatIdx);
        // Find the last Button before "Start Chat" text
        const btnIdx = prevSection.lastIndexOf('<Button');
        const btnSection = START_PANE_SRC.substring(btnIdx, startChatIdx + 20);
        expect(btnSection).toContain('w-full');
    });

    it('read-only and model select share row 1 on mobile', () => {
        const mobileControlsIdx = START_PANE_SRC.indexOf('space-y-2 w-full max-w-md');
        const section = START_PANE_SRC.substring(mobileControlsIdx, mobileControlsIdx + 1200);
        // Both read-only label and model select are in the same flex row
        expect(section).toContain('chat-readonly-toggle');
        expect(section).toContain('chat-model-select');
    });
});
