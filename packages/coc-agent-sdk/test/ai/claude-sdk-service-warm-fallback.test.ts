/**
 * ClaudeSDKService — cold-only fallback (AC-02).
 *
 * Claude's `query()` spawns a fresh process per turn, so it cannot keep a client
 * warm. This verifies the provider transparently ignores `keepWarm`, runs every
 * turn cold (one spawn per send), and never engages any warm-client registry —
 * so there is no warm state to leak.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/sdk-esm-loader', () => ({
    dynamicImportModule: vi.fn(),
}));

import { ClaudeSDKService } from '../../src/claude-sdk-service';
import { dynamicImportModule } from '../../src/sdk-esm-loader';

const mockDynamicImport = vi.mocked(dynamicImportModule);

const SUCCESS = { type: 'result', subtype: 'success', result: 'ok', session_id: 's1' };

function makeHandle(messages: object[]) {
    return {
        [Symbol.asyncIterator]() {
            return (async function* () { for (const message of messages) yield message; })();
        },
        accountInfo: vi.fn(async () => ({})),
        return: vi.fn(async () => ({ done: true as const, value: undefined })),
    };
}

describe('ClaudeSDKService — cold-only warm fallback (AC-02)', () => {
    let svc: ClaudeSDKService;
    const queryFn = vi.fn();

    beforeEach(() => {
        queryFn.mockReset();
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        mockDynamicImport.mockReset();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
        svc = new ClaudeSDKService();
    });

    afterEach(() => {
        svc.dispose();
    });

    it('exposes no warm-client registry', () => {
        expect((svc as unknown as { warmRegistry?: unknown }).warmRegistry).toBeUndefined();
    });

    it('ignores keepWarm and spawns a fresh process per turn (no warm reuse, no leak)', async () => {
        const r1 = await svc.sendMessage({ prompt: 'hello', keepWarm: true });
        const r2 = await svc.sendMessage({ prompt: 'again', keepWarm: true });

        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);
        // One query() spawn per turn — Claude never reuses a warm client.
        expect(queryFn).toHaveBeenCalledTimes(2);
        // Still no warm registry after warm-eligible turns: nothing to leak.
        expect((svc as unknown as { warmRegistry?: unknown }).warmRegistry).toBeUndefined();
    });
});
