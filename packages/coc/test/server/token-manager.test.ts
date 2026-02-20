import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    TokenManager,
    TOKEN_EXPIRY_MS,
    generateWipeToken,
    validateWipeToken,
    resetWipeToken,
    generateImportToken,
    validateImportToken,
    resetImportToken,
    wipeTokenManager,
    importTokenManager,
} from '../../src/server/admin-handler';

describe('TokenManager', () => {
    let manager: TokenManager;

    beforeEach(() => {
        manager = new TokenManager();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('generate()', () => {
        it('returns a token with a hex string and createdAt timestamp', () => {
            const result = manager.generate();
            expect(result.token).toMatch(/^[0-9a-f]{32}$/);
            expect(result.createdAt).toBeCloseTo(Date.now(), -2);
        });

        it('generates unique tokens on each call', () => {
            const t1 = manager.generate();
            const t2 = manager.generate();
            expect(t1.token).not.toBe(t2.token);
        });

        it('exposes generated token via activeToken getter', () => {
            expect(manager.activeToken).toBeNull();
            const result = manager.generate();
            expect(manager.activeToken).toBe(result);
        });
    });

    describe('validate()', () => {
        it('returns true for a valid, non-expired token', () => {
            const { token } = manager.generate();
            expect(manager.validate(token)).toBe(true);
        });

        it('consumes the token after successful validation (one-time use)', () => {
            const { token } = manager.generate();
            expect(manager.validate(token)).toBe(true);
            expect(manager.validate(token)).toBe(false);
            expect(manager.activeToken).toBeNull();
        });

        it('returns false when no token has been generated', () => {
            expect(manager.validate('anything')).toBe(false);
        });

        it('returns false for a wrong token string', () => {
            manager.generate();
            expect(manager.validate('wrong-token')).toBe(false);
        });

        it('returns false and clears state for an expired token', () => {
            vi.useFakeTimers();
            const { token } = manager.generate();
            vi.advanceTimersByTime(TOKEN_EXPIRY_MS + 1);
            expect(manager.validate(token)).toBe(false);
            expect(manager.activeToken).toBeNull();
        });

        it('returns true at exactly the expiry boundary', () => {
            vi.useFakeTimers();
            const { token } = manager.generate();
            vi.advanceTimersByTime(TOKEN_EXPIRY_MS);
            expect(manager.validate(token)).toBe(true);
        });

        it('latest generate() overrides previous token', () => {
            const first = manager.generate();
            const second = manager.generate();
            expect(manager.validate(first.token)).toBe(false);
            expect(manager.validate(second.token)).toBe(true);
        });
    });

    describe('reset()', () => {
        it('clears the active token', () => {
            manager.generate();
            manager.reset();
            expect(manager.activeToken).toBeNull();
        });

        it('is a no-op when no token exists', () => {
            expect(() => manager.reset()).not.toThrow();
        });
    });
});

describe('Wipe/Import token wrappers', () => {
    beforeEach(() => {
        resetWipeToken();
        resetImportToken();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('generateWipeToken / validateWipeToken work correctly', () => {
        const wt = generateWipeToken();
        expect(wt.token).toMatch(/^[0-9a-f]{32}$/);
        expect(validateWipeToken(wt.token)).toBe(true);
        expect(validateWipeToken(wt.token)).toBe(false); // consumed
    });

    it('generateImportToken / validateImportToken work correctly', () => {
        const it = generateImportToken();
        expect(it.token).toMatch(/^[0-9a-f]{32}$/);
        expect(validateImportToken(it.token)).toBe(true);
        expect(validateImportToken(it.token)).toBe(false); // consumed
    });

    it('resetWipeToken clears the wipe token', () => {
        const wt = generateWipeToken();
        resetWipeToken();
        expect(validateWipeToken(wt.token)).toBe(false);
    });

    it('resetImportToken clears the import token', () => {
        const it = generateImportToken();
        resetImportToken();
        expect(validateImportToken(it.token)).toBe(false);
    });

    it('wipe and import tokens are independent', () => {
        const wt = generateWipeToken();
        const it = generateImportToken();
        expect(validateWipeToken(it.token)).toBe(false);
        expect(validateImportToken(wt.token)).toBe(false);
        // Original tokens still valid
        expect(validateWipeToken(wt.token)).toBe(true);
        expect(validateImportToken(it.token)).toBe(true);
    });

    it('wipeTokenManager and importTokenManager are separate instances', () => {
        expect(wipeTokenManager).not.toBe(importTokenManager);
        expect(wipeTokenManager).toBeInstanceOf(TokenManager);
        expect(importTokenManager).toBeInstanceOf(TokenManager);
    });

    it('expired wipe token is rejected', () => {
        vi.useFakeTimers();
        const wt = generateWipeToken();
        vi.advanceTimersByTime(TOKEN_EXPIRY_MS + 1);
        expect(validateWipeToken(wt.token)).toBe(false);
    });

    it('expired import token is rejected', () => {
        vi.useFakeTimers();
        const it = generateImportToken();
        vi.advanceTimersByTime(TOKEN_EXPIRY_MS + 1);
        expect(validateImportToken(it.token)).toBe(false);
    });
});
