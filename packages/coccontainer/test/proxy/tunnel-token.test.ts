/**
 * Tests for DevTunnelTokenService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DevTunnelTokenService } from '../../src/proxy/tunnel-token';
import * as childProcess from 'child_process';

vi.mock('child_process');

describe('DevTunnelTokenService', () => {
    let service: DevTunnelTokenService;

    beforeEach(() => {
        service = new DevTunnelTokenService();
        vi.resetAllMocks();
    });

    afterEach(() => {
        service.clearCache();
    });

    it('should parse token from devtunnel CLI output', async () => {
        const mockOutput = JSON.stringify({
            tunnelId: 'test-tunnel',
            ports: [4000],
            scope: 'connect',
            lifeTime: '1.00:00:00',
            expiration: '2099-12-31 23:59:59 UTC',
            token: 'eyJhbGciOiJSUzI1NiJ9.test-jwt-token',
        });

        vi.mocked(childProcess.execFile).mockImplementation(
            (_cmd: any, _args: any, _opts: any, callback: any) => {
                callback(null, mockOutput, '');
                return {} as any;
            }
        );

        const token = await service.getToken('test-tunnel');
        expect(token).toBe('eyJhbGciOiJSUzI1NiJ9.test-jwt-token');
    });

    it('should cache tokens and avoid repeated CLI calls', async () => {
        const mockOutput = JSON.stringify({
            tunnelId: 'test-tunnel',
            expiration: '2099-12-31 23:59:59 UTC',
            token: 'cached-token',
        });

        vi.mocked(childProcess.execFile).mockImplementation(
            (_cmd: any, _args: any, _opts: any, callback: any) => {
                callback(null, mockOutput, '');
                return {} as any;
            }
        );

        await service.getToken('test-tunnel');
        await service.getToken('test-tunnel');

        // Should only call execFile once due to caching
        expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    });

    it('should return undefined on CLI error', async () => {
        vi.mocked(childProcess.execFile).mockImplementation(
            (_cmd: any, _args: any, _opts: any, callback: any) => {
                callback(new Error('devtunnel not found'), '', '');
                return {} as any;
            }
        );

        const token = await service.getToken('bad-tunnel');
        expect(token).toBeUndefined();
    });

    it('should return undefined on invalid JSON', async () => {
        vi.mocked(childProcess.execFile).mockImplementation(
            (_cmd: any, _args: any, _opts: any, callback: any) => {
                callback(null, 'not json', '');
                return {} as any;
            }
        );

        const token = await service.getToken('bad-tunnel');
        expect(token).toBeUndefined();
    });

    it('should clear cache', async () => {
        const mockOutput = JSON.stringify({
            tunnelId: 'test-tunnel',
            expiration: '2099-12-31 23:59:59 UTC',
            token: 'to-clear',
        });

        vi.mocked(childProcess.execFile).mockImplementation(
            (_cmd: any, _args: any, _opts: any, callback: any) => {
                callback(null, mockOutput, '');
                return {} as any;
            }
        );

        await service.getToken('test-tunnel');
        service.clearCache('test-tunnel');
        await service.getToken('test-tunnel');

        // Should call twice because cache was cleared
        expect(childProcess.execFile).toHaveBeenCalledTimes(2);
    });
});
