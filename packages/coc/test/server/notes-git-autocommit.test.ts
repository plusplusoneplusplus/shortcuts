/**
 * Notes Git Auto-Commit — Unit Tests
 *
 * Tests for `NotesAutoCommitTimer` and the migration helper `findAutoCommitSchedule`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    NotesAutoCommitTimer,
    findAutoCommitSchedule,
    NOTES_AUTOCOMMIT_SCHEDULE_NAME,
} from '../../src/server/notes-git-autocommit';

// ============================================================================
// Tests
// ============================================================================

describe('notes-git-autocommit', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autocommit-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ========================================================================
    // NotesAutoCommitTimer
    // ========================================================================

    describe('NotesAutoCommitTimer', () => {
        it('starts without error', () => {
            const timer = new NotesAutoCommitTimer('/tmp/notes', 60_000);
            expect(() => timer.start()).not.toThrow();
            timer.stop();
        });

        it('start() is idempotent — calling twice does not create duplicate timers', () => {
            const timer = new NotesAutoCommitTimer('/tmp/notes', 60_000);
            timer.start();
            timer.start(); // should be a no-op
            timer.stop();
        });

        it('stop() clears the interval without error', () => {
            const timer = new NotesAutoCommitTimer('/tmp/notes', 60_000);
            timer.start();
            expect(() => timer.stop()).not.toThrow();
        });

        it('stop() is safe to call when not started', () => {
            const timer = new NotesAutoCommitTimer('/tmp/notes', 60_000);
            expect(() => timer.stop()).not.toThrow();
        });

        it('getLastResult() returns nulls when no run has completed', () => {
            const timer = new NotesAutoCommitTimer('/tmp/notes', 60_000);
            expect(timer.getLastResult()).toEqual({ committedAt: null, error: null });
        });

        it('runOnce() captures error when notes dir is not a git repo', async () => {
            const notesDir = path.join(tmpDir, 'notes');
            fs.mkdirSync(notesDir);
            const timer = new NotesAutoCommitTimer(notesDir, 60_000);

            await timer.runOnce();

            const { error } = timer.getLastResult();
            expect(error).toBeTruthy();
            expect(typeof error).toBe('string');
        });

        it('runOnce() sets lastCommittedAt on successful commit', async () => {
            const { execGitAsync } = await import('@plusplusoneplusplus/forge/git');

            const notesDir = path.join(tmpDir, 'notes');
            fs.mkdirSync(notesDir);
            await execGitAsync(['init'], notesDir);
            await execGitAsync(['config', 'user.email', 'test@test.com'], notesDir);
            await execGitAsync(['config', 'user.name', 'Test'], notesDir);
            fs.writeFileSync(path.join(notesDir, 'note.md'), 'hello');
            await execGitAsync(['add', '-A'], notesDir);
            await execGitAsync(['commit', '-m', 'initial'], notesDir);

            // Add a change so there is something to commit
            fs.writeFileSync(path.join(notesDir, 'note.md'), 'updated');

            const timer = new NotesAutoCommitTimer(notesDir, 60_000);
            await timer.runOnce();

            const { committedAt, error } = timer.getLastResult();
            expect(error).toBeNull();
            expect(committedAt).toBeTruthy();
            expect(typeof committedAt).toBe('string');
        });

        it('runOnce() sets lastError to null when there is nothing to commit', async () => {
            const { execGitAsync } = await import('@plusplusoneplusplus/forge/git');

            const notesDir = path.join(tmpDir, 'notes-clean');
            fs.mkdirSync(notesDir);
            await execGitAsync(['init'], notesDir);
            await execGitAsync(['config', 'user.email', 'test@test.com'], notesDir);
            await execGitAsync(['config', 'user.name', 'Test'], notesDir);
            fs.writeFileSync(path.join(notesDir, 'note.md'), 'hello');
            await execGitAsync(['add', '-A'], notesDir);
            await execGitAsync(['commit', '-m', 'initial'], notesDir);

            const timer = new NotesAutoCommitTimer(notesDir, 60_000);
            await timer.runOnce(); // nothing to commit

            const { error } = timer.getLastResult();
            expect(error).toBeNull();
        });
    });

    // ========================================================================
    // findAutoCommitSchedule (migration helper)
    // ========================================================================

    describe('findAutoCommitSchedule', () => {
        function mockScheduleManager(schedules: any[]): any {
            return {
                getSchedules: vi.fn().mockReturnValue(schedules),
            };
        }

        it('returns the matching schedule when one exists', () => {
            const schedule = {
                id: 'sch_abc',
                name: NOTES_AUTOCOMMIT_SCHEDULE_NAME,
                cron: '*/30 * * * *',
            };
            const mgr = mockScheduleManager([schedule]);

            const result = findAutoCommitSchedule(mgr, 'repo1');
            expect(result).toBe(schedule);
            expect(mgr.getSchedules).toHaveBeenCalledWith('repo1');
        });

        it('returns undefined when no schedule exists', () => {
            const mgr = mockScheduleManager([]);
            expect(findAutoCommitSchedule(mgr, 'repo1')).toBeUndefined();
        });

        it('returns undefined when only other schedules exist', () => {
            const mgr = mockScheduleManager([
                { id: 'sch_1', name: 'Other Schedule' },
                { id: 'sch_2', name: 'Another one' },
            ]);
            expect(findAutoCommitSchedule(mgr, 'repo1')).toBeUndefined();
        });
    });
});
