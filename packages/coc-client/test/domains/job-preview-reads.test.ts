import { describe, expect, it } from 'vitest';
import { CocClient, ProcessesClient, TaskGroupsClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('abortable compact job reads', () => {
  it('preserves concrete workspace, excludes conversation and forwards cancellation', async () => {
    const adapter = createMockAdapter({ process: { id: 'job/1' } });
    const signal = new AbortController().signal;
    await new ProcessesClient(adapter, new CocClient().options).get('job/1', {
      workspace: 'ws/owner', preview: true, exclude: ['conversation', 'toolCalls'],
    }, { signal });
    expect(adapter.calls[0]).toMatchObject({ path: '/processes/job%2F1', options: {
      signal, query: { workspace: 'ws/owner', preview: true, exclude: 'conversation,toolCalls' },
    } });
  });
  it('reads a whole Ralph group on its owner and forwards cancellation', async () => {
    const adapter = createMockAdapter({ group: { groupId: 'ralph/1' } });
    const signal = new AbortController().signal;
    await expect(new TaskGroupsClient(adapter).get('ws/owner', 'ralph/1', { signal })).resolves.toEqual({ groupId: 'ralph/1' });
    expect(adapter.calls[0]).toEqual({ path: '/workspaces/ws%2Fowner/task-groups/ralph%2F1', options: { signal } });
  });
});
