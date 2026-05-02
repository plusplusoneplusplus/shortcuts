import { describe, expect, it } from 'vitest';
import {
  buildApiUrl,
  buildQueryString,
  buildWebSocketUrl,
  encodePathSegment,
  normalizeApiBasePath,
  normalizeBaseUrl,
} from '../src';

describe('URL helpers', () => {
  describe('normalizeBaseUrl', () => {
    it('returns an empty base for browser same-origin mode', () => {
      expect(normalizeBaseUrl()).toBe('');
      expect(normalizeBaseUrl('')).toBe('');
    });

    it('trims trailing slashes while preserving non-empty URL prefixes', () => {
      expect(normalizeBaseUrl('http://localhost:4000/')).toBe('http://localhost:4000');
      expect(normalizeBaseUrl('https://example.test/coc///')).toBe('https://example.test/coc');
      expect(normalizeBaseUrl('http://[::1]:4000/api')).toBe('http://[::1]:4000/api');
    });

    it('does not validate non-empty URL input', () => {
      expect(normalizeBaseUrl('not a url///')).toBe('not a url');
    });
  });

  describe('normalizeApiBasePath', () => {
    it('defaults to /api', () => {
      expect(normalizeApiBasePath()).toBe('/api');
    });

    it('adds a leading slash and strips trailing slashes', () => {
      expect(normalizeApiBasePath('api')).toBe('/api');
      expect(normalizeApiBasePath('/api/')).toBe('/api');
      expect(normalizeApiBasePath('coc/api///')).toBe('/coc/api');
    });

    it('preserves an explicit empty API prefix', () => {
      expect(normalizeApiBasePath('')).toBe('');
    });
  });

  it('builds API URLs without double-prefixing api paths', () => {
    expect(buildApiUrl('http://localhost:4000/', '/api/', '/health')).toBe('http://localhost:4000/api/health');
    expect(buildApiUrl('http://localhost:4000', '/api', '/api/health')).toBe('http://localhost:4000/api/health');
    expect(buildApiUrl('', '', '/providers/config')).toBe('/providers/config');
  });

  it('treats paths with and without a leading slash the same', () => {
    expect(buildApiUrl('http://localhost:4000', '/api', 'health')).toBe('http://localhost:4000/api/health');
    expect(buildApiUrl('http://localhost:4000', '/api', '/health')).toBe('http://localhost:4000/api/health');
  });

  it('builds relative same-origin API URLs', () => {
    expect(buildApiUrl('', '/api', 'health')).toBe('/api/health');
  });

  it('omits nullish query params while preserving falsey values', () => {
    expect(buildQueryString({ a: 1, b: undefined, c: null, d: false, e: 0, f: '' })).toBe('?a=1&d=false&e=0&f=');
  });

  it('serializes array query values as a single comma-joined param', () => {
    expect(buildQueryString({ status: ['running', 'queued'], empty: [], sparse: ['x', null, undefined, 'y'] }))
      .toBe('?status=running%2Cqueued&sparse=x%2Cy');
  });

  it('coerces out-of-contract object and Date query values with String', () => {
    const date = new Date('2026-05-02T00:30:06.138Z');
    const objectValue = { toString: () => 'custom-object' };
    // Objects and Dates are outside the public query type, but runtime callers are coerced with String().
    const query = { objectValue, date } as unknown as Parameters<typeof buildQueryString>[0];
    const expected = new URLSearchParams({
      objectValue: String(objectValue),
      date: String(date),
    }).toString();

    expect(buildQueryString(query)).toBe(`?${expected}`);
  });

  it('appends serialized query params when building API URLs', () => {
    expect(buildApiUrl('http://localhost:4000', '/api', '/processes', {
      workspace: 'repo/a',
      status: ['running', 'queued'],
      includeEmpty: '',
    })).toBe('http://localhost:4000/api/processes?workspace=repo%2Fa&status=running%2Cqueued&includeEmpty=');
  });

  it('encodes workspace IDs containing slashes as a single route segment', () => {
    expect(encodePathSegment('repo/a')).toBe('repo%2Fa');
    expect(encodePathSegment('repo/a space/雪%done')).toBe('repo%2Fa%20space%2F%E9%9B%AA%25done');
  });

  it('builds WebSocket URLs from HTTP and HTTPS bases', () => {
    expect(buildWebSocketUrl('http://localhost:4000', '/ws', { workspaceId: 'repo/a' }))
      .toBe('ws://localhost:4000/ws?workspaceId=repo%2Fa');
    expect(buildWebSocketUrl('https://example.test', '/events'))
      .toBe('wss://example.test/events');
  });
});
