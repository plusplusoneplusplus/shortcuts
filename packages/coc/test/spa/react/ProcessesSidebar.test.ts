/**
 * Tests for filterQueueTask — pure function that applies search, status,
 * and workspace filters to queue tasks in ProcessesSidebar.
 */

import { describe, it, expect } from 'vitest';
import { filterQueueTask } from '../../../src/server/spa/client/react/processes/ProcessesSidebar';

function makeTask(overrides: Record<string, any> = {}): any {
    return {
        id: 'task-1',
        displayName: 'My Task',
        prompt: 'Do something',
        type: 'pipeline',
        status: 'running',
        ...overrides,
    };
}

const DEFAULTS = { searchQuery: '', statusFilter: '__all', workspace: '__all' };

describe('filterQueueTask — status filter', () => {
    it('returns true when statusFilter is __all regardless of task.status', () => {
        expect(filterQueueTask(makeTask({ status: 'running' }), '', '__all', '__all')).toBe(true);
        expect(filterQueueTask(makeTask({ status: 'completed' }), '', '__all', '__all')).toBe(true);
        expect(filterQueueTask(makeTask({ status: 'failed' }), '', '__all', '__all')).toBe(true);
    });

    it('returns true when task.status matches statusFilter exactly', () => {
        expect(filterQueueTask(makeTask({ status: 'running' }), '', 'running', '__all')).toBe(true);
    });

    it('returns false when task.status does not match statusFilter', () => {
        expect(filterQueueTask(makeTask({ status: 'queued' }), '', 'running', '__all')).toBe(false);
    });

    it('returns false for a completed task when statusFilter is running', () => {
        expect(filterQueueTask(makeTask({ status: 'completed' }), '', 'running', '__all')).toBe(false);
    });

    it('returns true for a cancelled task when statusFilter is cancelled', () => {
        expect(filterQueueTask(makeTask({ status: 'cancelled' }), '', 'cancelled', '__all')).toBe(true);
    });
});

describe('filterQueueTask — search filter', () => {
    it('returns true when searchQuery is empty string regardless of task content', () => {
        expect(filterQueueTask(makeTask(), '', '__all', '__all')).toBe(true);
    });

    it('returns true when searchQuery matches task.displayName (substring, case-insensitive)', () => {
        expect(filterQueueTask(makeTask({ displayName: 'Build Frontend' }), 'front', '__all', '__all')).toBe(true);
    });

    it('returns true when searchQuery matches task.prompt (substring, case-insensitive)', () => {
        expect(filterQueueTask(makeTask({ prompt: 'Analyze the codebase' }), 'codebase', '__all', '__all')).toBe(true);
    });

    it('returns true when searchQuery matches task.type (substring, case-insensitive)', () => {
        expect(filterQueueTask(makeTask({ type: 'pipeline' }), 'pipe', '__all', '__all')).toBe(true);
    });

    it('returns true when searchQuery matches task.id (substring, case-insensitive)', () => {
        expect(filterQueueTask(makeTask({ id: 'abc-def-123' }), 'def-123', '__all', '__all')).toBe(true);
    });

    it('returns false when searchQuery does not match any of the four fields', () => {
        expect(filterQueueTask(makeTask(), 'zzz-no-match', '__all', '__all')).toBe(false);
    });

    it('search is case-insensitive: uppercase query matches lowercase field value', () => {
        expect(filterQueueTask(makeTask({ displayName: 'hello world' }), 'HELLO', '__all', '__all')).toBe(true);
    });

    it('returns true when displayName is undefined but prompt matches (graceful fallback)', () => {
        const task = makeTask({ displayName: undefined, prompt: 'Review PR' });
        expect(filterQueueTask(task, 'review', '__all', '__all')).toBe(true);
    });
});

describe('filterQueueTask — workspace filter', () => {
    it('returns true when workspace is __all regardless of task repo fields', () => {
        expect(filterQueueTask(makeTask(), '', '__all', '__all')).toBe(true);
    });

    it('returns true when task.repoId matches workspace', () => {
        expect(filterQueueTask(makeTask({ repoId: 'ws-abc123' }), '', '__all', 'ws-abc123')).toBe(true);
    });

    it('returns true when task.repoId is absent but task.workingDirectory matches workspace', () => {
        const task = makeTask({ repoId: undefined, workingDirectory: 'ws-xyz' });
        expect(filterQueueTask(task, '', '__all', 'ws-xyz')).toBe(true);
    });

    it('returns true when repoId and workingDirectory are absent but payload.workingDirectory matches', () => {
        const task = makeTask({ repoId: undefined, workingDirectory: undefined, payload: { workingDirectory: 'ws-deep' } });
        expect(filterQueueTask(task, '', '__all', 'ws-deep')).toBe(true);
    });

    it('returns false when none of the three repo fields match workspace', () => {
        const task = makeTask({ repoId: 'other-ws', workingDirectory: undefined });
        expect(filterQueueTask(task, '', '__all', 'ws-abc123')).toBe(false);
    });

    it('returns false when task.repoId does not match even if task.workingDirectory would match', () => {
        const task = makeTask({ repoId: 'wrong-ws', workingDirectory: 'ws-target' });
        expect(filterQueueTask(task, '', '__all', 'ws-target')).toBe(false);
    });
});

