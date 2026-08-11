/**
 * Tests for the schedule runtime key encoder.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import {
    parseScheduleRuntimeKey,
    runtimeKeyMatchesSchedule,
    scheduleRuntimeKey,
} from '../src/server/schedule/schedule-runtime-key';

describe('scheduleRuntimeKey', () => {
    it('is stable for the same pair', () => {
        expect(scheduleRuntimeKey('repo-a', 'repo:daily'))
            .toBe(scheduleRuntimeKey('repo-a', 'repo:daily'));
    });

    it('distinguishes the same schedule ID in different repos', () => {
        expect(scheduleRuntimeKey('repo-a', 'repo:daily'))
            .not.toBe(scheduleRuntimeKey('repo-b', 'repo:daily'));
    });

    it('distinguishes different schedule IDs in the same repo', () => {
        expect(scheduleRuntimeKey('repo-a', 'repo:daily'))
            .not.toBe(scheduleRuntimeKey('repo-a', 'repo:weekly'));
    });

    it('does not collide when a repoId ends with part of another', () => {
        // Without a reserved separator, ('a', 'b:c') and ('a:b', 'c') could
        // both flatten to the same key.
        expect(scheduleRuntimeKey('a', 'b:c')).not.toBe(scheduleRuntimeKey('a:b', 'c'));
    });

    it('round-trips through parseScheduleRuntimeKey', () => {
        const key = scheduleRuntimeKey('ws-v2-abc', 'repo:daily-cleanup');
        expect(parseScheduleRuntimeKey(key)).toEqual({
            repoId: 'ws-v2-abc',
            scheduleId: 'repo:daily-cleanup',
        });
    });

    it('round-trips schedule IDs that themselves contain colons', () => {
        const key = scheduleRuntimeKey('repo-a', 'repo:nested:name');
        expect(parseScheduleRuntimeKey(key).scheduleId).toBe('repo:nested:name');
    });
});

describe('runtimeKeyMatchesSchedule', () => {
    it('matches the schedule ID regardless of repo', () => {
        expect(runtimeKeyMatchesSchedule(scheduleRuntimeKey('repo-b', 'repo:daily'), 'repo:daily')).toBe(true);
    });

    it('does not match a different schedule ID', () => {
        expect(runtimeKeyMatchesSchedule(scheduleRuntimeKey('repo-a', 'repo:daily'), 'repo:weekly')).toBe(false);
    });

    it('does not match on a suffix of the schedule ID', () => {
        expect(runtimeKeyMatchesSchedule(scheduleRuntimeKey('repo-a', 'repo:daily'), 'daily')).toBe(false);
    });
});
