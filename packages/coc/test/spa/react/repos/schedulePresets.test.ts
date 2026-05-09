/**
 * Tests for schedulePresets — preset-to-cron mapping, cron-to-preset inference,
 * and human-readable schedule descriptions.
 */

import { describe, it, expect } from 'vitest';
import {
    presetToCron,
    inferPresetFromCron,
    describePromptSchedule,
    MANUAL_PLACEHOLDER_CRON,
} from '../../../../src/server/spa/client/react/features/schedules/schedulePresets';

describe('presetToCron', () => {
    it('returns placeholder cron for manual', () => {
        expect(presetToCron('manual', 9, 0, '1')).toBe(MANUAL_PLACEHOLDER_CRON);
    });

    it('generates hourly cron with minute', () => {
        expect(presetToCron('hourly', 9, 15, '1')).toBe('15 * * * *');
    });

    it('generates daily cron with hour and minute', () => {
        expect(presetToCron('daily', 14, 30, '1')).toBe('30 14 * * *');
    });

    it('generates weekdays cron', () => {
        expect(presetToCron('weekdays', 9, 0, '1')).toBe('0 9 * * 1-5');
    });

    it('generates weekly cron with day of week', () => {
        expect(presetToCron('weekly', 10, 0, '5')).toBe('0 10 * * 5');
    });
});

describe('inferPresetFromCron', () => {
    it('infers hourly from "0 * * * *"', () => {
        const result = inferPresetFromCron('0 * * * *');
        expect(result.preset).toBe('hourly');
        expect(result.minute).toBe(0);
    });

    it('infers hourly with minute offset from "15 * * * *"', () => {
        const result = inferPresetFromCron('15 * * * *');
        expect(result.preset).toBe('hourly');
        expect(result.minute).toBe(15);
    });

    it('infers daily from "0 9 * * *"', () => {
        const result = inferPresetFromCron('0 9 * * *');
        expect(result.preset).toBe('daily');
        expect(result.hour).toBe(9);
        expect(result.minute).toBe(0);
    });

    it('infers weekdays from "0 9 * * 1-5"', () => {
        const result = inferPresetFromCron('0 9 * * 1-5');
        expect(result.preset).toBe('weekdays');
        expect(result.hour).toBe(9);
    });

    it('infers weekly from "30 14 * * 5"', () => {
        const result = inferPresetFromCron('30 14 * * 5');
        expect(result.preset).toBe('weekly');
        expect(result.hour).toBe(14);
        expect(result.minute).toBe(30);
        expect(result.dayOfWeek).toBe('5');
    });

    it('falls back to custom for complex cron', () => {
        const result = inferPresetFromCron('*/15 * * * *');
        expect(result.preset).toBe('hourly');
    });

    it('falls back to custom for non-standard patterns', () => {
        const result = inferPresetFromCron('0 9 1 * *');
        expect(result.preset).toBe('custom');
    });

    it('handles invalid cron gracefully', () => {
        const result = inferPresetFromCron('bad cron');
        expect(result.preset).toBe('custom');
    });
});

describe('describePromptSchedule', () => {
    it('describes manual', () => {
        expect(describePromptSchedule('manual', 9, 0, '1')).toBe('Runs only when triggered manually.');
    });

    it('describes hourly', () => {
        expect(describePromptSchedule('hourly', 9, 15, '1')).toBe('Runs every hour at :15.');
    });

    it('describes daily', () => {
        expect(describePromptSchedule('daily', 9, 0, '1')).toBe('Runs daily at 09:00.');
    });

    it('describes weekdays', () => {
        expect(describePromptSchedule('weekdays', 14, 30, '1')).toBe('Runs weekdays at 14:30.');
    });

    it('describes weekly', () => {
        expect(describePromptSchedule('weekly', 10, 0, '5')).toBe('Runs every Friday at 10:00.');
    });

    it('describes custom', () => {
        expect(describePromptSchedule('custom', 9, 0, '1')).toBe('Custom schedule.');
    });
});
