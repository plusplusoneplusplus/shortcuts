/**
 * Compaction primitives (AC-01) and provider stubs (AC-03).
 *
 * Covers the provider-agnostic `CompactUnsupportedError` class + its
 * cross-bundle-safe `isCompactUnsupportedError` guard, and asserts the Codex
 * stub rejects with the typed error (mirroring its `rewindSession` precedent).
 * Copilot's real implementation and the Claude stub are tested in their own
 * service test files.
 */

import { describe, it, expect } from 'vitest';
import {
    CompactUnsupportedError,
    isCompactUnsupportedError,
    RewindUnsupportedError,
} from '../../src/sdk-service-interface';
import { CodexSDKService } from '../../src/codex-sdk-service';
import { CODEX_PROVIDER } from '../../src/sdk-service-registry';

describe('CompactUnsupportedError (AC-01)', () => {
    it('carries the stable code, provider, name, and a default message', () => {
        const err = new CompactUnsupportedError('codex');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(CompactUnsupportedError);
        expect(err.code).toBe('COMPACT_UNSUPPORTED');
        expect(err.provider).toBe('codex');
        expect(err.name).toBe('CompactUnsupportedError');
        expect(err.message).toContain('codex');
    });

    it('honors a custom message when supplied', () => {
        const err = new CompactUnsupportedError('claude', 'nope');
        expect(err.message).toBe('nope');
        expect(err.provider).toBe('claude');
    });

    it('isCompactUnsupportedError matches by instanceof and by the stable code', () => {
        expect(isCompactUnsupportedError(new CompactUnsupportedError('codex'))).toBe(true);
        // Cross-bundle: a plain object carrying the code still matches.
        expect(isCompactUnsupportedError({ code: 'COMPACT_UNSUPPORTED' })).toBe(true);
    });

    it('isCompactUnsupportedError rejects unrelated errors', () => {
        expect(isCompactUnsupportedError(new Error('other'))).toBe(false);
        expect(isCompactUnsupportedError(new RewindUnsupportedError('codex'))).toBe(false);
        expect(isCompactUnsupportedError(null)).toBe(false);
        expect(isCompactUnsupportedError(undefined)).toBe(false);
        expect(isCompactUnsupportedError({ code: 'SOMETHING_ELSE' })).toBe(false);
    });
});

describe('CodexSDKService.compactSession (AC-03)', () => {
    it('throws the typed CompactUnsupportedError', async () => {
        const svc = new CodexSDKService();
        try {
            await expect(svc.compactSession('any-id')).rejects.toBeInstanceOf(CompactUnsupportedError);
            await expect(svc.compactSession('any-id', 'focus on auth')).rejects.toMatchObject({
                code: 'COMPACT_UNSUPPORTED',
                provider: CODEX_PROVIDER,
            });
            const err = await svc.compactSession('any-id').catch((e) => e);
            expect(isCompactUnsupportedError(err)).toBe(true);
        } finally {
            svc.dispose();
        }
    });
});
