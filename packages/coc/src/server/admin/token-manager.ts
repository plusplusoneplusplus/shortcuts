/**
 * Time-limited, one-time-use tokens guarding destructive admin operations.
 * Exposes a `TokenManager` class plus a set of legacy singleton managers and
 * thin helper functions preserved for backward compatibility.
 *
 * Pure Node.js; uses only built-in modules.
 */

import * as crypto from 'crypto';

export const TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export interface TokenData {
    token: string;
    createdAt: number;
}

/** Manages a single time-limited, one-time-use confirmation token. */
export class TokenManager {
    private active: TokenData | null = null;
    private readonly ttlMs: number;

    constructor(ttlMs = TOKEN_EXPIRY_MS) {
        this.ttlMs = ttlMs;
    }

    /** Token TTL in ms (for response headers). */
    get ttl(): number { return this.ttlMs; }

    generate(): TokenData {
        const token = crypto.randomBytes(16).toString('hex');
        this.active = { token, createdAt: Date.now() };
        return this.active;
    }

    /** Validate a token string. Returns true if valid and not expired. Consumes the token. */
    validate(token: string): boolean {
        if (!this.active) { return false; }
        if (this.active.token !== token) { return false; }
        if (Date.now() - this.active.createdAt > this.ttlMs) {
            this.active = null;
            return false;
        }
        // Consume the token (one-time use)
        this.active = null;
        return true;
    }

    /** Reset token state (for tests). */
    reset(): void {
        this.active = null;
    }

    /** Current active token (exposed for testing). */
    get activeToken(): TokenData | null {
        return this.active;
    }
}

// Legacy exported singleton managers, preserved for backward compatibility.
export const wipeTokenManager = new TokenManager();
export const importTokenManager = new TokenManager();
export const migrateTokenManager = new TokenManager();
export const directoryImportTokenManager = new TokenManager();

// Thin wrappers preserving the original exported API
export function generateWipeToken() { return wipeTokenManager.generate(); }
export function validateWipeToken(token: string) { return wipeTokenManager.validate(token); }
export function resetWipeToken() { wipeTokenManager.reset(); }

export function generateImportToken() { return importTokenManager.generate(); }
export function validateImportToken(token: string) { return importTokenManager.validate(token); }
export function resetImportToken() { importTokenManager.reset(); }

export function generateMigrateToken() { return migrateTokenManager.generate(); }
export function validateMigrateToken(token: string) { return migrateTokenManager.validate(token); }
export function resetMigrateToken() { migrateTokenManager.reset(); }

export function resetDirectoryImportToken() { directoryImportTokenManager.reset(); }
