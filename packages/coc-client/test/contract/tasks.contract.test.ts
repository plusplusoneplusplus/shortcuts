import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { startContractHarness, type ContractHarness } from './server-harness';

describe('tasks contract', () => {
  let harness: ContractHarness | undefined;
  let workspaceRoot: string | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
    if (workspaceRoot) fs.rmSync(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = undefined;
  });

  it('creates, reads, updates, comments on, and deletes a task file', async () => {
    harness = await startContractHarness();
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-client-tasks-workspace-'));
    const workspaceId = 'tasks-ws';

    await harness.server.store.registerWorkspace({
      id: workspaceId,
      name: 'Tasks workspace',
      rootPath: workspaceRoot,
    });

    const createdFolder = await harness.client.tasks.create(workspaceId, {
      type: 'folder',
      name: 'feature',
      parent: '',
    });
    expect(createdFolder).toMatchObject({ name: 'feature', type: 'folder' });

    const createdTask = await harness.client.tasks.create(workspaceId, {
      name: 'first-task',
      folder: 'feature',
      docType: 'plan',
    });
    expect(createdTask.path.replace(/\\/g, '/')).toBe('feature/first-task.plan.md');

    await expect(harness.client.tasks.getContent(workspaceId, 'feature/first-task.plan.md'))
      .resolves.toMatchObject({ content: expect.stringContaining('status: pending') });

    await harness.client.tasks.writeContent(workspaceId, {
      path: 'feature/first-task.plan.md',
      content: '---\nstatus: pending\n---\n\n# Updated\n',
    });
    await harness.client.tasks.updateStatus(workspaceId, 'feature/first-task.plan.md', 'done');
    await expect(harness.client.tasks.getContent(workspaceId, 'feature/first-task.plan.md'))
      .resolves.toMatchObject({ content: expect.stringContaining('status: done') });

    const tree = await harness.client.tasks.getTree(workspaceId, { showArchived: true });
    expect(tree?.children.some(child => child.name === 'feature')).toBe(true);

    const comment = await harness.client.tasks.createComment(workspaceId, 'feature/first-task.plan.md', {
      filePath: 'feature/first-task.plan.md',
      selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
      selectedText: 'status',
      comment: 'Review this status.',
    });
    expect(comment).toMatchObject({ status: 'open', comment: 'Review this status.' });
    await expect(harness.client.tasks.getCommentCounts(workspaceId))
      .resolves.toMatchObject({ 'feature/first-task.plan.md': 1 });

    await harness.client.tasks.updateComment(workspaceId, 'feature/first-task.plan.md', comment.id, { status: 'resolved' });
    await expect(harness.client.tasks.listComments(workspaceId, 'feature/first-task.plan.md'))
      .resolves.toEqual([expect.objectContaining({ id: comment.id, status: 'resolved' })]);

    await expect(harness.client.tasks.deleteComment(workspaceId, 'feature/first-task.plan.md', comment.id)).resolves.toBeUndefined();
    await expect(harness.client.tasks.delete(workspaceId, { path: 'feature/first-task.plan.md' })).resolves.toBeUndefined();
  });
});
