/**
 * Per-canvas write lock.
 *
 * The properties that matter are the ones a stuck or dead writer exercises:
 * the lock is always released, a lock nobody owns any more is taken over, and
 * waiting is bounded so a canvas can never be locked out forever.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CanvasWriteQueue, LOCK_WAIT_TIMEOUT_MS, STALE_LOCK_AGE_MS } from '../../../src/server/canvas/canvas-write-queue';

const WS = 'test-workspace';
const CANVAS = 'plan-abc123';

describe('CanvasWriteQueue', () => {
    let root: string;
    let locksDir: string;
    let queue: CanvasWriteQueue;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-lock-'));
        locksDir = path.join(root, '.locks');
        queue = new CanvasWriteQueue(() => locksDir);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const lockPath = (): string => path.join(locksDir, `${CANVAS}.lock`);

    it('holds the lock for the duration of the critical section and releases it after', () => {
        expect(fs.existsSync(lockPath())).toBe(false);

        const seen = queue.runExclusive(WS, CANVAS, () => {
            expect(fs.existsSync(lockPath())).toBe(true);
            expect(queue.isHeld(WS, CANVAS)).toBe(true);
            return 'done';
        });

        expect(seen).toBe('done');
        expect(fs.existsSync(lockPath())).toBe(false);
        expect(queue.isHeld(WS, CANVAS)).toBe(false);
    });

    it('releases the lock when the critical section throws', () => {
        expect(() => queue.runExclusive(WS, CANVAS, () => {
            throw new Error('write failed');
        })).toThrow('write failed');

        expect(fs.existsSync(lockPath())).toBe(false);
        expect(queue.isHeld(WS, CANVAS)).toBe(false);
    });

    it('runs a nested section on the same canvas inline instead of self-deadlocking', () => {
        const order: string[] = [];
        const result = queue.runExclusive(WS, CANVAS, () => {
            order.push('outer');
            return queue.runExclusive(WS, CANVAS, () => {
                order.push('inner');
                expect(fs.existsSync(lockPath())).toBe(true);
                return 42;
            });
        });

        expect(result).toBe(42);
        expect(order).toEqual(['outer', 'inner']);
        expect(fs.existsSync(lockPath())).toBe(false);
    });

    it('locks each canvas independently', () => {
        queue.runExclusive(WS, CANVAS, () => {
            expect(fs.existsSync(lockPath())).toBe(true);
            queue.runExclusive(WS, 'other-canvas', () => {
                expect(fs.existsSync(path.join(locksDir, 'other-canvas.lock'))).toBe(true);
            });
            expect(fs.existsSync(path.join(locksDir, 'other-canvas.lock'))).toBe(false);
        });
    });

    it('takes over a lock left behind by a process that died holding it', () => {
        fs.mkdirSync(locksDir, { recursive: true });
        fs.mkdirSync(lockPath());
        const abandoned = Date.now() - STALE_LOCK_AGE_MS - 1000;
        fs.utimesSync(lockPath(), abandoned / 1000, abandoned / 1000);

        const started = Date.now();
        const ran = queue.runExclusive(WS, CANVAS, () => true);

        expect(ran).toBe(true);
        // Reclaimed immediately, not after waiting out the timeout.
        expect(Date.now() - started).toBeLessThan(LOCK_WAIT_TIMEOUT_MS);
        expect(fs.existsSync(lockPath())).toBe(false);
    });

    it('proceeds rather than hanging when another holder never releases', () => {
        fs.mkdirSync(locksDir, { recursive: true });
        fs.mkdirSync(lockPath());

        const started = Date.now();
        const ran = queue.runExclusive(WS, CANVAS, () => 'proceeded anyway');
        const elapsed = Date.now() - started;

        expect(ran).toBe('proceeded anyway');
        expect(elapsed).toBeGreaterThanOrEqual(LOCK_WAIT_TIMEOUT_MS - 50);
        // The lock it never owned is left for its real owner.
        expect(fs.existsSync(lockPath())).toBe(true);
    }, 15_000);

    it('does not throw when the locks directory cannot be created', () => {
        const blocked = new CanvasWriteQueue(() => {
            // A file where the directory should be — mkdir fails with EEXIST/ENOTDIR.
            const filePath = path.join(root, 'not-a-dir');
            fs.writeFileSync(filePath, 'x');
            return path.join(filePath, 'locks');
        });

        expect(blocked.runExclusive(WS, CANVAS, () => 'ran')).toBe('ran');
    });
});
