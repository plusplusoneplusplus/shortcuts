/**
 * Notes Git Auto-Commit — Unit Tests
 *
 * Tests for script generation, file operations, schedule target building,
 * and schedule lookup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    generateAutoCommitScript,
    writeAutoCommitScript,
    deleteAutoCommitScript,
    buildAutoCommitScheduleTarget,
    findAutoCommitSchedule,
    NOTES_AUTOCOMMIT_SCHEDULE_NAME,
} from '../../src/server/notes-git-autocommit';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';

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
    // generateAutoCommitScript
    // ========================================================================

    describe('generateAutoCommitScript', () => {
        it('win32: produces valid PowerShell with Set-Location, git status, git add, git commit', () => {
            const script = generateAutoCommitScript('/some/notes/dir', 'win32');
            expect(script).toContain('Set-Location -LiteralPath');
            expect(script).toContain('/some/notes/dir');
            expect(script).toContain('git status --porcelain');
            expect(script).toContain('git add -A');
            expect(script).toContain('git commit -m');
            expect(script).toContain('$ErrorActionPreference');
        });

        it('linux: produces valid Bash with shebang, cd, git status, git add, git commit', () => {
            const script = generateAutoCommitScript('/some/notes/dir', 'linux');
            expect(script).toMatch(/^#!\/bin\/bash/);
            expect(script).toContain("cd '/some/notes/dir'");
            expect(script).toContain('git status --porcelain');
            expect(script).toContain('git add -A');
            expect(script).toContain('git commit -m');
            expect(script).toContain('set -euo pipefail');
        });

        it('darwin: uses bash variant (same as linux)', () => {
            const script = generateAutoCommitScript('/notes', 'darwin');
            expect(script).toMatch(/^#!\/bin\/bash/);
            expect(script).toContain("cd '/notes'");
            expect(script).toContain('git status --porcelain');
        });

        it('win32: uses CRLF line endings', () => {
            const script = generateAutoCommitScript('/dir', 'win32');
            expect(script).toContain('\r\n');
        });

        it('linux: uses LF line endings', () => {
            const script = generateAutoCommitScript('/dir', 'linux');
            expect(script).not.toContain('\r\n');
            expect(script).toContain('\n');
        });

        it('handles paths with spaces correctly', () => {
            const notesDir = '/Users/My User/.coc/repos/ws-abc/notes';

            // PowerShell: uses -LiteralPath with single quotes
            const ps1 = generateAutoCommitScript(notesDir, 'win32');
            expect(ps1).toContain(`Set-Location -LiteralPath '${notesDir}'`);

            // Bash: uses single quotes around cd target
            const sh = generateAutoCommitScript(notesDir, 'linux');
            expect(sh).toContain(`cd '${notesDir}'`);
        });
    });

    // ========================================================================
    // writeAutoCommitScript
    // ========================================================================

    describe('writeAutoCommitScript', () => {
        it('writes .ps1 on win32', async () => {
            const notesDir = path.join(tmpDir, 'notes');
            fs.mkdirSync(notesDir, { recursive: true });

            const scriptPath = await writeAutoCommitScript(tmpDir, 'ws1', notesDir, 'win32');
            expect(scriptPath).toMatch(/notes-autocommit\.ps1$/);
            expect(fs.existsSync(scriptPath)).toBe(true);

            const content = fs.readFileSync(scriptPath, 'utf-8');
            expect(content).toContain('Set-Location');
        });

        it('writes .sh on linux and sets chmod 755', async () => {
            const notesDir = path.join(tmpDir, 'notes');
            fs.mkdirSync(notesDir, { recursive: true });

            const scriptPath = await writeAutoCommitScript(tmpDir, 'ws1', notesDir, 'linux');
            expect(scriptPath).toMatch(/notes-autocommit\.sh$/);
            expect(fs.existsSync(scriptPath)).toBe(true);

            const content = fs.readFileSync(scriptPath, 'utf-8');
            expect(content).toContain('#!/bin/bash');

            // Check execute permission on non-Windows
            if (process.platform !== 'win32') {
                const stat = fs.statSync(scriptPath);
                // eslint-disable-next-line no-bitwise
                expect(stat.mode & 0o755).toBe(0o755);
            }
        });

        it('creates parent directories if they do not exist', async () => {
            const notesDir = '/some/notes';
            const wsId = 'new-ws';

            const scriptPath = await writeAutoCommitScript(tmpDir, wsId, notesDir, 'win32');
            expect(fs.existsSync(scriptPath)).toBe(true);
        });
    });

    // ========================================================================
    // deleteAutoCommitScript
    // ========================================================================

    describe('deleteAutoCommitScript', () => {
        it('removes both .ps1 and .sh variants', async () => {
            const wsId = 'ws-del';
            const ps1Path = getRepoDataPath(tmpDir, wsId, 'notes-autocommit.ps1');
            const shPath = getRepoDataPath(tmpDir, wsId, 'notes-autocommit.sh');

            // Create both files
            fs.mkdirSync(path.dirname(ps1Path), { recursive: true });
            fs.writeFileSync(ps1Path, 'ps1', 'utf-8');
            fs.writeFileSync(shPath, 'sh', 'utf-8');

            await deleteAutoCommitScript(tmpDir, wsId);

            expect(fs.existsSync(ps1Path)).toBe(false);
            expect(fs.existsSync(shPath)).toBe(false);
        });

        it('tolerates missing files (ENOENT)', async () => {
            // Should not throw even when files don't exist
            await expect(deleteAutoCommitScript(tmpDir, 'nonexistent')).resolves.toBeUndefined();
        });
    });

    // ========================================================================
    // buildAutoCommitScheduleTarget
    // ========================================================================

    describe('buildAutoCommitScheduleTarget', () => {
        it('returns PowerShell invocation on win32', () => {
            const target = buildAutoCommitScheduleTarget('C:\\path\\to\\script.ps1', 'win32');
            expect(target).toBe('powershell -ExecutionPolicy Bypass -File "C:\\path\\to\\script.ps1"');
        });

        it('returns bash invocation on linux', () => {
            const target = buildAutoCommitScheduleTarget('/path/to/script.sh', 'linux');
            expect(target).toBe('bash "/path/to/script.sh"');
        });

        it('returns bash invocation on darwin', () => {
            const target = buildAutoCommitScheduleTarget('/path/to/script.sh', 'darwin');
            expect(target).toBe('bash "/path/to/script.sh"');
        });
    });

    // ========================================================================
    // findAutoCommitSchedule
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
