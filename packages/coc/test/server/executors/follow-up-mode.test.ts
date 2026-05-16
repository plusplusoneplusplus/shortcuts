/**
 * Unit tests for resolveFollowUpMode helper.
 *
 * The resolver is the single source of truth for "what mode does this
 * follow-up run in?". Explicit > process.metadata.mode > 'ask'.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveFollowUpMode } from '../../../src/server/executors/follow-up-mode';

function makeStore(metadataMode?: unknown, throws = false) {
    return {
        getProcess: vi.fn(async () => {
            if (throws) throw new Error('store error');
            return {
                id: 'p',
                status: 'completed',
                startTime: new Date(),
                promptPreview: '',
                ...(metadataMode === undefined ? {} : { metadata: { mode: metadataMode } }),
            } as any;
        }),
    } as any;
}

describe('resolveFollowUpMode', () => {
    it('returns the explicit mode when provided', async () => {
        const store = makeStore('autopilot');
        await expect(resolveFollowUpMode(store, 'p', 'plan')).resolves.toBe('plan');
        expect(store.getProcess).not.toHaveBeenCalled();
    });

    it('falls back to process metadata.mode when explicit is undefined', async () => {
        const store = makeStore('plan');
        await expect(resolveFollowUpMode(store, 'p')).resolves.toBe('plan');
    });

    it('returns ask when process is missing', async () => {
        const store = {
            getProcess: vi.fn(async () => undefined),
        } as any;
        await expect(resolveFollowUpMode(store, 'missing')).resolves.toBe('ask');
    });

    it('returns ask when metadata.mode is absent', async () => {
        const store = makeStore(undefined);
        await expect(resolveFollowUpMode(store, 'p')).resolves.toBe('ask');
    });

    it('returns ask when metadata.mode is not a valid ChatMode', async () => {
        const store = makeStore('garbage');
        await expect(resolveFollowUpMode(store, 'p')).resolves.toBe('ask');
    });

    it('rejects an invalid explicit mode and falls through to metadata', async () => {
        const store = makeStore('plan');
        // Caller forced an invalid value (via `any`) — must fall through.
        await expect(resolveFollowUpMode(store, 'p', 'bogus' as any)).resolves.toBe('plan');
    });

    it('returns ask when the store throws', async () => {
        const store = makeStore(undefined, true);
        await expect(resolveFollowUpMode(store, 'p')).resolves.toBe('ask');
    });

    it('accepts all valid ChatMode values from metadata', async () => {
        for (const mode of ['ask', 'plan', 'autopilot', 'ralph'] as const) {
            const store = makeStore(mode);
            await expect(resolveFollowUpMode(store, 'p')).resolves.toBe(mode);
        }
    });
});
