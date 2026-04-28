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

    describe('onHasChatChange callback', () => {
        it('accepts onHasChatChange prop in NoteChatPanelProps', () => {
            expect(source).toContain('onHasChatChange?: (hasChat: boolean) => void');
        });

        it('destructs onHasChatChange in the component function signature', () => {
            expect(source).toContain('onHasChatChange }');
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

    describe('ScopeToggle in both empty and active states', () => {
        it('renders ScopeToggle in same row as header buttons (single-row layout)', () => {
            // In the single-row layout, ScopeToggle is inlined before the action button in each header row
            const emptyStateStart = source.indexOf('{!taskId && (');
            const activeStateStart = source.indexOf('{taskId && (');

            // ScopeToggle in empty state (before close button)
            const scopeToggle1 = source.indexOf('<ScopeToggle', emptyStateStart);
            expect(scopeToggle1).toBeGreaterThan(emptyStateStart);
            expect(scopeToggle1).toBeLessThan(activeStateStart);

            const closeIdx = source.indexOf('note-chat-close-btn', scopeToggle1);
            expect(closeIdx).toBeGreaterThan(scopeToggle1);
            expect(closeIdx).toBeLessThan(activeStateStart);

            // ScopeToggle in active state (before new-chat button)
            const scopeToggle2 = source.indexOf('<ScopeToggle', activeStateStart);
            expect(scopeToggle2).toBeGreaterThan(activeStateStart);

            const newChatIdx = source.indexOf('note-chat-new-btn', scopeToggle2);
            expect(newChatIdx).toBeGreaterThan(scopeToggle2);
        });

        it('ScopeToggle no longer renders its own border-b row', () => {
            const scopeToggleDef = source.indexOf('function ScopeToggle');
            expect(scopeToggleDef).toBeGreaterThan(-1);
            const afterDef = source.slice(scopeToggleDef);
            const componentBodyEnd = afterDef.indexOf('\n}');
            const componentBody = afterDef.slice(0, componentBodyEnd);
            expect(componentBody).not.toContain('border-b');
        });
    });
});
