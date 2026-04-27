/**
 * Tests for NoteContextBanner — source-level analysis.
 *
 * Covers:
 * - Component exports and props interface
 * - Banner rendering with static path-reference chip
 * - Anchoring hint when selected note differs from chat note
 * - Null chatNotePath returns null (no banner)
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
        it('accepts chatNotePath', () => {
            expect(source).toContain('chatNotePath:');
        });

        it('accepts chatNoteTitle', () => {
            expect(source).toContain('chatNoteTitle:');
        });

        it('accepts currentNotePath for anchoring detection', () => {
            expect(source).toContain('currentNotePath:');
        });

        it('does not accept contentStatus (removed)', () => {
            expect(source).not.toContain('contentStatus:');
        });
    });

    describe('null guard', () => {
        it('returns null when chatNotePath is falsy', () => {
            expect(source).toContain('if (!chatNotePath) return null');
        });
    });

    describe('path reference chip', () => {
        it('shows static Path reference chip', () => {
            expect(source).toContain('📎 Path reference');
        });

        it('uses note-status-chip testid', () => {
            expect(source).toContain('note-status-chip');
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

        it('has note-anchor-hint testid', () => {
            expect(source).toContain('note-anchor-hint');
        });
    });

    describe('display helpers', () => {
        it('derives display title from path when noteTitle is missing', () => {
            // Falls back to extracting filename from path
            expect(source).toContain("chatNotePath.split('/')");
        });
    });
});
