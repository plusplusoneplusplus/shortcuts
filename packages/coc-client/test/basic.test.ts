import { describe, expect, it, vi } from 'vitest';
import { CocClient } from '../src';

describe('CocClient', () => {
  it('constructs with normalized defaults', () => {
    const fetchMock = vi.fn();
    const client = new CocClient({ baseUrl: 'http://localhost:4000/', fetch: fetchMock as typeof fetch });

    expect(client.options.baseUrl).toBe('http://localhost:4000');
    expect(client.options.apiBasePath).toBe('/api');
    expect(client.health).toBeDefined();
    expect(client.processes).toBeDefined();
    expect(client.workflow).toBeDefined();
    expect(client.repos).toBe(client.workspaces);
  });
});
