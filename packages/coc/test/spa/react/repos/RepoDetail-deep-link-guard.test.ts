/**
 * Tests for the deep-link redirect guard in RepoDetail.
 *
 * Verifies that:
 * - Terminal/notes redirect effects use ref-based guards to track previous state
 * - Redirects only fire on true→false transitions, not on initial mount
 * - The guard pattern (prevRef.current check + update) is present for both features
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_DETAIL_SOURCE_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoDetail.tsx'
);

describe('RepoDetail deep-link redirect guards', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_DETAIL_SOURCE_PATH, 'utf-8');
    });

    // ── Ref declarations ─────────────────────────────────────────────────────

    it('declares prevTerminalEnabled ref', () => {
        expect(source).toContain('prevTerminalEnabled = useRef(terminalEnabled)');
    });

    it('declares prevNotesEnabled ref', () => {
        expect(source).toContain('prevNotesEnabled = useRef(notesEnabled)');
    });

    // ── Terminal redirect guard ──────────────────────────────────────────────

    it('terminal redirect checks prevTerminalEnabled.current before dispatching', () => {
        expect(source).toContain('!terminalEnabled && prevTerminalEnabled.current');
    });

    it('terminal redirect updates prevTerminalEnabled.current after check', () => {
        expect(source).toContain('prevTerminalEnabled.current = terminalEnabled');
    });

    // ── Notes redirect guard ─────────────────────────────────────────────────

    it('notes redirect checks prevNotesEnabled.current before dispatching', () => {
        expect(source).toContain('!notesEnabled && prevNotesEnabled.current');
    });

    it('notes redirect updates prevNotesEnabled.current after check', () => {
        expect(source).toContain('prevNotesEnabled.current = notesEnabled');
    });

    // ── Git redirect is unguarded (no async race for git detection) ──────────

    it('git/pull-requests redirect does NOT use a ref guard (sync value)', () => {
        expect(source).not.toContain('prevIsGitRepo');
    });

    // ── Redirect still dispatches SET_REPO_SUB_TAB for feature disable ──────

    it('terminal redirect dispatches SET_REPO_SUB_TAB to activity', () => {
        const terminalBlock = source.slice(
            source.indexOf('activeSubTab === \'terminal\''),
            source.indexOf('prevTerminalEnabled.current = terminalEnabled') + 50
        );
        expect(terminalBlock).toContain("tab: 'activity'");
    });

    it('notes redirect dispatches SET_REPO_SUB_TAB to activity', () => {
        const notesBlock = source.slice(
            source.indexOf('activeSubTab === \'notes\' && !notesEnabled'),
            source.indexOf('prevNotesEnabled.current = notesEnabled') + 50
        );
        expect(notesBlock).toContain("tab: 'activity'");
    });
});
