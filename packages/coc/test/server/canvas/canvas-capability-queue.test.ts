import { describe, it, expect, vi } from 'vitest';
import { queueCanvasCapabilityRun, getQueuedCanvasCount } from '../../../src/server/canvas/canvas-capability-queue';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('queueCanvasCapabilityRun', () => {
    it('runs tasks for one canvas strictly one at a time', async () => {
        const events: string[] = [];
        const task = (name: string) => async () => {
            events.push(`start:${name}`);
            await delay(20);
            events.push(`end:${name}`);
            return name;
        };

        const results = await Promise.all([
            queueCanvasCapabilityRun('ws', 'c1', task('a')),
            queueCanvasCapabilityRun('ws', 'c1', task('b')),
            queueCanvasCapabilityRun('ws', 'c1', task('c')),
        ]);

        expect(results).toEqual(['a', 'b', 'c']);
        expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
    });

    it('lets different canvases run in parallel', async () => {
        let running = 0;
        let peak = 0;
        const task = async () => {
            running++;
            peak = Math.max(peak, running);
            await delay(20);
            running--;
        };

        await Promise.all([
            queueCanvasCapabilityRun('ws', 'one', task),
            queueCanvasCapabilityRun('ws', 'two', task),
        ]);
        expect(peak).toBe(2);
    });

    it('keys on workspace as well as canvas id', async () => {
        let running = 0;
        let peak = 0;
        const task = async () => {
            running++;
            peak = Math.max(peak, running);
            await delay(20);
            running--;
        };
        await Promise.all([
            queueCanvasCapabilityRun('ws-a', 'same-id', task),
            queueCanvasCapabilityRun('ws-b', 'same-id', task),
        ]);
        expect(peak).toBe(2);
    });

    it('does not let a failing task wedge the canvas', async () => {
        const failing = queueCanvasCapabilityRun('ws', 'c2', async () => {
            throw new Error('boom');
        });
        await expect(failing).rejects.toThrow('boom');

        const after = vi.fn(async () => 'ok');
        await expect(queueCanvasCapabilityRun('ws', 'c2', after)).resolves.toBe('ok');
        expect(after).toHaveBeenCalledTimes(1);
    });

    it('propagates a rejection to the caller that queued it, not the next one', async () => {
        const outcomes = await Promise.allSettled([
            queueCanvasCapabilityRun('ws', 'c3', async () => { throw new Error('first'); }),
            queueCanvasCapabilityRun('ws', 'c3', async () => 'second'),
        ]);
        expect(outcomes[0].status).toBe('rejected');
        expect(outcomes[1]).toEqual({ status: 'fulfilled', value: 'second' });
    });

    it('drops a canvas from the map once its chain drains', async () => {
        const before = getQueuedCanvasCount();
        await queueCanvasCapabilityRun('ws', 'transient', async () => 'done');
        // The cleanup runs a microtask behind the task's own resolution.
        await delay(0);
        expect(getQueuedCanvasCount()).toBe(before);
    });
});
