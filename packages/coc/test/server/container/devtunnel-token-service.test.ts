import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevTunnelTokenService, parseTokenResponse } from '../../../src/server/container/devtunnel-token-service';

describe('parseTokenResponse', () => {
    it('parses valid JSON with token and expiration', () => {
        const result = parseTokenResponse(JSON.stringify({
            tunneldId: 'abc.usw2',
            scope: 'connect',
            lifeTime: '1.00:00:00',
            expiration: '2026-05-15 15:49:56 UTC',
            token: 'eyJhbGciOiJFUzI1NiJ9.test.sig',
        }));
        expect(result.token).toBe('eyJhbGciOiJFUzI1NiJ9.test.sig');
        expect(result.expiresAt).toBeGreaterThan(0);
        // Verify the date was parsed correctly
        expect(new Date(result.expiresAt).toISOString()).toContain('2026-05-15');
    });

    it('handles missing expiration with 24h default', () => {
        const before = Date.now();
        const result = parseTokenResponse(JSON.stringify({ token: 'abc123' }));
        expect(result.token).toBe('abc123');
        // Should be ~24h from now
        expect(result.expiresAt).toBeGreaterThanOrEqual(before + 23 * 60 * 60 * 1000);
    });

    it('throws on invalid JSON', () => {
        expect(() => parseTokenResponse('not json')).toThrow('Failed to parse');
    });

    it('throws on missing token field', () => {
        expect(() => parseTokenResponse(JSON.stringify({ scope: 'connect' }))).toThrow('missing "token"');
    });
});

describe('DevTunnelTokenService', () => {
    let service: DevTunnelTokenService;
    let mockRunner: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockRunner = vi.fn();
        service = new DevTunnelTokenService(mockRunner);
    });

    it('acquires and caches a token', async () => {
        mockRunner.mockResolvedValueOnce({
            stdout: JSON.stringify({
                token: 'tok1',
                expiration: '2099-01-01 00:00:00 UTC',
            }),
            stderr: '',
        });

        const result = await service.getToken('tunnel-1');
        expect(result?.token).toBe('tok1');
        expect(mockRunner).toHaveBeenCalledTimes(1);

        // Second call should use cache
        const result2 = await service.getToken('tunnel-1');
        expect(result2?.token).toBe('tok1');
        expect(mockRunner).toHaveBeenCalledTimes(1); // no new call
    });

    it('deduplicates concurrent requests for same tunnel', async () => {
        mockRunner.mockImplementation(() => new Promise(resolve =>
            setTimeout(() => resolve({
                stdout: JSON.stringify({ token: 'tok-dedup', expiration: '2099-01-01 00:00:00 UTC' }),
                stderr: '',
            }), 50),
        ));

        const [r1, r2, r3] = await Promise.all([
            service.getToken('tunnel-1'),
            service.getToken('tunnel-1'),
            service.getToken('tunnel-1'),
        ]);
        expect(r1?.token).toBe('tok-dedup');
        expect(r2?.token).toBe('tok-dedup');
        expect(r3?.token).toBe('tok-dedup');
        expect(mockRunner).toHaveBeenCalledTimes(1);
    });

    it('returns undefined on CLI failure (non-fatal)', async () => {
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        mockRunner.mockRejectedValueOnce(new Error('devtunnel not found'));

        const result = await service.getToken('tunnel-fail');
        expect(result).toBeUndefined();
        stderrSpy.mockRestore();
    });

    it('refreshes token when near expiry', async () => {
        // First token expires in 30 minutes (within 1h buffer → should refresh)
        mockRunner.mockResolvedValueOnce({
            stdout: JSON.stringify({
                token: 'tok-old',
                expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', ' UTC'),
            }),
            stderr: '',
        });
        await service.getToken('tunnel-x');

        // Next call should trigger a refresh
        mockRunner.mockResolvedValueOnce({
            stdout: JSON.stringify({
                token: 'tok-new',
                expiration: '2099-01-01 00:00:00 UTC',
            }),
            stderr: '',
        });
        const result = await service.getToken('tunnel-x');
        expect(result?.token).toBe('tok-new');
        expect(mockRunner).toHaveBeenCalledTimes(2);
    });

    it('invalidate removes cached token', async () => {
        mockRunner.mockResolvedValue({
            stdout: JSON.stringify({ token: 'tok-inv', expiration: '2099-01-01 00:00:00 UTC' }),
            stderr: '',
        });
        await service.getToken('tunnel-inv');
        service.invalidate('tunnel-inv');

        await service.getToken('tunnel-inv');
        expect(mockRunner).toHaveBeenCalledTimes(2);
    });

    it('clear removes all cached tokens', async () => {
        mockRunner.mockResolvedValue({
            stdout: JSON.stringify({ token: 'tok-c', expiration: '2099-01-01 00:00:00 UTC' }),
            stderr: '',
        });
        await service.getToken('t1');
        await service.getToken('t2');
        service.clear();

        await service.getToken('t1');
        await service.getToken('t2');
        // 2 initial + 2 after clear = 4
        expect(mockRunner).toHaveBeenCalledTimes(4);
    });
});
