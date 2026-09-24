/** Format today's date as "Mon DD" (e.g. "Jan 15"). */
export function formatSyncDate(): string {
    const d = new Date();
    const month = d.toLocaleString('en-US', { month: 'short' });
    return `${month} ${d.getDate()}`;
}

/** Return ISO week number and year for a given date. */
export function getISOWeek(date: Date): { year: number; week: number } {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
}

/** Return formatted start/end dates for a given ISO week. */
export function getWeekDateRange(year: number, week: number): { start: string; end: string } {
    const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    const dayOfWeek = simple.getUTCDay();
    const isoStart = new Date(simple);
    isoStart.setUTCDate(simple.getUTCDate() - (dayOfWeek <= 4 ? dayOfWeek - 1 : dayOfWeek - 8));
    const isoEnd = new Date(isoStart);
    isoEnd.setUTCDate(isoStart.getUTCDate() + 4);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { start: fmt(isoStart), end: fmt(isoEnd) };
}
