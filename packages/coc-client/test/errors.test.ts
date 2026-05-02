import { describe, expect, it } from 'vitest';
import { CocApiError, CocNetworkError } from '../src';

describe('client errors', () => {
  it('exposes structured API error fields', () => {
    const error = new CocApiError({
      status: 404,
      statusText: 'Not Found',
      url: 'http://localhost/api/missing',
      message: 'Missing',
      code: 'NOT_FOUND',
      details: { id: 'x' },
    });

    expect(error.message).toBe('Missing');
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.details).toEqual({ id: 'x' });
  });

  it('exposes network failure details', () => {
    const error = new CocNetworkError('failed', { url: '/api/health', code: 'NETWORK_ERROR', cause: new Error('boom') });

    expect(error.url).toBe('/api/health');
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.cause).toBeInstanceOf(Error);
  });
});
