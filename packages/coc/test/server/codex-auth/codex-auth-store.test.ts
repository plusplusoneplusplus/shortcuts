/**
 * Tests for CodexAuthStore — token persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodexAuthStore } from '../../../src/server/codex-auth/codex-auth-store';
import type { CodexAuthTokens } from '../../../src/server/codex-auth/codex-auth-store';

function tmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-auth-test-'));
    return dir;
}

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

describe('CodexAuthStore', () => {
    let dir: string;
    let store: CodexAuthStore;

    beforeEach(() => {
        dir = tmpDir();
        store = new CodexAuthStore(dir);
    });

    afterEach(() => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    describe('readInfo()', () => {
        it('returns unauthenticated when no file exists', () => {
            expect(store.readInfo()).toEqual({ status: 'unauthenticated' });
        });

        it('returns unauthenticated for malformed JSON', () => {
            fs.writeFileSync(path.join(dir, 'codex-auth.json'), 'not-json', 'utf-8');
            expect(store.readInfo()).toEqual({ status: 'unauthenticated' });
        });

        it('returns unauthenticated when accessToken is missing', () => {
            fs.writeFileSync(path.join(dir, 'codex-auth.json'), JSON.stringify({ expiresAt: nowSec() + 9999 }), 'utf-8');
            expect(store.readInfo()).toEqual({ status: 'unauthenticated' });
        });

        it('returns authenticated for a valid non-expired token', () => {
            const tokens: CodexAuthTokens = {
                accessToken: 'tok-123',
                expiresAt: nowSec() + 3600,
                createdAt: nowSec(),
            };
            store.write(tokens);
            const info = store.readInfo();
            expect(info.status).toBe('authenticated');
            expect(info.expiresAt).toBe(tokens.expiresAt);
            expect(info.hasRefreshToken).toBe(false);
        });

        it('returns authenticated and reflects hasRefreshToken=true', () => {
            store.write({
                accessToken: 'tok',
                refreshToken: 'rtok',
                expiresAt: nowSec() + 3600,
                createdAt: nowSec(),
            });
            const info = store.readInfo();
            expect(info.status).toBe('authenticated');
            expect(info.hasRefreshToken).toBe(true);
        });

        it('returns expired for a token within the 60-second skew window', () => {
            store.write({
                accessToken: 'tok',
                expiresAt: nowSec() + 30, // within the 60-second skew
                createdAt: nowSec() - 3570,
            });
            expect(store.readInfo().status).toBe('expired');
        });

        it('returns expired for an already-expired token', () => {
            store.write({
                accessToken: 'tok',
                expiresAt: nowSec() - 100,
                createdAt: nowSec() - 3700,
            });
            expect(store.readInfo().status).toBe('expired');
        });
    });

    describe('readTokens()', () => {
        it('returns null when no file exists', () => {
            expect(store.readTokens()).toBeNull();
        });

        it('returns the stored token record', () => {
            const tokens: CodexAuthTokens = {
                accessToken: 'tok-abc',
                expiresAt: nowSec() + 3600,
                createdAt: nowSec(),
            };
            store.write(tokens);
            expect(store.readTokens()).toMatchObject({ accessToken: 'tok-abc' });
        });
    });

    describe('write() / clear()', () => {
        it('persists tokens that can be read back', () => {
            const tokens: CodexAuthTokens = {
                accessToken: 'abc',
                refreshToken: 'def',
                expiresAt: nowSec() + 7200,
                createdAt: nowSec(),
            };
            store.write(tokens);
            const raw = JSON.parse(fs.readFileSync(path.join(dir, 'codex-auth.json'), 'utf-8')) as CodexAuthTokens;
            expect(raw.accessToken).toBe('abc');
            expect(raw.refreshToken).toBe('def');
        });

        it('clear() removes the file and returns true', () => {
            store.write({ accessToken: 'x', expiresAt: nowSec() + 3600, createdAt: nowSec() });
            expect(store.clear()).toBe(true);
            expect(store.readInfo().status).toBe('unauthenticated');
        });

        it('clear() returns false when no file exists', () => {
            expect(store.clear()).toBe(false);
        });

        it('overwrites existing tokens on write', () => {
            store.write({ accessToken: 'old', expiresAt: nowSec() + 3600, createdAt: nowSec() });
            store.write({ accessToken: 'new', expiresAt: nowSec() + 7200, createdAt: nowSec() });
            expect(store.readTokens()!.accessToken).toBe('new');
        });
    });
});
