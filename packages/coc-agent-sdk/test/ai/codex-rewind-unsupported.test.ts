/**
 * Codex conversation rewind — permanently unsupported.
 *
 * Neither `@openai/codex-sdk` nor the `codex app-server` JSON-RPC channel exposes
 * a truncate/revert/resume-at primitive, and CoC will not fake one (no rollout-file
 * truncation, no reseeded thread). `rewindSession` must therefore reject with the
 * typed `REWIND_UNSUPPORTED` error that the backend maps to a 409 and the SPA uses
 * to hide the rewind button.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { CodexSDKService } from '../../src/codex-sdk-service';
import { isRewindUnsupportedError, RewindUnsupportedError } from '../../src/sdk-service-interface';
import { CODEX_PROVIDER } from '../../src/sdk-service-registry';

describe('CodexSDKService.rewindSession', () => {
    let svc: CodexSDKService | null = null;

    afterEach(() => {
        svc?.dispose();
        svc = null;
    });

    it('rejects with a typed REWIND_UNSUPPORTED error naming the codex provider', async () => {
        svc = new CodexSDKService();

        const error = await svc.rewindSession('thread-abc123', 'item-1').then(
            () => null,
            (err: unknown) => err,
        );

        expect(error).toBeInstanceOf(RewindUnsupportedError);
        expect(isRewindUnsupportedError(error)).toBe(true);
        expect((error as RewindUnsupportedError).code).toBe('REWIND_UNSUPPORTED');
        expect((error as RewindUnsupportedError).provider).toBe(CODEX_PROVIDER);
    });
});
