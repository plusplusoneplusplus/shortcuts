/**
 * CodexAuthStore — persists ChatGPT OAuth tokens to <dataDir>/codex-auth.json.
 *
 * Token format mirrors the ChatGPT OAuth response:
 *   { accessToken, refreshToken?, expiresAt (unix seconds), createdAt (unix seconds) }
 */

import * as fs from 'fs';
import * as path from 'path';

export type CodexAuthStatus = 'authenticated' | 'expired' | 'unauthenticated';

export interface CodexAuthTokens {
    accessToken: string;
    refreshToken?: string;
    /** Unix seconds at which the access token expires. */
    expiresAt: number;
    /** Unix seconds when the tokens were stored. */
    createdAt: number;
}

export interface CodexAuthInfo {
    status: CodexAuthStatus;
    expiresAt?: number;
    hasRefreshToken?: boolean;
}

const AUTH_FILE_NAME = 'codex-auth.json';

/** 60-second skew buffer: report near-expiry tokens as expired rather than authenticated. */
const EXPIRY_SKEW_SEC = 60;

export class CodexAuthStore {
    private readonly filePath: string;

    constructor(dataDir: string) {
        this.filePath = path.join(dataDir, AUTH_FILE_NAME);
    }

    /** Read and validate stored auth tokens. Returns `unauthenticated` when no file exists. */
    readInfo(): CodexAuthInfo {
        let tokens: CodexAuthTokens;
        try {
            const raw = fs.readFileSync(this.filePath, 'utf-8');
            tokens = JSON.parse(raw) as CodexAuthTokens;
        } catch {
            return { status: 'unauthenticated' };
        }

        if (!tokens?.accessToken) {
            return { status: 'unauthenticated' };
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const hasRefreshToken = typeof tokens.refreshToken === 'string' && tokens.refreshToken.length > 0;

        if (tokens.expiresAt <= nowSec + EXPIRY_SKEW_SEC) {
            return { status: 'expired', expiresAt: tokens.expiresAt, hasRefreshToken };
        }

        return { status: 'authenticated', expiresAt: tokens.expiresAt, hasRefreshToken };
    }

    /** Read the raw token record. Returns null when no file exists or the file is malformed. */
    readTokens(): CodexAuthTokens | null {
        try {
            const raw = fs.readFileSync(this.filePath, 'utf-8');
            const parsed = JSON.parse(raw) as CodexAuthTokens;
            return parsed?.accessToken ? parsed : null;
        } catch {
            return null;
        }
    }

    /** Persist new tokens, overwriting any previous entry. */
    write(tokens: CodexAuthTokens): void {
        fs.writeFileSync(this.filePath, JSON.stringify(tokens, null, 2), 'utf-8');
    }

    /** Remove stored tokens. Returns true when a file was actually removed. */
    clear(): boolean {
        try {
            fs.unlinkSync(this.filePath);
            return true;
        } catch {
            return false;
        }
    }
}
