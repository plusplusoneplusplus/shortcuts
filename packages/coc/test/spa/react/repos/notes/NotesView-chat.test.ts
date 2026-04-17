/**
 * Tests for NotesView — verifies binding-related code was removed
 * and chat panel is always available (single-chat-per-workspace model).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const VIEW_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'NotesView.tsx'
);

describe('NotesView (notes chat refactor)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(VIEW_PATH, 'utf-8');
    });

    describe('no per-note binding references', () => {
        it('does not import fetchApi', () => {
            expect(source).not.toContain("from '../hooks/useApi'");
        });

        it('does not call rebind API', () => {
            expect(source).not.toContain('note-chat-bindings/rebind');
        });

        it('does not call unbind API', () => {
            expect(source).not.toContain('note-chat-bindings');
        });
    });

    describe('chat panel availability', () => {
        it('chat panel visibility is not gated on selectedPath', () => {
            expect(source).toContain('const chatVisible = chatPanelOpen;');
        });

        it('mobile chat button is not gated on selectedPath', () => {
            // The 🤖 button should not be wrapped in {selectedPath && ...}
            const mobileChatBtnArea = source.substring(
                source.indexOf('notes-mobile-chat-btn') - 200,
                source.indexOf('notes-mobile-chat-btn') + 50
            );
            expect(mobileChatBtnArea).not.toContain('selectedPath && (');
        });
    });

    describe('NoteChatPanel receives nullable notePath', () => {
        it('passes selectedPath (which can be null) to NoteChatPanel', () => {
            expect(source).toContain('notePath={selectedPath}');
            // Not `notePath={selectedPath!}` — no non-null assertion
            expect(source).not.toContain('notePath={selectedPath!}');
        });
    });
});
