import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchClaudeOAuthQuota } from '../../src/claude-sdk-service';

// Exercise the real built addon with synthetic files. The explicit override is
// exclusive, and expired test credentials have no refresh secret, so neither
// user credentials nor the real token endpoint can be accessed.
describe('Claude quota with built native auth', () => {
    let homeDir: string;
    let credentialsFile: string;
    const fetchSpy = vi.fn();
    beforeEach(() => {
        homeDir = mkdtempSync(path.join(tmpdir(), 'claude-quota-native-'));
        credentialsFile = path.join(homeDir, 'fixture.json');
        vi.stubEnv('CLAUDE_CREDENTIALS_FILE', credentialsFile);
        fetchSpy.mockReset().mockResolvedValue({
            ok: true, status: 200,
            json: async () => ({ five_hour: { utilization: 36 }, seven_day: { utilization: 12 } }),
        });
        vi.stubGlobal('fetch', fetchSpy);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        rmSync(homeDir, { recursive: true, force: true });
    });

    it('uses native credentials, creates a private shared lock directory, and rereads every poll', async () => {
        writeFileSync(credentialsFile, JSON.stringify({
            claudeAiOauth: { accessToken: 'native-fixture', expiresAt: Date.now() + 3_600_000 },
        }));
        const original = readFileSync(credentialsFile, 'utf8');
        const quota = await fetchClaudeOAuthQuota({ homeDir });
        expect(quota.quotaSnapshots.five_hour.usedRequests).toBe(36);
        expect(quota.quotaSnapshots.seven_day.usedRequests).toBe(12);
        expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer native-fixture');
        expect(readFileSync(credentialsFile, 'utf8')).toBe(original);
        expect(existsSync(path.join(homeDir, '.claude'))).toBe(false);
        if (process.platform !== 'win32') {
            expect(statSync(path.join(homeDir, '.coc', 'auth', 'claude', 'locks')).mode & 0o777).toBe(0o700);
        }
        writeFileSync(credentialsFile, '{"access_token":"next-fixture"}');
        await fetchClaudeOAuthQuota({ homeDir });
        expect(fetchSpy.mock.calls[1][1].headers.Authorization).toBe('Bearer next-fixture');
    });

    it('preserves the flat fallback when a nested access token is empty', async () => {
        writeFileSync(credentialsFile, '{"claudeAiOauth":{"accessToken":""},"access_token":"flat-fixture"}');
        const quota = await fetchClaudeOAuthQuota({ homeDir });
        expect(quota.quotaSnapshots.five_hour.usedRequests).toBe(36);
        expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer flat-fixture');
    });

    it('returns no quota for expired credentials without refresh secrets, without making a usage call', async () => {
        writeFileSync(credentialsFile, '{"claudeAiOauth":{"accessToken":"expired-fixture","expiresAt":1}}');
        expect(await fetchClaudeOAuthQuota({ homeDir })).toEqual({ quotaSnapshots: {} });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does not fall back to the default file when the explicit override is missing', async () => {
        mkdirSync(path.join(homeDir, '.claude'));
        writeFileSync(path.join(homeDir, '.claude', '.credentials.json'), '{"access_token":"wrong-source"}');
        expect(await fetchClaudeOAuthQuota({ homeDir })).toEqual({ quotaSnapshots: {} });
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
