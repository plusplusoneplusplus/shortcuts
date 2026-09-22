/**
 * Unit tests for resolveFollowUpMode helper.
 *
 * The resolver is the single source of truth for "what mode does this
 * follow-up run in?". Explicit > process.metadata.mode > 'ask', except that a
 * terminal persisted mode (sentinel) beats an explicit mode.
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
        await expect(resolveFollowUpMode(store, 'p', 'autopilot')).resolves.toBe('autopilot');
    });

    it('normalizes explicit legacy plan mode to ask', async () => {
        const store = makeStore('autopilot');
        await expect(resolveFollowUpMode(store, 'p', 'plan')).resolves.toBe('ask');
    });

    it('returns the explicit mode when the store throws', async () => {
        const store = makeStore(undefined, true);
        await expect(resolveFollowUpMode(store, 'p', 'autopilot')).resolves.toBe('autopilot');
    });

    it('normalizes legacy process metadata.mode plan to ask', async () => {
        const store = makeStore('plan');
        await expect(resolveFollowUpMode(store, 'p')).resolves.toBe('ask');
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
        const store = makeStore('autopilot');
        // Caller forced an invalid value (via `any`) — must fall through.
        await expect(resolveFollowUpMode(store, 'p', 'bogus' as any)).resolves.toBe('autopilot');
    });

    it('returns ask when the store throws', async () => {
        const store = makeStore(undefined, true);
        await expect(resolveFollowUpMode(store, 'p')).resolves.toBe('ask');
    });

    // Regression: a plain follow-up used to demote a sentinel chat to 'ask',
    // which silently unhooks it from cron routing and workspace ownership.
    it('ignores an explicit mode when the persisted mode is sentinel', async () => {
        for (const explicit of ['ask', 'autopilot', 'plan', 'ralph'] as const) {
            const store = makeStore('sentinel');
            await expect(resolveFollowUpMode(store, 'p', explicit)).resolves.toBe('sentinel');
        }
    });

    it('keeps sentinel when no explicit mode is supplied', async () => {
        const store = makeStore('sentinel');
        await expect(resolveFollowUpMode(store, 'p')).resolves.toBe('sentinel');
    });

    it('does not treat non-terminal modes as sticky', async () => {
        for (const persisted of ['ask', 'autopilot', 'ralph'] as const) {
            const store = makeStore(persisted);
            await expect(resolveFollowUpMode(store, 'p', 'autopilot')).resolves.toBe('autopilot');
        }
    });

    it('accepts all valid ChatMode values from metadata', async () => {
        for (const mode of ['ask', 'autopilot', 'ralph', 'sentinel'] as const) {
            const store = makeStore(mode);
            await expect(resolveFollowUpMode(store, 'p')).resolves.toBe(mode);
        }
    });
});
