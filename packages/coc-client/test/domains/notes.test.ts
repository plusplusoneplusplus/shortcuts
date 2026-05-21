import { describe, expect, it, vi } from 'vitest';
import { CocClient, NotesClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('NotesClient', () => {
  it('calls notes CRUD, search, image, preview, comments, and batch resolve endpoints', async () => {
    const adapter = createMockAdapter({
      tree: [],
      notesRoot: 'notes',
      content: '# Note',
      path: 'Notebook/Page.md',
      updated: true,
      mtime: 123,
      results: [],
      truncated: false,
      version: 1,
      threads: {},
      taskId: 'task-1',
      exists: true,
      type: 'note',
    });
    const client = new NotesClient(adapter);
    const thread = {
      id: 'thread/1',
      anchor: { quotedText: 'x', prefix: '', suffix: '' },
      status: 'open' as const,
      comments: [],
      createdAt: '2026-01-01T00:00:00Z',
    };

    await client.getTree('repo/a');
    await client.getContent('repo/a', 'Notebook/Page.md');
    await client.saveContent('repo/a', 'Notebook/Page.md', '# Updated', 42);
    await client.createNode('repo/a', 'Notebook/New Page.md', 'page');
    await client.renameNode('repo/a', 'Notebook/Old.md', 'Notebook/New.md');
    await client.deleteNode('repo/a', 'Notebook/Delete Me.md');
    await client.reorder('repo/a', 'Notebook', ['A.md', 'B.md']);
    await client.search('repo/a', 'hello world');
    await client.uploadImage('repo/a', 'space image.png', 'data:image/png;base64,AAA=');
    await client.previewFile('repo/a', 'Notebook/Page.md');
    await client.getComments('repo/a', 'Notebook/Page.md');
    await client.saveComments('repo/a', 'Notebook/Page.md', { [thread.id]: thread });
    await client.createThread('repo/a', 'Notebook/Page.md', thread);
    await client.updateThread('repo/a', 'Notebook/Page.md', 'thread/1', 'resolved');
    await client.deleteThread('repo/a', 'Notebook/Page.md', 'thread/1');
    await client.addComment('repo/a', 'Notebook/Page.md', 'thread/1', 'hello');
    await client.editComment('repo/a', 'Notebook/Page.md', 'thread/1', 'comment/2', 'updated');
    await client.deleteComment('repo/a', 'Notebook/Page.md', 'thread/1', 'comment/2');
    await client.batchResolve('repo/a', 'Notebook/Page.md', '# Doc', 'please resolve');

    expect(adapter.calls).toMatchObject([
      { path: '/workspaces/repo%2Fa/notes/tree' },
      { path: '/workspaces/repo%2Fa/notes/content', options: { query: { path: 'Notebook/Page.md' } } },
      {
        path: '/workspaces/repo%2Fa/notes/content',
        options: { method: 'PUT', body: { path: 'Notebook/Page.md', content: '# Updated', expectedMtime: 42 } },
      },
      { path: '/workspaces/repo%2Fa/notes/page', options: { method: 'POST', body: { path: 'Notebook/New Page.md', type: 'page' } } },
      {
        path: '/workspaces/repo%2Fa/notes/path',
        options: { method: 'PATCH', body: { oldPath: 'Notebook/Old.md', newPath: 'Notebook/New.md' } },
      },
      { path: '/workspaces/repo%2Fa/notes/path', options: { method: 'DELETE', query: { path: 'Notebook/Delete Me.md' } } },
      { path: '/workspaces/repo%2Fa/notes/order', options: { method: 'PUT', body: { parentPath: 'Notebook', order: ['A.md', 'B.md'] } } },
      { path: '/workspaces/repo%2Fa/notes/search', options: { query: { q: 'hello world' } } },
      {
        path: '/workspaces/repo%2Fa/notes/image',
        options: { method: 'POST', body: { fileName: 'space image.png', data: 'data:image/png;base64,AAA=' } },
      },
      { path: '/workspaces/repo%2Fa/notes/file-preview', options: { query: { path: 'Notebook/Page.md' } } },
      { path: '/workspaces/repo%2Fa/notes/comments', options: { query: { path: 'Notebook/Page.md' } } },
      { path: '/workspaces/repo%2Fa/notes/comments', options: { method: 'PUT' } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread', options: { method: 'POST' } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread/thread%2F1', options: { method: 'PATCH', body: { path: 'Notebook/Page.md', status: 'resolved' } } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread/thread%2F1', options: { method: 'DELETE', query: { path: 'Notebook/Page.md' } } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread/thread%2F1/comment', options: { method: 'POST' } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread/thread%2F1/comment/comment%2F2', options: { method: 'PATCH' } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread/thread%2F1/comment/comment%2F2', options: { method: 'DELETE' } },
      {
        path: '/workspaces/repo%2Fa/notes/batch-resolve',
        options: { method: 'POST', query: { path: 'Notebook/Page.md' }, body: { documentContent: '# Doc', userContext: 'please resolve' } },
      },
    ]);
  });

  it('calls note chat, AI create, note edit, and notes git endpoints with encoded IDs', async () => {
    const adapter = createMockAdapter({
      task: { id: 'task-1' },
      taskId: 'task-2',
      initialized: true,
      entries: [],
      files: [],
      enabled: true,
      intervalMs: 600_000,
      hash: 'abcdef',
      message: '[v] checkpoint',
      mtime: 123,
      success: true,
    });
    const client = new NotesClient(adapter);

    await client.createChat('repo/a', {
      prompt: 'Hello',
      notePath: 'Notebook/Page.md',
      noteTitle: 'Page',
      mode: 'autopilot',
      model: 'model-1',
      skills: ['impl'],
      attachments: [{ name: 'note.txt', mimeType: 'text/plain', size: 12, dataUrl: 'data:text/plain;base64,AA==' }],
    });
    await client.sendCommentResolutionMessage('process/1', {
      content: 'Resolve comments',
      mode: 'ask',
      noteContent: '# Note',
      documentUri: 'Notebook/Page.md',
      commentIds: ['thread/1'],
      documentContent: '# Note',
      workspaceId: 'repo/a',
    });
    await client.createWithAI('repo/a', 'Create a note', 'chat-task-1');
    await client.listNoteEdits('process/1');
    await client.undoNoteEdit('process/1', 'edit/1', { force: true });
    await client.initializeGit('repo/a');
    await client.getGitStatus('repo/a');
    await client.getGitLog('repo/a', { limit: 10, offset: 5 });
    await client.getGitDiff('repo/a', 'abc/def');
    await client.commitGit('repo/a', 'checkpoint');
    await client.getAutoCommitStatus('repo/a');
    await client.enableAutoCommit('repo/a');
    await client.disableAutoCommit('repo/a');
    await client.updateAutoCommitInterval('repo/a', 600_000);
    await client.getFileLog('repo/a', 'Notebook/Page.md', 25);
    await client.getFileContentAtRevision('repo/a', 'abcdef', 'Notebook/Page.md');
    await client.saveCheckpoint('repo/a', 'Notebook/Page.md', 'Named checkpoint');
    await client.restoreVersion('repo/a', 'Notebook/Page.md', 'abcdef');

    expect(adapter.calls).toMatchObject([
      {
        path: '/queue',
        options: {
          method: 'POST',
          body: {
            payload: {
              prompt: 'Hello',
              workspaceId: 'repo/a',
              mode: 'autopilot',
              model: 'model-1',
              context: { noteChat: { notePath: 'Notebook/Page.md', noteTitle: 'Page' }, skills: ['impl'] },
            },
          },
        },
      },
      { path: '/processes/process%2F1/message', options: { method: 'POST' } },
      { path: '/workspaces/repo%2Fa/notes/ai-create', options: { method: 'POST', body: { prompt: 'Create a note', chatTaskId: 'chat-task-1' } } },
      { path: '/processes/process%2F1/note-edits' },
      { path: '/processes/process%2F1/note-edits/edit%2F1/undo', options: { method: 'POST', query: { force: true } } },
      { path: '/workspaces/repo%2Fa/notes/git/init', options: { method: 'POST' } },
      { path: '/workspaces/repo%2Fa/notes/git/status' },
      { path: '/workspaces/repo%2Fa/notes/git/log', options: { query: { limit: 10, offset: 5 } } },
      { path: '/workspaces/repo%2Fa/notes/git/diff/abc%2Fdef' },
      { path: '/workspaces/repo%2Fa/notes/git/commit', options: { method: 'POST', body: { message: 'checkpoint' } } },
      { path: '/workspaces/repo%2Fa/notes/git/auto-commit/status' },
      { path: '/workspaces/repo%2Fa/notes/git/auto-commit', options: { method: 'POST', body: { intervalMs: 1_800_000 } } },
      { path: '/workspaces/repo%2Fa/notes/git/auto-commit', options: { method: 'DELETE' } },
      { path: '/workspaces/repo%2Fa/notes/git/auto-commit', options: { method: 'POST', body: { intervalMs: 600_000 } } },
      { path: '/workspaces/repo%2Fa/notes/git/file-log', options: { query: { path: 'Notebook/Page.md', limit: 25 } } },
      { path: '/workspaces/repo%2Fa/notes/git/file-content', options: { query: { hash: 'abcdef', path: 'Notebook/Page.md' } } },
      { path: '/workspaces/repo%2Fa/notes/git/save-checkpoint', options: { method: 'POST', body: { path: 'Notebook/Page.md', name: 'Named checkpoint' } } },
      { path: '/workspaces/repo%2Fa/notes/git/restore-version', options: { method: 'POST', body: { path: 'Notebook/Page.md', hash: 'abcdef' } } },
    ]);
  });

  it('encodes file paths through the HTTP transport query string', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: '# Note', path: 'A B/Page #1.md', mtime: 1 }), {
      headers: { 'content-type': 'application/json' },
    }));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock as typeof fetch });

    await client.notes.getContent('repo/a', 'A B/Page #1.md');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/workspaces/repo%2Fa/notes/content?path=A+B%2FPage+%231.md',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('calls listRoots and getTree with root param', async () => {
    const adapter = createMockAdapter({
      roots: [
        { rootId: 'default', label: 'Notes', isDefault: true },
        { rootId: 'docs/notes', label: 'docs/notes', isDefault: false },
      ],
      maxAdditionalRoots: 10,
      tree: [],
      notesRoot: '/some/path',
    });
    const client = new NotesClient(adapter);

    await client.listRoots('repo/a');
    await client.getTree('repo/a', 'docs/notes');
    await client.getTree('repo/a');

    expect(adapter.calls).toMatchObject([
      { path: '/workspaces/repo%2Fa/notes/roots' },
      { path: '/workspaces/repo%2Fa/notes/tree', options: { query: { root: 'docs/notes' } } },
      { path: '/workspaces/repo%2Fa/notes/tree', options: { query: { root: undefined } } },
    ]);
  });

  it('calls addRoot with POST and body', async () => {
    const adapter = createMockAdapter({ rootId: 'docs/notes', label: 'docs/notes', isDefault: false });
    const client = new NotesClient(adapter);

    await client.addRoot('repo/a', 'docs/notes');

    expect(adapter.calls).toMatchObject([
      { path: '/workspaces/repo%2Fa/notes/roots', options: { method: 'POST', body: { rootPath: 'docs/notes' } } },
    ]);
  });

  it('calls removeRoot with DELETE and body', async () => {
    const adapter = createMockAdapter({ removed: 'docs/notes' });
    const client = new NotesClient(adapter);

    await client.removeRoot('repo/a', 'docs/notes');

    expect(adapter.calls).toMatchObject([
      { path: '/workspaces/repo%2Fa/notes/roots', options: { method: 'DELETE', body: { rootPath: 'docs/notes' } } },
    ]);
  });

  it('passes root param through content, CRUD, search, image, and comment methods', async () => {
    const adapter = createMockAdapter({
      content: '# Note',
      path: 'Page.md',
      updated: true,
      mtime: 123,
      results: [],
      truncated: false,
      version: 1,
      threads: {},
      taskId: 'task-1',
      exists: true,
      type: 'note',
    });
    const client = new NotesClient(adapter);
    const root = 'docs/notes';
    const thread = {
      id: 'thread/1',
      anchor: { quotedText: 'x', prefix: '', suffix: '' },
      status: 'open' as const,
      comments: [],
      createdAt: '2026-01-01T00:00:00Z',
    };

    await client.getContent('repo/a', 'Page.md', root);
    await client.saveContent('repo/a', 'Page.md', '# Updated', 42, root);
    await client.createNode('repo/a', 'New.md', 'page', root);
    await client.renameNode('repo/a', 'Old.md', 'New.md', root);
    await client.deleteNode('repo/a', 'Delete.md', root);
    await client.reorder('repo/a', 'Notebook', ['A.md', 'B.md'], root);
    await client.search('repo/a', 'hello', root);
    await client.uploadImage('repo/a', 'img.png', 'data:image/png;base64,AA==', root);
    await client.getComments('repo/a', 'Page.md', root);
    await client.createThread('repo/a', 'Page.md', thread, root);
    await client.updateThread('repo/a', 'Page.md', 'thread/1', 'resolved', root);
    await client.deleteThread('repo/a', 'Page.md', 'thread/1', root);
    await client.addComment('repo/a', 'Page.md', 'thread/1', 'hi', root);
    await client.editComment('repo/a', 'Page.md', 'thread/1', 'c/2', 'edited', root);
    await client.deleteComment('repo/a', 'Page.md', 'thread/1', 'c/2', root);
    await client.batchResolve('repo/a', 'Page.md', '# Doc', 'ctx', root);

    expect(adapter.calls).toMatchObject([
      { path: '/workspaces/repo%2Fa/notes/content', options: { query: { path: 'Page.md', root } } },
      { path: '/workspaces/repo%2Fa/notes/content', options: { method: 'PUT', body: { path: 'Page.md', content: '# Updated', expectedMtime: 42, root } } },
      { path: '/workspaces/repo%2Fa/notes/page', options: { method: 'POST', body: { path: 'New.md', type: 'page', root } } },
      { path: '/workspaces/repo%2Fa/notes/path', options: { method: 'PATCH', body: { oldPath: 'Old.md', newPath: 'New.md', root } } },
      { path: '/workspaces/repo%2Fa/notes/path', options: { method: 'DELETE', query: { path: 'Delete.md', root } } },
      { path: '/workspaces/repo%2Fa/notes/order', options: { method: 'PUT', body: { parentPath: 'Notebook', order: ['A.md', 'B.md'], root } } },
      { path: '/workspaces/repo%2Fa/notes/search', options: { query: { q: 'hello', root } } },
      { path: '/workspaces/repo%2Fa/notes/image', options: { method: 'POST', body: { fileName: 'img.png', data: 'data:image/png;base64,AA==', root } } },
      { path: '/workspaces/repo%2Fa/notes/comments', options: { query: { path: 'Page.md', root } } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread', options: { method: 'POST', body: { path: 'Page.md', thread, root } } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread/thread%2F1', options: { method: 'PATCH', body: { path: 'Page.md', status: 'resolved', root } } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread/thread%2F1', options: { method: 'DELETE', query: { path: 'Page.md', root } } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread/thread%2F1/comment', options: { method: 'POST', body: { path: 'Page.md', content: 'hi', root } } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread/thread%2F1/comment/c%2F2', options: { method: 'PATCH', body: { path: 'Page.md', content: 'edited', root } } },
      { path: '/workspaces/repo%2Fa/notes/comments/thread/thread%2F1/comment/c%2F2', options: { method: 'DELETE', query: { path: 'Page.md', root } } },
      { path: '/workspaces/repo%2Fa/notes/batch-resolve', options: { method: 'POST', query: { path: 'Page.md', root } } },
    ]);
  });
});

