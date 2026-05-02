import { describe, expect, it } from 'vitest';
import { CocClient } from '../../src';

describe('realtime contract', () => {
  it('creates a stream close handle without EventSource in non-browser environments', () => {
    const client = new CocClient({ baseUrl: 'http://localhost:4000', EventSource: undefined });

    expect(client.processes.stream('p1', { onEvent: () => {} })).toMatchObject({ close: expect.any(Function) });
  });
});
