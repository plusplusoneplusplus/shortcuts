import { describe, expect, it, vi } from 'vitest';
import { TaskQueueManager } from '../../src/queue/task-queue-manager';
import type { BotControlMetadata } from '../../src/ai/process-interfaces';

const control: BotControlMetadata = {
    state: 'active', source: 'teams', controllerKey: 'teams-bridge', controllerLabel: 'Teams bridge',
};

function fixture() {
    const queue = new TaskQueueManager();
    queue.enqueue({
        id: 'origin', type: 'chat', priority: 'normal', repoId: 'ws-a',
        processId: 'queue_origin', botControl: control, payload: {}, config: {},
    });
    return queue;
}

describe('trusted queue control compare-and-set', () => {
    it.each(['queued', 'running', 'completed'] as const)('releases and restores %s control without altering execution', status => {
        const queue = fixture();
        if (status !== 'queued') queue.markStarted('origin');
        if (status === 'completed') queue.markCompleted('origin', { success: true });
        const prior = { ...queue.getTask('origin') };
        const updated = vi.fn();
        queue.on('taskUpdated', updated);
        queue.replaceBotControl('origin', control, undefined);
        expect(queue.getTask('origin')).not.toHaveProperty('botControl');
        expect(queue.getTask('origin')).toEqual({ ...prior, botControl: undefined });
        expect(updated).toHaveBeenCalledOnce();
        queue.replaceBotControl('origin', undefined, control);
        expect(queue.getTask('origin')).toEqual(prior);
    });

    it('rejects stale authority or missing tasks, and does not emit redundant writes', () => {
        const queue = fixture();
        const updated = vi.fn();
        queue.on('change', updated);
        expect(() => queue.replaceBotControl('origin', { ...control }, undefined)).toThrow('authority changed');
        expect(() => queue.replaceBotControl('missing', control, undefined)).toThrow('unavailable');
        queue.replaceBotControl('origin', control, control);
        expect(updated).not.toHaveBeenCalled();
        expect(queue.getTask('origin')?.botControl).toBe(control);
    });

    it('restores memory and compensates persistence when a change observer rejects', () => {
        const queue = fixture();
        const persist = vi.fn().mockImplementationOnce(() => { throw new Error('write rejected'); });
        const updated = vi.fn();
        queue.on('change', persist);
        queue.on('taskUpdated', updated);
        expect(() => queue.replaceBotControl('origin', control, undefined)).toThrow('write rejected');
        expect(queue.getTask('origin')?.botControl).toBe(control);
        expect(persist).toHaveBeenCalledTimes(2);
        expect(updated).not.toHaveBeenCalled();
        queue.replaceBotControl('origin', control, undefined);
        expect(updated).toHaveBeenCalledOnce();
    });

    it('compensates a post-persistence notification failure', () => {
        const queue = fixture();
        const durable: Array<BotControlMetadata | undefined> = [];
        queue.on('change', () => { durable.push(queue.getTask('origin')?.botControl); });
        queue.once('taskUpdated', () => { throw new Error('notification rejected'); });
        expect(() => queue.replaceBotControl('origin', control, undefined)).toThrow('notification rejected');
        expect(durable).toEqual([undefined, control]);
        expect(queue.getTask('origin')?.botControl).toBe(control);
    });

    it('reports both write and compensation failures without claiming success', () => {
        const queue = fixture();
        queue.on('change', () => { throw new Error('disk unavailable'); });
        expect(() => queue.replaceBotControl('origin', control, undefined)).toThrow('could not be rolled back');
        expect(queue.getTask('origin')?.botControl).toBe(control);
    });
});
