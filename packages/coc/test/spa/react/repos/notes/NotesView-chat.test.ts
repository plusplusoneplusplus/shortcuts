/**
 * Tests for NotesView — verifies chat panel state and scope wiring.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const VIEW_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'notes', 'NotesView.tsx'
);
const REPO_DETAIL_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'RepoDetail.tsx'
);

describe('NotesView (notes chat refactor)', () => {
    let source: string;
    let repoDetailSource: string;

    beforeAll(() => {
        source = fs.readFileSync(VIEW_PATH, 'utf-8');
        repoDetailSource = fs.readFileSync(REPO_DETAIL_PATH, 'utf-8');
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

    describe('workspace-scoped chat state ownership', () => {
        it('does not expose a separate parent-owned chatPanelOpen override', () => {
            expect(source).not.toContain('chatPanelOpen?: boolean');
        });

        it('does not expose a separate parent-owned onToggleChatPanel override', () => {
            expect(source).not.toContain('onToggleChatPanel?: () => void');
        });

        it('does not own chatPanelOpen state with the old single key', () => {
            expect(source).not.toContain("useState(() => {\n        try { return localStorage.getItem('coc-notes-chat-panel-open')");
        });

        it('does not sync chatPanelOpen to the old single localStorage key', () => {
            expect(source).not.toContain("localStorage.setItem('coc-notes-chat-panel-open'");
        });

        it('provides internal non-Lens chatPanelOpen state with workspace-scoped key', () => {
            expect(source).toContain('`coc-notes-chat-panel-open-${workspaceId}`');
        });

        it('chat panel visibility uses the resolved chatPanelOpen', () => {
            expect(source).toContain('const chatVisible = chatPanelOpen && isDefaultRoot;');
        });
    });

    describe('chat toggle wired to NoteEditor', () => {
        it('passes chatPanelOpen to NoteEditor', () => {
            expect(source).toContain('chatPanelOpen={chatPanelOpen}');
        });

        it('passes onToggleChatPanel to NoteEditor', () => {
            expect(source).toContain('onToggleChatPanel={handleToggleChatPanel}');
        });

        it('tells NoteEditor when the chat is a lens, so the AI-edit pill moves clear of it', () => {
            expect(source).toContain("chatLensOpen={chatVisible && noteChatPresentation === 'lens'}");
        });
    });

    describe('Lens Chat inheritance', () => {
        it('uses the shared ReviewChat presentation hook with a notes target', () => {
            expect(source).toContain("type: 'notes'");
            expect(source).toContain('useReviewChatPresentation({');
        });

        it('renders the shared ReviewChatPlacementFrame for Lens notes chat', () => {
            expect(source).toContain('<ReviewChatPlacementFrame');
            expect(source).toContain('testIdPrefix="notes-chat"');
        });

        it('does not render a non-interactive Lens Chat badge overlapping the toolbar', () => {
            // The badge was a pointer-events-none pill that collided with the
            // editor's Rich/Md toggle and looked clickable but was not. Removed.
            expect(source).not.toContain('notes-lens-chat-badge');
            expect(source).not.toContain('Notes inherit Lens Chat mode');
        });

        it('keeps RepoDetail from owning a competing notes chat open state', () => {
            expect(repoDetailSource).not.toContain('notesChatPanelOpen');
            expect(repoDetailSource).not.toContain('chatPanelOpen={');
            expect(repoDetailSource).not.toContain('onToggleChatPanel={');
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
