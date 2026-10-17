import { describe, expect, it } from 'vitest';
import { dateTimeCandidates, triggerLocalTime, zonedTriggerTime } from '../src';

describe('date/time trigger wall-clock validation', () => {
  it('resolves UTC, fractional offsets and zones independently of the host timezone', () => {
    expect(dateTimeCandidates('2027-01-15T09:30', 'UTC')).toEqual(['2027-01-15T09:30:00.000Z']);
    expect(dateTimeCandidates('2027-01-15T09:30', 'Asia/Kathmandu')).toEqual(['2027-01-15T03:45:00.000Z']);
    expect(triggerLocalTime('2027-01-15T03:45:00.000Z', 'Asia/Kathmandu')).toBe('2027-01-15T09:30');
    expect(zonedTriggerTime('2027-01-15T03:45:00.000Z', 'Asia/Kathmandu')).toContain('9:30');
  });
  it('rejects DST gaps and exposes both overlap instants without a silent default', () => {
    expect(dateTimeCandidates('2027-03-14T02:30', 'America/New_York')).toEqual([]);
    expect(dateTimeCandidates('2027-11-07T01:30', 'America/New_York')).toEqual([
      '2027-11-07T05:30:00.000Z', '2027-11-07T06:30:00.000Z',
    ]);
    expect(dateTimeCandidates('2027-04-04T01:45', 'Australia/Lord_Howe')).toEqual([
      '2027-04-03T14:45:00.000Z', '2027-04-03T15:15:00.000Z',
    ]);
  });
  it.each(['2027-02-30T12:00', '2027-01-01T24:00', '2027-01-01', 'invalid'])('rejects malformed date %s', local => {
    expect(() => dateTimeCandidates(local, 'UTC')).toThrow();
  });
  it.each(['Unknown/Zone', '', '+02:00'])('rejects invalid zone %s', zone => {
    expect(() => dateTimeCandidates('2027-01-01T12:00', zone)).toThrow();
  });
});
