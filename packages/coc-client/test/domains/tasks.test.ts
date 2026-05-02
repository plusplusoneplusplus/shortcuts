import { describe, expect, it } from 'vitest';
import { TasksClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('TasksClient', () => {
  it('calls task tree, settings, content, and mutation endpoints', async () => {
    const adapter = createMockAdapter({
      tasks: { name: 'root', relativePath: '', children: [], documentGroups: [], singleDocuments: [] },
      counts: { 'task.md': 2 },
    });
    const client = new TasksClient(adapter);

    await client.getTree('repo/a', { showArchived: true });
    await client.getCommentCounts('repo/a');
    await client.getSettings('repo/a');
    await client.updateSettings('repo/a', { folderPaths: ['tasks'] });
    await client.getContent('repo/a', 'task.md');
    await client.writeContent('repo/a', { path: 'task.md', content: '# Updated' });
    await client.previewWorkspaceFile('repo/a', 'docs/readme.md', { lines: 0 });
    await client.create('repo/a', { type: 'folder', name: 'feature', parent: '' });
    await client.rename('repo/a', 'feature', 'renamed');
    await client.updateStatus('repo/a', 'task.md', 'done');
    await client.move('repo/a', { sourcePath: 'task.md', destinationFolder: 'done', destinationWorkspaceId: 'repo-b' });
    await client.archive('repo/a', { path: 'task.md', action: 'archive', folderPath: 'tasks' });
    await client.getUndoArchiveStatus('repo/a');
    await client.undoArchive('repo/a');
    await client.delete('repo/a', { path: 'task.md', folderPath: 'tasks' });
    await client.openFile('repo/a', { path: 'task.md' });

    expect(adapter.calls).toMatchObject([
      { path: '/workspaces/repo%2Fa/summary', options: { query: { showArchived: true } } },
      { path: '/workspaces/repo%2Fa/tasks/comment-counts' },
      { path: '/workspaces/repo%2Fa/tasks/settings' },
      { path: '/workspaces/repo%2Fa/tasks/settings', options: { method: 'PATCH', body: { folderPaths: ['tasks'] } } },
      { path: '/workspaces/repo%2Fa/tasks/content', options: { query: { path: 'task.md' } } },
      { path: '/workspaces/repo%2Fa/tasks/content', options: { method: 'PATCH', body: { path: 'task.md', content: '# Updated' } } },
      { path: '/workspaces/repo%2Fa/files/preview', options: { query: { path: 'docs/readme.md', lines: 0 } } },
      { path: '/workspaces/repo%2Fa/tasks', options: { method: 'POST', body: { type: 'folder', name: 'feature', parent: '' } } },
      { path: '/workspaces/repo%2Fa/tasks', options: { method: 'PATCH', body: { path: 'feature', newName: 'renamed' } } },
      { path: '/workspaces/repo%2Fa/tasks', options: { method: 'PATCH', body: { path: 'task.md', status: 'done' } } },
      {
        path: '/workspaces/repo%2Fa/tasks/move',
        options: { method: 'POST', body: { sourcePath: 'task.md', destinationFolder: 'done', destinationWorkspaceId: 'repo-b' } },
      },
      { path: '/workspaces/repo%2Fa/tasks/archive', options: { method: 'POST', body: { path: 'task.md', action: 'archive', folderPath: 'tasks' } } },
      { path: '/workspaces/repo%2Fa/tasks/undo-archive' },
      { path: '/workspaces/repo%2Fa/tasks/undo-archive', options: { method: 'POST' } },
      { path: '/workspaces/repo%2Fa/tasks', options: { method: 'DELETE', body: { path: 'task.md', folderPath: 'tasks' } } },
      { path: '/workspaces/repo%2Fa/open-file', options: { method: 'POST', body: { path: 'task.md' } } },
    ]);
  });

  it('calls task comment endpoints with encoded task paths', async () => {
    const adapter = createMockAdapter({
      comments: [],
      comment: { id: 'c1', selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }, selectedText: 'x', comment: 'fix', status: 'open' },
      reply: { author: 'AI', text: 'ok' },
      taskId: 'q1',
    });
    const client = new TasksClient(adapter);
    const selection = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 };

    await client.listComments('repo-a', 'folder/task.md');
    await client.getComment('repo-a', 'folder/task.md', 'comment/1');
    await client.createComment('repo-a', 'folder/task.md', { filePath: 'folder/task.md', selection, selectedText: 'x', comment: 'fix' });
    await client.updateComment('repo-a', 'folder/task.md', 'comment/1', { status: 'resolved' });
    await client.addCommentReply('repo-a', 'folder/task.md', 'comment/1', { text: 'reply', author: 'me' });
    await client.askCommentAI('repo-a', 'folder/task.md', 'comment/1', { commandId: 'resolve', documentContent: '# Doc' });
    await client.batchResolveComments('repo-a', 'folder/task.md', { documentContent: '# Doc', skills: ['impl'] });
    await client.deleteComment('repo-a', 'folder/task.md', 'comment/1');

    expect(adapter.calls.map(call => call.path)).toEqual([
      '/comments/repo-a/folder%2Ftask.md',
      '/comments/repo-a/folder%2Ftask.md/comment%2F1',
      '/comments/repo-a/folder%2Ftask.md',
      '/comments/repo-a/folder%2Ftask.md/comment%2F1',
      '/comments/repo-a/folder%2Ftask.md/comment%2F1/replies',
      '/comments/repo-a/folder%2Ftask.md/comment%2F1/ask-ai',
      '/comments/repo-a/folder%2Ftask.md/batch-resolve',
      '/comments/repo-a/folder%2Ftask.md/comment%2F1',
    ]);
    expect(adapter.calls[2].options).toMatchObject({ method: 'POST' });
    expect(adapter.calls[3].options).toMatchObject({ method: 'PATCH', body: { status: 'resolved' } });
    expect(adapter.calls[7].options).toMatchObject({ method: 'DELETE' });
  });

  it('copies array payloads for settings updates', async () => {
    const adapter = createMockAdapter({});
    const client = new TasksClient(adapter);
    const folderPaths = ['tasks'];

    await client.updateSettings('repo-a', { folderPaths });
    folderPaths.push('mutated');

    expect(adapter.calls[0]).toMatchObject({
      path: '/workspaces/repo-a/tasks/settings',
      options: { method: 'PATCH', body: { folderPaths: ['tasks'] } },
    });
  });
});
