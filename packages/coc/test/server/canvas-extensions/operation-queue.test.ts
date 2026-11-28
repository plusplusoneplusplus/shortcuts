import { describe, it, expect, vi } from 'vitest';
import { queueCanvasExtensionOperation, getQueuedCanvasCount } from '../../../src/server/canvas-extensions/operation-queue';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('queueCanvasExtensionOperation', () => {
    it('runs tasks for one canvas strictly one at a time', async () => {
        const events: string[] = [];
        const task = (name: string) => async () => {
            events.push(`start:${name}`);
            await delay(20);
            events.push(`end:${name}`);
            return name;
        };

        const results = await Promise.all([
            queueCanvasExtensionOperation('ws', 'c1', task('a')),
            queueCanvasExtensionOperation('ws', 'c1', task('b')),
            queueCanvasExtensionOperation('ws', 'c1', task('c')),
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
            queueCanvasExtensionOperation('ws', 'one', task),
            queueCanvasExtensionOperation('ws', 'two', task),
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
            queueCanvasExtensionOperation('ws-a', 'same-id', task),
            queueCanvasExtensionOperation('ws-b', 'same-id', task),
        ]);
        expect(peak).toBe(2);
    });

    it('does not let a failing task wedge the canvas', async () => {
        const failing = queueCanvasExtensionOperation('ws', 'c2', async () => {
            throw new Error('boom');
        });
        await expect(failing).rejects.toThrow('boom');

        const after = vi.fn(async () => 'ok');
        await expect(queueCanvasExtensionOperation('ws', 'c2', after)).resolves.toBe('ok');
        expect(after).toHaveBeenCalledTimes(1);
    });

    it('propagates a rejection to the caller that queued it, not the next one', async () => {
        const outcomes = await Promise.allSettled([
            queueCanvasExtensionOperation('ws', 'c3', async () => { throw new Error('first'); }),
            queueCanvasExtensionOperation('ws', 'c3', async () => 'second'),
        ]);
        expect(outcomes[0].status).toBe('rejected');
        expect(outcomes[1]).toEqual({ status: 'fulfilled', value: 'second' });
    });

    it('drops a canvas from the map once its chain drains', async () => {
        const before = getQueuedCanvasCount();
        await queueCanvasExtensionOperation('ws', 'transient', async () => 'done');
        // The cleanup runs a microtask behind the task's own resolution.
        await delay(0);
        expect(getQueuedCanvasCount()).toBe(before);
    });
});
