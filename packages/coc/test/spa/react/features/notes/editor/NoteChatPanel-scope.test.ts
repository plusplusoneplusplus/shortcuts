/**
 * Tests for NoteChatPanel — scope wiring into the compact header.
 *
 * Validates that the panel wires scope state into the single NotesChatHeader,
 * uses appropriate empty state messages per scope, conditionally renders
 * NoteContextBanner only in per-note scope, computes the header context
 * label per scope, and accepts the defaultScope prop.
 *
 * The scope segmented control itself now lives in NotesChatHeader.tsx — see
 * NotesChatHeader.test.tsx for its rendering/interaction coverage.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PANEL_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react',
    'features', 'notes', 'editor', 'NoteChatPanel.tsx'
);

describe('NoteChatPanel — scope wiring', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(PANEL_PATH, 'utf-8');
    });

    describe('defaultScope prop', () => {
        it('accepts defaultScope prop in NoteChatPanelProps', () => {
            expect(source).toContain('defaultScope?: ChatScope');
        });

        it('passes defaultScope to useNotesChat', () => {
            expect(source).toContain('defaultScope,');
        });
    });

    describe('scope wired into the single compact header', () => {
        it('passes scope and onScopeChange to NotesChatHeader', () => {
            expect(source).toContain('scope={scope}');
            expect(source).toContain('onScopeChange={setScope}');
        });

        it('does not define its own ScopeToggle component (moved to NotesChatHeader)', () => {
            expect(source).not.toContain('function ScopeToggle');
            expect(source).not.toContain('data-testid="chat-scope-toggle"');
        });
    });

    describe('per-note scope empty states', () => {
        it('shows "Select a note to start chatting" when no note selected in per-note scope', () => {
            expect(source).toContain('Select a note to start chatting');
        });

        it('shows "Ask about this note…" in per-note scope empty state', () => {
            expect(source).toContain('Ask about this note…');
        });

        it('derives noNoteSelected from scope and notePath', () => {
            expect(source).toContain("scope === 'per-note' && !notePath");
        });
    });

    describe('per-workspace scope empty state', () => {
        it('shows "Ask about your notes — one chat per workspace" in per-workspace scope', () => {
            expect(source).toContain('Ask about your notes — one chat per workspace');
        });
    });

    describe('header context label', () => {
        it('computes a per-note context label from noteTitle/notePath with a no-note fallback', () => {
            expect(source).toContain("const noteContextLabel = noteTitle || notePath?.split('/').pop()?.replace(/\\.md$/, '') || 'No note selected'");
        });

        it('resolves a workspace label via resolveWorkspaceName for workspace scope', () => {
            expect(source).toContain("import { resolveWorkspaceName } from '../../../utils/workspace'");
            expect(source).toContain('resolveWorkspaceName(workspaceId,');
        });

        it('picks the note or workspace label based on the active scope', () => {
            expect(source).toContain("const headerContextLabel = scope === 'per-note' ? noteContextLabel : workspaceLabel");
        });

        it('passes headerContextLabel to NotesChatHeader as contextLabel', () => {
            expect(source).toContain('contextLabel={headerContextLabel}');
        });
    });

    describe('NoteContextBanner scope gating', () => {
        it('renders NoteContextBanner only in per-note scope', () => {
            expect(source).toContain("scope === 'per-note'");
            const perNoteJsxIdx = source.indexOf("{scope === 'per-note' && (");
            expect(perNoteJsxIdx).toBeGreaterThan(-1);
            const bannerIdx = source.indexOf('NoteContextBanner', perNoteJsxIdx);
            expect(bannerIdx).toBeGreaterThan(perNoteJsxIdx);
        });
    });

    describe('onHasChatChange callback', () => {
        it('accepts onHasChatChange prop in NoteChatPanelProps', () => {
            expect(source).toContain('onHasChatChange?: (hasChat: boolean) => void');
        });

        it('destructs onHasChatChange in the component function signature', () => {
            expect(source).toContain('onHasChatChange,');
        });

        it('calls onHasChatChange via useEffect when taskId changes', () => {
            expect(source).toContain('onHasChatChange?.(!!taskId)');
        });

        it('passes taskId and onHasChatChange as useEffect dependencies', () => {
            const effectIdx = source.indexOf('onHasChatChange?.(!!taskId)');
            const afterEffect = source.slice(effectIdx, effectIdx + 100);
            expect(afterEffect).toContain('[taskId, onHasChatChange]');
        });
    });
});
