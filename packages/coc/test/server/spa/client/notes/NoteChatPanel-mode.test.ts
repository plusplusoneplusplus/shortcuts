/**
 * @vitest-environment node
 *
 * Static analysis test: NoteChatPanel must render the ask/autopilot mode
 * toggle inline with the empty-state composer (not the header — the mode
 * control is intentionally kept out of the compact Notes Chat header per
 * the notes-chat-compact-header plan) and pass allowedModes (no plan) to
 * ChatDetail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PANEL_PATH = resolve(
    __dirname,
    '../../../../../src/server/spa/client/react/features/notes/editor/NoteChatPanel.tsx',
);

describe('NoteChatPanel — mode toggle', () => {
    const source = readFileSync(PANEL_PATH, 'utf-8');

    it('initializes selectedMode state to ask', () => {
        expect(source).toMatch(/useState.*'ask'/);
    });

    it('renders NoteModeToggle inline with the empty-state composer, not the header', () => {
        expect(source).toMatch(/<NoteModeToggle/);
        expect(source).toMatch(/data-testid="note-mode-toggle"/);
        // The mode toggle must render inside the composer's input row (which
        // wraps the RichTextInput), not inside <NotesChatHeader>.
        const modeToggleIdx = source.indexOf('<NoteModeToggle');
        const headerIdx = source.indexOf('<NotesChatHeader');
        const headerEndIdx = source.indexOf('/>', headerIdx);
        expect(modeToggleIdx).toBeGreaterThan(headerEndIdx);
        const inputIdx = source.indexOf('note-chat-input');
        expect(modeToggleIdx).toBeLessThan(inputIdx);
    });

    it('has ask and autopilot toggle buttons', () => {
        expect(source).toMatch(/data-testid="note-mode-ask"/);
        expect(source).toMatch(/data-testid="note-mode-autopilot"/);
    });

    it('passes selectedMode to createChat', () => {
        expect(source).toMatch(/createChat\(prompt,\s*modelCommand\.modelOverride,\s*selectedMode,/);
    });

    it('passes allowedModes to ChatDetail instead of hideModeSelector', () => {
        expect(source).toMatch(/allowedModes=/);
        expect(source).not.toMatch(/hideModeSelector/);
    });

    it('defines NOTE_CHAT_ALLOWED_MODES as ask and autopilot', () => {
        expect(source).toMatch(/NOTE_CHAT_ALLOWED_MODES.*ChatMode\[\].*=.*\['ask',\s*'autopilot'\]/);
    });

    it('passes compactModeSelector and hideHeader to ChatDetail so the compact header is the only header', () => {
        const chatDetailIdx = source.indexOf('<ChatDetail');
        expect(chatDetailIdx).toBeGreaterThan(-1);
        const chatDetailEnd = source.indexOf('/>', chatDetailIdx);
        expect(chatDetailEnd).toBeGreaterThan(-1);
        const chatDetailBlock = source.slice(chatDetailIdx, chatDetailEnd);
        expect(chatDetailBlock).toContain('compactModeSelector');
        expect(chatDetailBlock).toContain('hideHeader');
    });
});
