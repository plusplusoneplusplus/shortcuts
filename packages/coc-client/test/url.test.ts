import { describe, expect, it } from 'vitest';
import { buildApiUrl, buildQueryString, buildWebSocketUrl, encodePathSegment } from '../src';

describe('URL helpers', () => {
  it('builds API URLs without double-prefixing api paths', () => {
    expect(buildApiUrl('http://localhost:4000/', '/api/', '/health')).toBe('http://localhost:4000/api/health');
    expect(buildApiUrl('http://localhost:4000', '/api', '/api/health')).toBe('http://localhost:4000/api/health');
    expect(buildApiUrl('', '', '/providers/config')).toBe('/providers/config');
  });

  it('omits null and undefined query params', () => {
    expect(buildQueryString({ a: 1, b: undefined, c: null, d: false })).toBe('?a=1&d=false');
  });

  it('encodes workspace IDs containing slashes as a single route segment', () => {
    expect(encodePathSegment('repo/a')).toBe('repo%2Fa');
  });

  it('builds WebSocket URLs from HTTP and HTTPS bases', () => {
    expect(buildWebSocketUrl('http://localhost:4000', '/ws', { workspaceId: 'repo/a' }))
      .toBe('ws://localhost:4000/ws?workspaceId=repo%2Fa');
    expect(buildWebSocketUrl('https://example.test', '/events'))
      .toBe('wss://example.test/events');
  });
});
