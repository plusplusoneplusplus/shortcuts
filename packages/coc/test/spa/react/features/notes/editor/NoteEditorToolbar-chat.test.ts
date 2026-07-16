/**
 * Tests for NoteEditorToolbar — chat toggle button wiring.
 *
 * Validates that the toolbar accepts and renders chat toggle props
 * alongside the existing comments toggle, and that the 🤖 button
 * renders when the panel can be toggled or when chat is disabled.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TOOLBAR_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react',
    'features', 'notes', 'editor', 'NoteEditorToolbar.tsx'
);

describe('NoteEditorToolbar — chat toggle', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(TOOLBAR_PATH, 'utf-8');
    });

    it('accepts chatPanelOpen prop', () => {
        expect(source).toContain('chatPanelOpen?: boolean');
    });

    it('accepts onToggleChatPanel prop', () => {
        expect(source).toContain('onToggleChatPanel?: () => void');
    });

    it('renders 🤖 button when chat controls are available', () => {
        expect(source).toContain('(onToggleChatPanel || chatDisabledReason)');
        expect(source).toContain("data-testid=\"chat-panel-toggle\"");
    });

    it('uses chatPanelOpen for active styling on the button', () => {
        expect(source).toContain('chatPanelOpen');
        // Button style changes when chatPanelOpen is true
        const toggleBlock = source.substring(
            source.indexOf('data-testid="chat-panel-toggle"'),
        );
        expect(toggleBlock.substring(0, 200)).toContain('chatPanelOpen');
    });

    it('places the 🤖 button between the 💬 button and toolbarRight', () => {
        const commentsIdx = source.indexOf('data-testid="comments-panel-toggle"');
        const chatIdx = source.indexOf('data-testid="chat-panel-toggle"');
        const toolbarRightIdx = source.indexOf('{toolbarRight}');
        expect(commentsIdx).toBeGreaterThan(0);
        expect(chatIdx).toBeGreaterThan(commentsIdx);
        expect(toolbarRightIdx).toBeGreaterThan(chatIdx);
    });

    it('right-end section is shown when onToggleChatPanel is provided', () => {
        expect(source).toContain('onToggleChatPanel ||');
    });

    describe('hasExistingChat indicator', () => {
        it('accepts hasExistingChat prop', () => {
            expect(source).toContain('hasExistingChat?: boolean');
        });

        it('destructs hasExistingChat in the toolbar function signature', () => {
            expect(source).toContain('hasExistingChat,');
        });

        it('uses hasExistingChat to apply blue color class when chat exists and panel is closed', () => {
            // The button should apply a blue color when hasExistingChat is true and chatPanelOpen is false
            const toggleBlock = source.substring(source.indexOf('data-testid="chat-panel-toggle"') - 500, source.indexOf('data-testid="chat-panel-toggle"') + 500);
            expect(toggleBlock).toContain('hasExistingChat');
            expect(toggleBlock).toContain('0078d4');
        });

        it('shows "Continue AI chat" tooltip when hasExistingChat is true and panel is closed', () => {
            expect(source).toContain('Continue AI chat');
        });

        it('title attribute reflects hasExistingChat state', () => {
            const titleIdx = source.indexOf("title={chatDisabledReason ?? (chatPanelOpen ? 'Hide AI chat' : hasExistingChat");
            expect(titleIdx).toBeGreaterThan(-1);
        });

        it('aria-label reflects hasExistingChat state', () => {
            const ariaIdx = source.indexOf("aria-label={chatDisabledReason ?? (chatPanelOpen ? 'Hide AI chat' : hasExistingChat");
            expect(ariaIdx).toBeGreaterThan(-1);
        });
    });
});