describe('filterQueueTask — compound filters', () => {
    it('all three filters active: task passes all three — returns true', () => {
        const task = makeTask({ status: 'running', displayName: 'Deploy', repoId: 'ws-1' });
        expect(filterQueueTask(task, 'deploy', 'running', 'ws-1')).toBe(true);
    });

    it('all three filters active: task passes search and status but fails workspace — returns false', () => {
        const task = makeTask({ status: 'running', displayName: 'Deploy', repoId: 'ws-other' });
        expect(filterQueueTask(task, 'deploy', 'running', 'ws-1')).toBe(false);
    });

    it('all three filters active: task passes workspace and status but fails search — returns false', () => {
        const task = makeTask({ status: 'running', displayName: 'Deploy', repoId: 'ws-1' });
        expect(filterQueueTask(task, 'zzz-no-match', 'running', 'ws-1')).toBe(false);
    });

    it('status running filter excludes queued task that otherwise matches search and workspace', () => {
        const task = makeTask({ status: 'queued', displayName: 'Deploy', repoId: 'ws-1' });
        expect(filterQueueTask(task, 'deploy', 'running', 'ws-1')).toBe(false);
    });
});

describe('filterQueueTask — edge cases', () => {
    it('task with all fields undefined returns true when all filters are at defaults', () => {
        const task = { id: undefined, displayName: undefined, prompt: undefined, type: undefined, status: undefined };
        expect(filterQueueTask(task, '', '__all', '__all')).toBe(true);
    });

    it('task with all fields undefined returns false when workspace is a specific ID', () => {
        const task = { id: undefined, displayName: undefined, prompt: undefined, type: undefined, status: undefined };
        expect(filterQueueTask(task, '', '__all', 'ws-specific')).toBe(false);
    });
});

describe('filterQueueTask — typeFilter option', () => {
    it('excludeTypes filters out tasks with matching type', () => {
        const chatTask = makeTask({ type: 'chat' });
        expect(filterQueueTask(chatTask, '', '__all', '__all', { excludeTypes: ['chat'] })).toBe(false);
    });

    it('excludeTypes passes tasks that do not match excluded types', () => {
        const pipelineTask = makeTask({ type: 'pipeline' });
        expect(filterQueueTask(pipelineTask, '', '__all', '__all', { excludeTypes: ['chat'] })).toBe(true);
    });

    it('includeTypes returns only tasks with matching type', () => {
        const chatTask = makeTask({ type: 'chat' });
        expect(filterQueueTask(chatTask, '', '__all', '__all', { includeTypes: ['chat'] })).toBe(true);
    });

    it('includeTypes filters out tasks that do not match included types', () => {
        const pipelineTask = makeTask({ type: 'pipeline' });
        expect(filterQueueTask(pipelineTask, '', '__all', '__all', { includeTypes: ['chat'] })).toBe(false);
    });

    it('typeFilter is applied before other filters', () => {
        const chatTask = makeTask({ type: 'chat', status: 'running', repoId: 'ws-1' });
        expect(filterQueueTask(chatTask, '', 'running', 'ws-1', { excludeTypes: ['chat'] })).toBe(false);
    });

    it('no typeFilter option passes all tasks through (backward compatible)', () => {
        const chatTask = makeTask({ type: 'chat' });
        expect(filterQueueTask(chatTask, '', '__all', '__all')).toBe(true);
    });

    it('undefined typeFilter passes all tasks through', () => {
        const chatTask = makeTask({ type: 'chat' });
        expect(filterQueueTask(chatTask, '', '__all', '__all', undefined)).toBe(true);
    });

    it('excludeTypes with multiple types filters all of them', () => {
        const chatTask = makeTask({ type: 'chat' });
        const customTask = makeTask({ type: 'custom' });
        const pipelineTask = makeTask({ type: 'pipeline' });
        const opts = { excludeTypes: ['chat', 'custom'] };
        expect(filterQueueTask(chatTask, '', '__all', '__all', opts)).toBe(false);
        expect(filterQueueTask(customTask, '', '__all', '__all', opts)).toBe(false);
        expect(filterQueueTask(pipelineTask, '', '__all', '__all', opts)).toBe(true);
    });

    it('includeTypes with multiple types includes all of them', () => {
        const chatTask = makeTask({ type: 'chat' });
        const customTask = makeTask({ type: 'custom' });
        const pipelineTask = makeTask({ type: 'pipeline' });
        const opts = { includeTypes: ['chat', 'custom'] };
        expect(filterQueueTask(chatTask, '', '__all', '__all', opts)).toBe(true);
        expect(filterQueueTask(customTask, '', '__all', '__all', opts)).toBe(true);
        expect(filterQueueTask(pipelineTask, '', '__all', '__all', opts)).toBe(false);
    });
});
