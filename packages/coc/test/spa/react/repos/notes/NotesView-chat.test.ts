/**
 * Tests for NotesView — verifies chat panel state is lifted to parent
 * and per-note binding code was removed (single-chat-per-workspace model).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const VIEW_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'notes', 'NotesView.tsx'
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

    describe('chat state lifted to parent', () => {
        it('accepts chatPanelOpen as a prop', () => {
            expect(source).toContain('chatPanelOpen?: boolean');
        });

        it('accepts onToggleChatPanel as a prop', () => {
            expect(source).toContain('onToggleChatPanel?: () => void');
        });

        it('does not own chatPanelOpen state internally', () => {
            expect(source).not.toContain("useState(() => {\n        try { return localStorage.getItem('coc-notes-chat-panel-open')");
        });

        it('does not sync chatPanelOpen to localStorage', () => {
            expect(source).not.toContain("localStorage.setItem('coc-notes-chat-panel-open'");
        });

        it('chat panel visibility uses the prop', () => {
            expect(source).toContain('const chatVisible = chatPanelOpen;');
        });
    });

    describe('chat toggle not in per-note toolbar', () => {
        it('does not pass chatPanelOpen to NoteEditor', () => {
            expect(source).not.toContain('chatPanelOpen={chatPanelOpen}');
        });

        it('does not pass onToggleChatPanel to NoteEditor', () => {
            expect(source).not.toContain('onToggleChatPanel=');
        });

        it('does not render a mobile chat button', () => {
            expect(source).not.toContain('notes-mobile-chat-btn');
        });
    });

    describe('NoteChatPanel receives nullable notePath', () => {
        it('passes selectedPath (which can be null) to NoteChatPanel', () => {
            expect(source).toContain('notePath={selectedPath}');
            expect(source).not.toContain('notePath={selectedPath!}');
        });
    });

    describe('AI edit change indicator wiring', () => {
        it('does not contain handleNoteFileEdit (removed)', () => {
            expect(source).not.toContain('handleNoteFileEdit');
        });

        it('does not pass onNoteFileEdit to NoteChatPanel (removed)', () => {
            expect(source).not.toContain('onNoteFileEdit');
        });
    });
});
