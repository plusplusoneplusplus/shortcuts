/**
 * Tests for NotesView — verifies chat panel state and scope wiring.
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

    describe('chat state lifted to parent (optional) with internal fallback', () => {
        it('accepts chatPanelOpen as an optional prop', () => {
            expect(source).toContain('chatPanelOpen?: boolean');
        });

        it('accepts onToggleChatPanel as an optional prop', () => {
            expect(source).toContain('onToggleChatPanel?: () => void');
        });

        it('does not own chatPanelOpen state with the old single key', () => {
            expect(source).not.toContain("useState(() => {\n        try { return localStorage.getItem('coc-notes-chat-panel-open')");
        });

        it('does not sync chatPanelOpen to the old single localStorage key', () => {
            expect(source).not.toContain("localStorage.setItem('coc-notes-chat-panel-open'");
        });

        it('provides internal chatPanelOpen state with workspace-scoped key', () => {
            expect(source).toContain('`coc-notes-chat-panel-open-${workspaceId}`');
        });

        it('chat panel visibility uses the resolved chatPanelOpen', () => {
            expect(source).toContain('const chatVisible = chatPanelOpen;');
        });
    });

    describe('chat toggle wired to NoteEditor', () => {
        it('passes chatPanelOpen to NoteEditor', () => {
            expect(source).toContain('chatPanelOpen={chatPanelOpen}');
        });

        it('passes onToggleChatPanel to NoteEditor', () => {
            expect(source).toContain('onToggleChatPanel={handleToggleChatPanel}');
        });
    });

    describe('defaultScope prop', () => {
        it('accepts defaultScope as a prop', () => {
            expect(source).toContain('defaultScope?: ChatScope');
        });

        it('passes defaultScope to NoteChatPanel', () => {
            expect(source).toContain('defaultScope={defaultScope}');
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
