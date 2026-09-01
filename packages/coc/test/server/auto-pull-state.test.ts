/**
 * Auto-pull run-state tests.
 *
 * Covers the persistence half of AC-03: a terminal tick records its outcome,
 * boot anchors the next run on the persisted `lastRunAt` instead of resetting
 * to a full interval, and a missing/corrupt file degrades to "never run"
 * instead of throwing.
 *
 * Real filesystem under a temp dir; no git, no timers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    AUTO_PULL_STATE_FILE_NAME,
    OVERDUE_FIRST_TICK_DELAY_MS,
    OVERDUE_STAGGER_MAX_MS,
    OVERDUE_STAGGER_STEP_MS,
    clearAutoPullState,
    computeFirstTickDelayMs,
    computeNextRunAt,
    readAutoPullState,
    writeAutoPullState,
} from '../../src/server/git/auto-pull-state';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

let dataDir: string;

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pull-state-'));
});

afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

function stateFile(workspaceId: string): string {
    return path.join(dataDir, 'repos', workspaceId, AUTO_PULL_STATE_FILE_NAME);
}

describe('auto-pull run state persistence', () => {
    it('round-trips a success outcome, creating the repo directory', () => {
        writeAutoPullState(dataDir, 'ws-1', { lastRunAt: '2026-08-29T10:00:00.000Z', outcome: 'success' });

        expect(fs.existsSync(stateFile('ws-1'))).toBe(true);
        expect(readAutoPullState(dataDir, 'ws-1')).toEqual({
            lastRunAt: '2026-08-29T10:00:00.000Z',
            outcome: 'success',
        });
    });

    it('round-trips a dirty skip with its message', () => {
        writeAutoPullState(dataDir, 'ws-1', {
            lastRunAt: '2026-08-29T10:00:00.000Z',
            outcome: 'skipped-dirty',
            message: 'uncommitted changes in the working tree',
        });

        expect(readAutoPullState(dataDir, 'ws-1')).toEqual({
            lastRunAt: '2026-08-29T10:00:00.000Z',
            outcome: 'skipped-dirty',
            message: 'uncommitted changes in the working tree',
        });
    });

    it('overwrites the previous run rather than appending', () => {
        writeAutoPullState(dataDir, 'ws-1', { lastRunAt: '2026-08-29T10:00:00.000Z', outcome: 'failed', message: 'boom' });
        writeAutoPullState(dataDir, 'ws-1', { lastRunAt: '2026-08-29T11:00:00.000Z', outcome: 'success' });

        expect(readAutoPullState(dataDir, 'ws-1')).toEqual({
            lastRunAt: '2026-08-29T11:00:00.000Z',
            outcome: 'success',
        });
    });

    it('keeps each workspace on its own file', () => {
        writeAutoPullState(dataDir, 'ws-1', { lastRunAt: '2026-08-29T10:00:00.000Z', outcome: 'success' });
        writeAutoPullState(dataDir, 'ws-2', { lastRunAt: '2026-08-29T09:00:00.000Z', outcome: 'failed', message: 'nope' });

        expect(readAutoPullState(dataDir, 'ws-1')?.outcome).toBe('success');
        expect(readAutoPullState(dataDir, 'ws-2')?.outcome).toBe('failed');
    });

    it('leaves no .tmp file behind after an atomic write', () => {
        writeAutoPullState(dataDir, 'ws-1', { lastRunAt: '2026-08-29T10:00:00.000Z', outcome: 'success' });

        const entries = fs.readdirSync(path.join(dataDir, 'repos', 'ws-1'));
        expect(entries).toEqual([AUTO_PULL_STATE_FILE_NAME]);
    });

    it('treats a missing file as never run', () => {
        expect(readAutoPullState(dataDir, 'never-touched')).toBeUndefined();
    });

    it('treats a corrupt file as never run instead of throwing', () => {
        fs.mkdirSync(path.dirname(stateFile('ws-1')), { recursive: true });
        fs.writeFileSync(stateFile('ws-1'), '{ not json', 'utf-8');

        expect(() => readAutoPullState(dataDir, 'ws-1')).not.toThrow();
        expect(readAutoPullState(dataDir, 'ws-1')).toBeUndefined();
    });

    it.each([
        ['a JSON array', '[]'],
        ['a missing lastRunAt', JSON.stringify({ outcome: 'success' })],
        ['an unparseable lastRunAt', JSON.stringify({ lastRunAt: 'whenever', outcome: 'success' })],
        ['an unknown outcome', JSON.stringify({ lastRunAt: '2026-08-29T10:00:00.000Z', outcome: 'exploded' })],
    ])('treats %s as never run', (_label, contents) => {
        fs.mkdirSync(path.dirname(stateFile('ws-1')), { recursive: true });
        fs.writeFileSync(stateFile('ws-1'), contents, 'utf-8');

        expect(readAutoPullState(dataDir, 'ws-1')).toBeUndefined();
    });

    it('drops a non-string message rather than rejecting the whole record', () => {
        fs.mkdirSync(path.dirname(stateFile('ws-1')), { recursive: true });
        fs.writeFileSync(
            stateFile('ws-1'),
            JSON.stringify({ lastRunAt: '2026-08-29T10:00:00.000Z', outcome: 'failed', message: 42 }),
            'utf-8',
        );

        expect(readAutoPullState(dataDir, 'ws-1')).toEqual({
            lastRunAt: '2026-08-29T10:00:00.000Z',
            outcome: 'failed',
        });
    });

    it('clears state and tolerates clearing state that is not there', () => {
        writeAutoPullState(dataDir, 'ws-1', { lastRunAt: '2026-08-29T10:00:00.000Z', outcome: 'success' });
        clearAutoPullState(dataDir, 'ws-1');
        expect(readAutoPullState(dataDir, 'ws-1')).toBeUndefined();

        expect(() => clearAutoPullState(dataDir, 'ws-1')).not.toThrow();
        expect(() => clearAutoPullState(dataDir, 'never-touched')).not.toThrow();
    });
});

describe('computeFirstTickDelayMs', () => {
    const now = Date.parse('2026-08-29T12:00:00.000Z');

    it('waits a full interval when the repo has never run', () => {
        expect(computeFirstTickDelayMs({ state: undefined, intervalMinutes: 480, now }))
            .toBe(8 * HOUR_MS);
    });

    it('fires near-immediately when the last run is older than the interval', () => {
        const state = { lastRunAt: new Date(now - 9 * HOUR_MS).toISOString(), outcome: 'success' as const };

        expect(computeFirstTickDelayMs({ state, intervalMinutes: 480, now }))
            .toBe(OVERDUE_FIRST_TICK_DELAY_MS);
    });

    it('schedules the remainder of the interval when the last run is recent', () => {
        const state = { lastRunAt: new Date(now - HOUR_MS).toISOString(), outcome: 'success' as const };

        expect(computeFirstTickDelayMs({ state, intervalMinutes: 480, now }))
            .toBe(7 * HOUR_MS);
    });

    it('staggers overdue repos so they do not all pull at once', () => {
        const state = { lastRunAt: new Date(now - 9 * HOUR_MS).toISOString(), outcome: 'success' as const };

        expect(computeFirstTickDelayMs({ state, intervalMinutes: 480, now, staggerIndex: 0 }))
            .toBe(OVERDUE_FIRST_TICK_DELAY_MS);
        expect(computeFirstTickDelayMs({ state, intervalMinutes: 480, now, staggerIndex: 3 }))
            .toBe(OVERDUE_FIRST_TICK_DELAY_MS + 3 * OVERDUE_STAGGER_STEP_MS);
    });

    it('caps the stagger so a long workspace list cannot push a repo far out', () => {
        const state = { lastRunAt: new Date(now - 9 * HOUR_MS).toISOString(), outcome: 'success' as const };

        expect(computeFirstTickDelayMs({ state, intervalMinutes: 480, now, staggerIndex: 10_000 }))
            .toBe(OVERDUE_FIRST_TICK_DELAY_MS + OVERDUE_STAGGER_MAX_MS);
    });

    it('treats a due-exactly-now last run as overdue', () => {
        const state = { lastRunAt: new Date(now - 8 * HOUR_MS).toISOString(), outcome: 'success' as const };

        expect(computeFirstTickDelayMs({ state, intervalMinutes: 480, now }))
            .toBe(OVERDUE_FIRST_TICK_DELAY_MS);
    });

    it('does not park a repo forever when lastRunAt is in the future', () => {
        const state = { lastRunAt: new Date(now + 5 * HOUR_MS).toISOString(), outcome: 'success' as const };

        expect(computeFirstTickDelayMs({ state, intervalMinutes: 480, now }))
            .toBe(OVERDUE_FIRST_TICK_DELAY_MS);
    });

    it('never waits longer than one interval', () => {
        const state = { lastRunAt: new Date(now - MINUTE_MS).toISOString(), outcome: 'skipped-dirty' as const };

        expect(computeFirstTickDelayMs({ state, intervalMinutes: 1, now })).toBe(OVERDUE_FIRST_TICK_DELAY_MS);
        expect(computeFirstTickDelayMs({ state: undefined, intervalMinutes: 1, now })).toBe(MINUTE_MS);
    });

    it('records a skip outcome without changing the anchor semantics', () => {
        // A dirty skip still counts as a run: the next attempt is one interval later.
        const state = { lastRunAt: new Date(now - 2 * MINUTE_MS).toISOString(), outcome: 'skipped-dirty' as const };

        expect(computeFirstTickDelayMs({ state, intervalMinutes: 5, now })).toBe(3 * MINUTE_MS);
    });
});

describe('computeNextRunAt', () => {
    it('renders the schedule instant the client counts down to', () => {
        const now = Date.parse('2026-08-29T12:00:00.000Z');

        expect(computeNextRunAt(now, 5 * MINUTE_MS)).toBe('2026-08-29T12:05:00.000Z');
    });
});
