/**
 * Unit tests for launchRalphSession — the shared launch path behind
 * `POST /api/ralph-launch` and `send_to_conversation` mode "ralph".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchRalphSession, type RalphLaunchDeps } from '../../../src/server/ralph/ralph-launch-service';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import { RALPH_DEFAULT_MAX_ITERATIONS } from '../../../src/server/preferences-handler';

describe('launchRalphSession', () => {
    let dataDir: string;
    let enqueue: ReturnType<typeof vi.fn>;
    let deps: RalphLaunchDeps;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-launch-service-'));
        enqueue = vi.fn().mockResolvedValue('task-1');
        deps = { bridge: { enqueue } as any, dataDir };
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('enqueues iteration 1 and returns the queue process id and session id', async () => {
        const result = await launchRalphSession({
            goalSpec: '  Build the feature  ',
            workspaceId: 'ws-1',
            aiSelection: { provider: 'claude', config: { model: 'claude-opus-5-5', effortTier: 'high' } },
        }, deps);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.processId).toBe('queue_task-1');
        expect(result.sessionId).toMatch(/^ralph-\d+-[a-z0-9]+$/);
        expect(result).not.toHaveProperty('worktree');

        expect(enqueue).toHaveBeenCalledTimes(1);
        const task = enqueue.mock.calls[0][0];
        expect(task.type).toBe('chat');
        expect(task.repoId).toBe('ws-1');
        expect(task.config).toEqual({ model: 'claude-opus-5-5', effortTier: 'high' });
        expect(task.payload.mode).toBe('ralph');
        expect(task.payload.provider).toBe('claude');
        expect(task.payload.customTitle).toBeUndefined();
        expect(task.payload.context.ralph).toMatchObject({
            phase: 'executing',
            sessionId: result.sessionId,
            originalGoal: 'Build the feature',
            currentIteration: 1,
            maxIterations: RALPH_DEFAULT_MAX_ITERATIONS,
        });
        expect(task.payload.context.spawnedFromProcessId).toBeUndefined();
    });

    it('initialises the per-session journal under the workspace data dir', async () => {
        const result = await launchRalphSession({ goalSpec: 'Goal text', workspaceId: 'ws-1' }, deps);
        if (!result.ok) throw new Error(result.error);

        const record = await new RalphSessionStore({ dataDir }).readSessionRecord('ws-1', result.sessionId);
        expect(record).toMatchObject({
            sessionId: result.sessionId,
            workspaceId: 'ws-1',
            originalGoal: 'Goal text',
            maxIterations: RALPH_DEFAULT_MAX_ITERATIONS,
            phase: 'executing',
        });
    });

    it('applies a title as display name and custom title, and records the spawning chat', async () => {
        await launchRalphSession({
            goalSpec: 'Goal',
            workspaceId: 'ws-1',
            title: 'Ship search',
            spawnedFromProcessId: 'queue_parent',
        }, deps);

        const task = enqueue.mock.calls[0][0];
        expect(task.displayName).toBe('Ship search');
        expect(task.payload.customTitle).toBe('Ship search');
        expect(task.payload.context.spawnedFromProcessId).toBe('queue_parent');
    });

    it.each([undefined, '', '   ', 42])('rejects goalSpec %j without enqueueing', async (goalSpec) => {
        const result = await launchRalphSession({ goalSpec, workspaceId: 'ws-1' }, deps);
        expect(result).toEqual({ ok: false, error: 'Missing or empty field: goalSpec' });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('rejects an invalid AI selection without enqueueing', async () => {
        const result = await launchRalphSession({
            goalSpec: 'Goal',
            workspaceId: 'ws-1',
            aiSelection: { provider: 'nope' },
        }, deps);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/^Invalid provider: 'nope'/);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('rejects an invalid worktree request without enqueueing', async () => {
        const result = await launchRalphSession({ goalSpec: 'Goal', workspaceId: 'ws-1', worktree: 'yes' }, deps);
        expect(result.ok).toBe(false);
        expect(enqueue).not.toHaveBeenCalled();
    });
});
