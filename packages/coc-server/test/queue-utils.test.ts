/**
 * Tests for shared/queue-utils — truncateDisplayName and applyFollowUpToTask.
 */

import { describe, it, expect } from 'vitest';
import { TaskQueueManager } from '@plusplusoneplusplus/pipeline-core';
import { truncateDisplayName, applyFollowUpToTask } from '../src/shared/queue-utils';

// ============================================================================
// truncateDisplayName
// ============================================================================

describe('truncateDisplayName', () => {
    it('returns short text unchanged', () => {
        expect(truncateDisplayName('hello')).toBe('hello');
    });

    it('returns text at exactly max length unchanged', () => {
        const text = 'a'.repeat(60);
        expect(truncateDisplayName(text)).toBe(text);
    });

    it('truncates text longer than max with ellipsis', () => {
        const text = 'a'.repeat(61);
        expect(truncateDisplayName(text)).toBe('a'.repeat(57) + '...');
    });

    it('respects custom max parameter', () => {
        const text = 'hello world this is a test';
        expect(truncateDisplayName(text, 10)).toBe('hello w...');
    });

    it('handles empty string', () => {
        expect(truncateDisplayName('')).toBe('');
    });
});

// ============================================================================
// applyFollowUpToTask
// ============================================================================

describe('applyFollowUpToTask', () => {
    function makeManager(): TaskQueueManager {
        return new TaskQueueManager({ keepHistory: true });
    }

    function seedToHistory(qm: TaskQueueManager): string {
        const taskId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        qm.restoreHistory([{
            id: taskId,
            type: 'chat',
            status: 'completed',
            priority: 'normal',
            payload: { prompt: 'original' },
            createdAt: Date.now() - 1000,
            completedAt: Date.now(),
        }]);
        return taskId;
    }

    it('updates display name and prompt, then requeues', () => {
        const qm = makeManager();
        const id = seedToHistory(qm);
        expect(qm.getHistory()).toHaveLength(1);

        applyFollowUpToTask(qm, id, 'follow up prompt');

        expect(qm.getQueued()).toHaveLength(1);
        const t = qm.getTask(id)!;
        expect(t.displayName).toBe('follow up prompt');
        expect((t.payload as any).prompt).toBe('follow up prompt');
    });

    it('truncates long prompts for display name', () => {
        const qm = makeManager();
        const id = seedToHistory(qm);
        const longPrompt = 'x'.repeat(80);
        applyFollowUpToTask(qm, id, longPrompt);
        const t = qm.getTask(id)!;
        expect(t.displayName).toBe('x'.repeat(57) + '...');
    });

    it('includes mode and deliveryMode in payload when provided', () => {
        const qm = makeManager();
        const id = seedToHistory(qm);
        applyFollowUpToTask(qm, id, 'prompt', undefined, undefined, 'ask', 'streaming');
        const t = qm.getTask(id)!;
        expect((t.payload as any).mode).toBe('ask');
        expect((t.payload as any).deliveryMode).toBe('streaming');
    });

    it('throws if task is not in history', () => {
        const qm = makeManager();
        const id = qm.enqueue({ type: 'chat', payload: {} });
        // task is queued, not in history
        expect(() => applyFollowUpToTask(qm, id, 'prompt')).toThrow('not available in history');
    });
});
