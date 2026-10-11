/**
 * Tests for the git module: types, constants, and the barrel's export surface.
 *
 * The sync `execGit` this file used to exercise was deleted in AC-08 — every
 * git command in forge is async and runs in the native addon or, for WSL, in
 * `exec.ts`'s `wsl.exe` branch. Its behaviour tests went with it; what is left
 * here guards git UI constants and the export surface so the sync helper cannot come back.
 */

import { describe, it, expect } from 'vitest';
import {
    GitChangeStatus,
    GitChangeStage,
    STATUS_SHORT,
    STAGE_PREFIX,
    STAGE_LABEL,
    execGitAsync,
} from '../../src/git';
import * as gitModule from '../../src/git';

// ---------------------------------------------------------------------------
// Constants correctness
// ---------------------------------------------------------------------------

describe('Git constants', () => {
    const ALL_STATUSES: GitChangeStatus[] = [
        'modified', 'added', 'deleted', 'renamed',
        'copied', 'untracked', 'ignored', 'conflict',
    ];

    const ALL_STAGES: GitChangeStage[] = ['staged', 'unstaged', 'untracked'];

    describe('STATUS_SHORT', () => {
        it('should have an entry for every GitChangeStatus value', () => {
            for (const status of ALL_STATUSES) {
                expect(STATUS_SHORT).toHaveProperty(status);
                expect(typeof STATUS_SHORT[status]).toBe('string');
                expect(STATUS_SHORT[status].length).toBeGreaterThan(0);
            }
        });

        it('should map expected values', () => {
            expect(STATUS_SHORT['modified']).toBe('M');
            expect(STATUS_SHORT['added']).toBe('A');
            expect(STATUS_SHORT['deleted']).toBe('D');
            expect(STATUS_SHORT['renamed']).toBe('R');
            expect(STATUS_SHORT['copied']).toBe('C');
            expect(STATUS_SHORT['untracked']).toBe('U');
            expect(STATUS_SHORT['ignored']).toBe('I');
            expect(STATUS_SHORT['conflict']).toBe('!');
        });
    });

    describe('STAGE_PREFIX', () => {
        it('should have an entry for every GitChangeStage value', () => {
            for (const stage of ALL_STAGES) {
                expect(STAGE_PREFIX).toHaveProperty(stage);
                expect(typeof STAGE_PREFIX[stage]).toBe('string');
            }
        });

        it('should map expected values', () => {
            expect(STAGE_PREFIX['staged']).toBe('\u2713');   // ✓
            expect(STAGE_PREFIX['unstaged']).toBe('\u25CF'); // ●
            expect(STAGE_PREFIX['untracked']).toBe('?');
        });
    });

    describe('STAGE_LABEL', () => {
        it('should have an entry for every GitChangeStage value', () => {
            for (const stage of ALL_STAGES) {
                expect(STAGE_LABEL).toHaveProperty(stage);
                expect(typeof STAGE_LABEL[stage]).toBe('string');
            }
        });

        it('should map expected values', () => {
            expect(STAGE_LABEL['staged']).toBe('Staged');
            expect(STAGE_LABEL['unstaged']).toBe('Modified');
            expect(STAGE_LABEL['untracked']).toBe('Untracked');
        });
    });
});

// ---------------------------------------------------------------------------
// Sync execGit removal (AC-08)
// ---------------------------------------------------------------------------

describe('sync execGit removal', () => {
    it('does not export a sync execGit from the git barrel', () => {
        // AC-08 DoD 4: native git is async-only. A sync export would mean some
        // caller is spawning git on the event-loop thread again.
        expect('execGit' in gitModule).toBe(false);
    });

    it('exports execGitAsync as the only git runner', () => {
        expect(typeof execGitAsync).toBe('function');
    });
});

