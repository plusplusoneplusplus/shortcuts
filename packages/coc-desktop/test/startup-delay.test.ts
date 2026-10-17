import { describe, it, expect, vi } from 'vitest';
import { applyServerStartDelay, readServerStartDelayMs, SERVER_START_DELAY_ENV } from '../src/startup-delay';

describe('readServerStartDelayMs', () => {
    it('is 0 when unset, so normal startup is unchanged', () => {
        expect(readServerStartDelayMs({})).toBe(0);
    });

    it('accepts a positive integer up to 10 minutes', () => {
        expect(readServerStartDelayMs({ [SERVER_START_DELAY_ENV]: '45000' })).toBe(45_000);
        expect(readServerStartDelayMs({ [SERVER_START_DELAY_ENV]: ' 600000 ' })).toBe(600_000);
    });

    it.each(['', '0', '-5', '1.5', '1e4', 'abc', '600001'])('ignores %j', (raw) => {
        expect(readServerStartDelayMs({ [SERVER_START_DELAY_ENV]: raw })).toBe(0);
    });
});

describe('applyServerStartDelay', () => {
    it('neither logs nor sleeps without the opt-in', async () => {
        const log = vi.fn();
        const sleep = vi.fn(async () => {});
        await expect(applyServerStartDelay({}, log, sleep)).resolves.toBe(0);
        expect(log).not.toHaveBeenCalled();
        expect(sleep).not.toHaveBeenCalled();
    });

    it('announces the delay (with the pid the smoke test tracks) before sleeping', async () => {
        const order: string[] = [];
        const log = vi.fn((line: string) => { order.push(line); });
        const sleep = vi.fn(async (ms: number) => { order.push(`sleep ${ms}`); });
        await expect(applyServerStartDelay({ [SERVER_START_DELAY_ENV]: '45000' }, log, sleep)).resolves.toBe(45_000);
        expect(order).toEqual([
            `[coc-desktop] server-entry pid=${process.pid} delaying startup 45000ms (${SERVER_START_DELAY_ENV})`,
            'sleep 45000',
        ]);
    });
});
