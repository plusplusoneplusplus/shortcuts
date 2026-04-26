/**
 * Tests for NoteChatPanel — scope toggle UI.
 *
 * Validates that the panel renders a scope segmented control,
 * uses appropriate empty state messages per scope, conditionally
 * renders NoteContextBanner only in per-note scope, and accepts
 * the defaultScope prop.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PANEL_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react',
    'features', 'notes', 'editor', 'NoteChatPanel.tsx'
);

describe('NoteChatPanel — scope toggle', () => {
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

    describe('ScopeToggle component', () => {
        it('renders a scope toggle with data-testid', () => {
            expect(source).toContain('data-testid="chat-scope-toggle"');
        });

        it('renders per-note button', () => {
            expect(source).toContain('data-testid="chat-scope-per-note"');
        });

        it('renders per-workspace button', () => {
            expect(source).toContain('data-testid="chat-scope-per-workspace"');
        });

        it('calls onScopeChange with per-note when per-note button clicked', () => {
            expect(source).toContain("onScopeChange('per-note')");
        });

        it('calls onScopeChange with per-workspace when per-workspace button clicked', () => {
            expect(source).toContain("onScopeChange('per-workspace')");
        });

        it('renders 📝 This Note label', () => {
            expect(source).toContain('📝 This Note');
        });

        it('renders 🗂️ Workspace label', () => {
            expect(source).toContain('🗂️ Workspace');
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

    describe('NoteContextBanner scope gating', () => {
        it('renders NoteContextBanner only in per-note scope', () => {
            expect(source).toContain("scope === 'per-note'");
            // Verify NoteContextBanner is inside the per-note JSX guard (use indexOf to find
            // the JSX guard, not the ScopeToggle component definition which also uses scope === 'per-note')
            const perNoteJsxIdx = source.indexOf("{scope === 'per-note' && (");
            expect(perNoteJsxIdx).toBeGreaterThan(-1);
            const bannerIdx = source.indexOf('NoteContextBanner', perNoteJsxIdx);
            expect(bannerIdx).toBeGreaterThan(perNoteJsxIdx);
        });
    });

    describe('ScopeToggle in both empty and active states', () => {
        it('renders ScopeToggle in empty state', () => {
            // ScopeToggle should appear both when taskId is null and when it has a value
            const emptyStateIdx = source.indexOf('note-chat-close-btn');
            const activeStateIdx = source.indexOf('note-chat-new-btn');
            const scopeToggle1 = source.indexOf('<ScopeToggle', emptyStateIdx);
            const scopeToggle2 = source.indexOf('<ScopeToggle', activeStateIdx);
            expect(scopeToggle1).toBeGreaterThan(emptyStateIdx);
            expect(scopeToggle2).toBeGreaterThan(activeStateIdx);
        });
    });
});
