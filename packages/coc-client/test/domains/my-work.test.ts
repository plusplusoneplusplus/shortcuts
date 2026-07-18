import { describe, expect, it } from 'vitest';
import { MyWorkClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('MyWorkClient', () => {
  it('getTasks calls GET /my-work/tasks', async () => {
    const adapter = createMockAdapter({
      actionItems: [{ id: 'a1', text: 'ship it', checked: false }],
      followUps: [{ id: 'f1', text: 'ping bob', checked: false, person: 'Bob' }],
    });
    const client = new MyWorkClient(adapter);

    const result = await client.getTasks();

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].path).toBe('/my-work/tasks');
    expect(adapter.calls[0].options).toBeUndefined();
    expect(result.actionItems[0].text).toBe('ship it');
    expect(result.followUps[0].person).toBe('Bob');
  });

  it('patchTask calls PATCH /my-work/tasks/:id with body', async () => {
    const adapter = createMockAdapter({ ok: true });
    const client = new MyWorkClient(adapter);

    const result = await client.patchTask('abc123', { checked: true });

    expect(adapter.calls[0].path).toBe('/my-work/tasks/abc123');
    expect(adapter.calls[0].options).toMatchObject({ method: 'PATCH', body: { checked: true } });
    expect(result.ok).toBe(true);
  });

  it('patchTask encodes the id in the URL', async () => {
    const adapter = createMockAdapter({ ok: true });
    const client = new MyWorkClient(adapter);

    await client.patchTask('id/with slash', { text: 'renamed' });

    expect(adapter.calls[0].path).toBe('/my-work/tasks/id%2Fwith%20slash');
    expect(adapter.calls[0].options).toMatchObject({ method: 'PATCH', body: { text: 'renamed' } });
  });

  it('addTask calls POST /my-work/tasks with body (action list)', async () => {
    const adapter = createMockAdapter({ id: 'new1' });
    const client = new MyWorkClient(adapter);

    const result = await client.addTask({ list: 'action', text: 'do a thing' });

    expect(adapter.calls[0].path).toBe('/my-work/tasks');
    expect(adapter.calls[0].options).toMatchObject({
      method: 'POST',
      body: { list: 'action', text: 'do a thing' },
    });
    expect(result.id).toBe('new1');
  });

  it('addTask forwards person for follow-up items', async () => {
    const adapter = createMockAdapter({ id: 'new2' });
    const client = new MyWorkClient(adapter);

    await client.addTask({ list: 'followup', text: 'chase invoice', person: 'Alice' });

    expect(adapter.calls[0].options).toMatchObject({
      method: 'POST',
      body: { list: 'followup', text: 'chase invoice', person: 'Alice' },
    });
  });

  it('archiveTasks calls POST /my-work/tasks/archive', async () => {
    const adapter = createMockAdapter({ archived: 3 });
    const client = new MyWorkClient(adapter);

    const result = await client.archiveTasks();

    expect(adapter.calls[0].path).toBe('/my-work/tasks/archive');
    expect(adapter.calls[0].options).toMatchObject({ method: 'POST' });
    expect(result.archived).toBe(3);
  });
});
