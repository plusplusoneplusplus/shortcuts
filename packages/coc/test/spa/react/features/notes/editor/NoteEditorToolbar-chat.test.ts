/**
 * Tests for NoteEditorToolbar — chat toggle button wiring.
 *
 * Validates that the toolbar accepts and renders chat toggle props
 * alongside the existing comments toggle, and that the 🤖 button
 * only renders when onToggleChatPanel is provided.
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

    it('renders 🤖 button when onToggleChatPanel is provided', () => {
        expect(source).toContain('onToggleChatPanel &&');
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
});
