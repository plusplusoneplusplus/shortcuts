/** Schedule preset model for prompt-first schedule creation. */

export type PromptSchedulePreset = 'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';

export interface PresetOption {
    value: PromptSchedulePreset;
    label: string;
}

export const PROMPT_SCHEDULE_PRESETS: PresetOption[] = [
    { value: 'manual', label: 'Manual' },
    { value: 'hourly', label: 'Hourly' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekdays', label: 'Weekdays' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'custom', label: 'Custom' },
];

export const WEEKDAY_CHIPS: Array<{ value: string; label: string; short: string }> = [
    { value: '1', label: 'Monday', short: 'Mon' },
    { value: '2', label: 'Tuesday', short: 'Tue' },
    { value: '3', label: 'Wednesday', short: 'Wed' },
    { value: '4', label: 'Thursday', short: 'Thu' },
    { value: '5', label: 'Friday', short: 'Fri' },
    { value: '6', label: 'Saturday', short: 'Sat' },
    { value: '0', label: 'Sunday', short: 'Sun' },
];

/** Placeholder cron used for "manual" schedules (created in paused state). */
export const MANUAL_PLACEHOLDER_CRON = '0 0 * * *';

export function presetToCron(preset: PromptSchedulePreset, hour: number, minute: number, dayOfWeek: string): string {
    const mm = String(minute);
    const hh = String(hour);
    switch (preset) {
        case 'manual': return MANUAL_PLACEHOLDER_CRON;
        case 'hourly': return `${mm} * * * *`;
        case 'daily': return `${mm} ${hh} * * *`;
        case 'weekdays': return `${mm} ${hh} * * 1-5`;
        case 'weekly': return `${mm} ${hh} * * ${dayOfWeek}`;
        case 'custom': return `${mm} ${hh} * * *`;
    }
}

export function inferPresetFromCron(cron: string): { preset: PromptSchedulePreset; hour: number; minute: number; dayOfWeek: string } {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
        return { preset: 'custom', hour: 9, minute: 0, dayOfWeek: '1' };
    }
    const [min, hr, dom, mon, dow] = parts;

    // Hourly: N * * * *
    if (hr === '*' && dom === '*' && mon === '*' && dow === '*') {
        const m = parseInt(min, 10);
        return { preset: 'hourly', hour: 9, minute: isNaN(m) ? 0 : m, dayOfWeek: '1' };
    }

    // Need fixed hour and minute for daily/weekdays/weekly
    const parsedMin = parseInt(min, 10);
    const parsedHr = parseInt(hr, 10);
    if (isNaN(parsedMin) || isNaN(parsedHr)) {
        return { preset: 'custom', hour: 9, minute: 0, dayOfWeek: '1' };
    }

    if (dom === '*' && mon === '*') {
        if (dow === '*') return { preset: 'daily', hour: parsedHr, minute: parsedMin, dayOfWeek: '1' };
        if (dow === '1-5') return { preset: 'weekdays', hour: parsedHr, minute: parsedMin, dayOfWeek: '1' };
        if (/^[0-7]$/.test(dow)) return { preset: 'weekly', hour: parsedHr, minute: parsedMin, dayOfWeek: dow };
    }

    return { preset: 'custom', hour: parsedHr, minute: parsedMin, dayOfWeek: '1' };
}

export function describePromptSchedule(preset: PromptSchedulePreset, hour: number, minute: number, dayOfWeek: string): string {
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const dayName = WEEKDAY_CHIPS.find(d => d.value === dayOfWeek)?.label ?? 'Monday';
    switch (preset) {
        case 'manual': return 'Runs only when triggered manually.';
        case 'hourly': return `Runs every hour at :${String(minute).padStart(2, '0')}.`;
        case 'daily': return `Runs daily at ${time}.`;
        case 'weekdays': return `Runs weekdays at ${time}.`;
        case 'weekly': return `Runs every ${dayName} at ${time}.`;
        case 'custom': return 'Custom schedule.';
    }
}
