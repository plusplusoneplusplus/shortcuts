/**
 * Regression coverage for the default AI request timeouts.
 *
 * The wall-clock default is the hard cap that force-disconnects a session and
 * rejects with `Request timed out after <ms>ms`, so a silent drift here changes
 * how long every long-running turn is allowed to run. These tests pin the value
 * and prove the RequestRunner default parameter actually uses it.
 */

import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_AI_TIMEOUT_MS, DEFAULT_AI_IDLE_TIMEOUT_MS } from '../src/timeout-defaults';
import * as packageIndex from '../src/index';
import { RequestRunner } from '../src/request-runner';
import { SessionManager } from '../src/session-manager';

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

describe('AI timeout defaults', () => {
    it('caps a single request at 8 hours of wall-clock time', () => {
        expect(DEFAULT_AI_TIMEOUT_MS).toBe(EIGHT_HOURS_MS);
        expect(DEFAULT_AI_TIMEOUT_MS).toBe(28_800_000);
    });

    it('keeps the idle timeout at 1 hour, below the wall-clock cap', () => {
        expect(DEFAULT_AI_IDLE_TIMEOUT_MS).toBe(ONE_HOUR_MS);
        expect(DEFAULT_AI_IDLE_TIMEOUT_MS).toBeLessThan(DEFAULT_AI_TIMEOUT_MS);
    });

    it('re-exports both defaults from the package entry point', () => {
        expect(packageIndex.DEFAULT_AI_TIMEOUT_MS).toBe(DEFAULT_AI_TIMEOUT_MS);
        expect(packageIndex.DEFAULT_AI_IDLE_TIMEOUT_MS).toBe(DEFAULT_AI_IDLE_TIMEOUT_MS);
    });
});

describe('RequestRunner default timeouts', () => {
    function makeRunner() {
        const isAvailable = vi.fn().mockResolvedValue({ available: true, sdkPath: '/fake/sdk' });
        const createClient = vi.fn().mockResolvedValue({
            start: vi.fn().mockResolvedValue(undefined),
            createSession: vi.fn(),
            resumeSession: vi.fn(),
            stop: vi.fn().mockResolvedValue(undefined),
        });
        // No timeout arguments: exercises the constructor defaults.
        return new RequestRunner(isAvailable, createClient, new SessionManager());
    }

    it('applies DEFAULT_AI_TIMEOUT_MS when the caller omits timeoutMs', async () => {
        const sendFn = vi.fn().mockResolvedValue({ success: true, response: 'ok' });

        await makeRunner().transform('input', undefined, sendFn);

        expect(sendFn).toHaveBeenCalledWith(
            expect.objectContaining({ timeoutMs: DEFAULT_AI_TIMEOUT_MS }),
        );
    });

    it('still honors an explicit caller timeout over the default', async () => {
        const sendFn = vi.fn().mockResolvedValue({ success: true, response: 'ok' });

        await makeRunner().transform('input', { timeoutMs: 5_000 }, sendFn);

        expect(sendFn).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5_000 }));
    });
});
