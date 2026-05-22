/**
 * Tests for the MCP OAuth token cache reader.
 *
 * Each test stages a tmp `.copilot/mcp-oauth-config/` directory and exercises
 * the four states the panel cares about: not-required (stdio), required (no
 * file), authenticated (valid token), and expired (past expiresAt).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    readMcpServerAuthInfo,
    clearMcpServerAuth,
    getMcpOauthCacheDir,
} from '../../../src/server/mcp-oauth/mcp-oauth-token-cache';

const TEST_SERVER_URL = 'https://mcp.example.com/v1';
const OTHER_SERVER_URL = 'https://mcp.other.com/v1';

function writeTokenPair(
    homeDir: string,
    serverUrl: string,
    tokens: { accessToken?: string; expiresAt?: number; refreshToken?: string; scope?: string },
): string {
    const cacheDir = path.join(homeDir, '.copilot', 'mcp-oauth-config');
    fs.mkdirSync(cacheDir, { recursive: true });
    const hash = `hash-${serverUrl.replace(/[^a-z0-9]/gi, '_')}`;
    fs.writeFileSync(
        path.join(cacheDir, `${hash}.json`),
        JSON.stringify({
            serverUrl,
            authorizationServerUrl: 'https://login.example.com/.well-known/oauth-authorization-server',
            clientId: 'client-abc',
            redirectUri: 'http://127.0.0.1:0/',
            resourceUrl: serverUrl,
            issuedAt: Math.floor(Date.now() / 1000),
            isStatic: false,
        }),
    );
    fs.writeFileSync(path.join(cacheDir, `${hash}.tokens.json`), JSON.stringify(tokens));
    return hash;
}

describe('readMcpServerAuthInfo', () => {
    let tmpHome: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-test-'));
    });

    afterEach(() => {
        try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('returns not-required for stdio servers regardless of URL', () => {
        expect(readMcpServerAuthInfo(undefined, 'stdio', tmpHome).status).toBe('not-required');
        expect(readMcpServerAuthInfo('https://anything', 'stdio', tmpHome).status).toBe('not-required');
    });

    it('returns not-required when serverUrl is missing', () => {
        expect(readMcpServerAuthInfo(undefined, 'http', tmpHome).status).toBe('not-required');
    });

    it('returns required when no cache directory exists', () => {
        // No file written; tmpHome has no .copilot dir
        expect(readMcpServerAuthInfo(TEST_SERVER_URL, 'http', tmpHome).status).toBe('required');
    });

    it('returns required when no metadata matches the server URL', () => {
        writeTokenPair(tmpHome, OTHER_SERVER_URL, {
            accessToken: 'tok',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
        });
        expect(readMcpServerAuthInfo(TEST_SERVER_URL, 'http', tmpHome).status).toBe('required');
    });

    it('returns authenticated when tokens are present and not yet expired', () => {
        const expiresAt = Math.floor(Date.now() / 1000) + 3600;
        writeTokenPair(tmpHome, TEST_SERVER_URL, {
            accessToken: 'tok',
            expiresAt,
            refreshToken: 'ref',
        });
        const result = readMcpServerAuthInfo(TEST_SERVER_URL, 'http', tmpHome);
        expect(result.status).toBe('authenticated');
        expect(result.expiresAt).toBe(expiresAt);
        expect(result.hasRefreshToken).toBe(true);
    });

    it('returns expired when the token is past its expiry', () => {
        const expiresAt = Math.floor(Date.now() / 1000) - 60;
        writeTokenPair(tmpHome, TEST_SERVER_URL, { accessToken: 'tok', expiresAt });
        const result = readMcpServerAuthInfo(TEST_SERVER_URL, 'http', tmpHome);
        expect(result.status).toBe('expired');
        expect(result.expiresAt).toBe(expiresAt);
    });

    it('returns required when metadata exists but the tokens file is missing', () => {
        const cacheDir = path.join(tmpHome, '.copilot', 'mcp-oauth-config');
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            path.join(cacheDir, 'abc.json'),
            JSON.stringify({ serverUrl: TEST_SERVER_URL, clientId: 'cli' }),
        );
        expect(readMcpServerAuthInfo(TEST_SERVER_URL, 'http', tmpHome).status).toBe('required');
    });

    it('returns unknown when the tokens file is unparseable', () => {
        const cacheDir = path.join(tmpHome, '.copilot', 'mcp-oauth-config');
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            path.join(cacheDir, 'abc.json'),
            JSON.stringify({ serverUrl: TEST_SERVER_URL, clientId: 'cli' }),
        );
        fs.writeFileSync(path.join(cacheDir, 'abc.tokens.json'), 'not json');
        expect(readMcpServerAuthInfo(TEST_SERVER_URL, 'http', tmpHome).status).toBe('unknown');
    });

    it('treats SSE servers the same as HTTP', () => {
        const expiresAt = Math.floor(Date.now() / 1000) + 3600;
        writeTokenPair(tmpHome, TEST_SERVER_URL, { accessToken: 'tok', expiresAt });
        expect(readMcpServerAuthInfo(TEST_SERVER_URL, 'sse', tmpHome).status).toBe('authenticated');
    });
});

describe('clearMcpServerAuth', () => {
    let tmpHome: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-test-'));
    });

    afterEach(() => {
        try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('removes both metadata and tokens for a known server URL', () => {
        writeTokenPair(tmpHome, TEST_SERVER_URL, { accessToken: 'tok' });
        expect(clearMcpServerAuth(TEST_SERVER_URL, tmpHome)).toBe(true);
        expect(readMcpServerAuthInfo(TEST_SERVER_URL, 'http', tmpHome).status).toBe('required');
    });

    it('returns false when no metadata matches', () => {
        expect(clearMcpServerAuth(TEST_SERVER_URL, tmpHome)).toBe(false);
    });
});

describe('getMcpOauthCacheDir', () => {
    it('defaults to ~/.copilot/mcp-oauth-config', () => {
        const expected = path.join(os.homedir(), '.copilot', 'mcp-oauth-config');
        expect(getMcpOauthCacheDir()).toBe(expected);
    });

    it('respects an explicit home override', () => {
        expect(getMcpOauthCacheDir('/tmp/x')).toBe(path.join('/tmp/x', '.copilot', 'mcp-oauth-config'));
    });
});
