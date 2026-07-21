/**
 * Tests for NoteContextBanner — source-level analysis.
 *
 * The banner is now a slim amber warning strip that renders ONLY when the chat
 * is attached to a different note than the one currently selected (isSwitched).
 * The note title/path and the path-reference affordance moved to NotesChatHeader.
 *
 * Render behavior is covered in
 * test/spa/react/features/notes/editor/NoteContextBanner.test.tsx.
 *
 * Covers:
 * - Component exports and props interface
 * - Renders only when switched (isSwitched null guard)
 * - Anchoring hint copy preserved
 * - Path-reference chip / title / path block removed (moved to the header)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const BANNER_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'notes', 'editor', 'NoteContextBanner.tsx'
);

describe('NoteContextBanner', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(BANNER_PATH, 'utf-8');
    });

    it('exports NoteContextBanner component', () => {
        expect(source).toContain('export function NoteContextBanner');
    });

    it('exports NoteContextBannerProps interface', () => {
        expect(source).toContain('export interface NoteContextBannerProps');
    });

    describe('props interface', () => {
        it('accepts chatNoteTitle', () => {
            expect(source).toContain('chatNoteTitle:');
        });

        it('accepts chatNotePath for title fallback', () => {
            expect(source).toContain('chatNotePath?:');
        });

        it('accepts isSwitched (computed once by the panel)', () => {
            expect(source).toContain('isSwitched: boolean');
        });

        it('no longer accepts currentNotePath (isSwitched is computed upstream)', () => {
            expect(source).not.toContain('currentNotePath');
        });

        it('does not accept contentStatus (removed)', () => {
            expect(source).not.toContain('contentStatus:');
        });
    });

    describe('null guard', () => {
        it('returns null unless switched', () => {
            expect(source).toContain('if (!isSwitched) return null');
        });
    });

    describe('path reference chip removed (moved to header)', () => {
        it('no longer renders the static Path reference chip', () => {
            expect(source).not.toContain('📎 Path reference');
        });

        it('no longer uses the note-status-chip testid', () => {
            expect(source).not.toContain('note-status-chip');
        });
    });

    describe('anchoring hint', () => {
        it('renders anchor hint when note is switched', () => {
            expect(source).toContain('note-anchor-hint');
        });

        it('suggests starting a new chat', () => {
            expect(source).toContain('Start New Chat to switch');
        });
    });

    describe('data-testid attributes', () => {
        it('has note-context-banner testid', () => {
            expect(source).toContain('note-context-banner');
        });

        it('has note-anchor-hint testid', () => {
            expect(source).toContain('note-anchor-hint');
        });
    });

    describe('display helpers', () => {
        it('derives display title from path when chatNoteTitle is missing', () => {
            // Falls back to extracting filename from path
            expect(source).toContain("chatNotePath?.split('/')");
        });
    });
});

