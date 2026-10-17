/** Wall-clock authoring shared by the owner server and its editor. */
export function dateTimeCandidates(localTime: string, timeZone: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime)) throw new Error('Enter a date and time');
  const wall = Date.parse(`${localTime}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== localTime) {
    throw new Error('Invalid date or time');
  }
  if (!timeZone || /^[+-]/.test(timeZone)) throw new Error('Enter an IANA timezone');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const partsAt = (instant: number) => {
    const parts = formatter.formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  };
  // Sample both sides of timezone transitions, then verify each possible offset.
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = wall + hours * 3_600_000;
    offsets.add(Date.parse(`${partsAt(instant)}Z`) - instant);
  }
  return [...offsets].map(offset => wall - offset)
    .filter(instant => partsAt(instant) === `${localTime}:00`)
    .sort((a, b) => a - b).map(instant => new Date(instant).toISOString());
}

export function zonedTriggerTime(firesAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, dateStyle: 'medium', timeStyle: 'long',
  }).format(new Date(firesAt));
}

export function triggerLocalTime(firesAt: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(firesAt));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
