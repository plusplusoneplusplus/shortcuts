/**
 * Tests for NoteContextBanner — source-level analysis.
 *
 * Covers:
 * - Component exports and props interface
 * - Banner rendering for attached, truncated, not-found, and empty statuses
 * - Anchoring hint when selected note differs from chat note
 * - Null chatNotePath returns null (no banner)
 * - Status chip variants
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

    it('exports NoteContentStatusInfo interface', () => {
        expect(source).toContain('export interface NoteContentStatusInfo');
    });

    it('exports NoteStatusKind type', () => {
        expect(source).toContain('export type NoteStatusKind');
    });

    describe('props interface', () => {
        it('accepts chatNotePath', () => {
            expect(source).toContain('chatNotePath:');
        });

        it('accepts chatNoteTitle', () => {
            expect(source).toContain('chatNoteTitle:');
        });

        it('accepts currentNotePath for anchoring detection', () => {
            expect(source).toContain('currentNotePath:');
        });

        it('accepts contentStatus', () => {
            expect(source).toContain('contentStatus:');
        });
    });

    describe('null guard', () => {
        it('returns null when chatNotePath is falsy', () => {
            expect(source).toContain('if (!chatNotePath) return null');
        });
    });

    describe('status chips', () => {
        it('shows Attached note chip for attached status', () => {
            expect(source).toContain("'Attached note'");
        });

        it('shows Truncated chip for truncated status', () => {
            expect(source).toContain('Truncated to');
        });

        it('shows Note not found chip for not-found status', () => {
            expect(source).toContain("'Note not found'");
        });

        it('shows Empty note chip for empty status', () => {
            expect(source).toContain("'Empty note'");
        });

        it('uses info variant for attached', () => {
            expect(source).toMatch(/statusKind === 'attached'.*statusChip.*'info'/s);
        });

        it('uses warning variant for truncated', () => {
            expect(source).toMatch(/statusKind === 'truncated'.*statusChip[\s\S]*?'warning'/);
        });

        it('uses error variant for not-found', () => {
            expect(source).toMatch(/statusKind === 'not-found'.*statusChip.*'error'/s);
        });
    });

    describe('anchoring hint', () => {
        it('detects when currentNotePath differs from chatNotePath', () => {
            expect(source).toContain('currentNotePath !== chatNotePath');
        });

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

        it('has note-status-chip testid', () => {
            expect(source).toContain('note-status-chip');
        });

        it('has note-anchor-hint testid', () => {
            expect(source).toContain('note-anchor-hint');
        });
    });

    describe('display helpers', () => {
        it('formats character count with k suffix for large numbers', () => {
            expect(source).toContain('formatCharCount');
        });

        it('derives display title from path when noteTitle is missing', () => {
            // Falls back to extracting filename from path
            expect(source).toContain("chatNotePath.split('/')");
        });
    });
});
