/**
 * Tests for ContainerLinkClient — URL building and lifecycle.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContainerLinkClient } from '../../../src/server/container-link/container-client';

// Access private buildWsUrl via prototype trick for unit testing
function buildWsUrl(containerUrl: string): string {
    const client = new ContainerLinkClient({ containerUrl, localPort: 4000 });
    // Access private method
    return (client as any).buildWsUrl();
}

describe('ContainerLinkClient', () => {
    describe('buildWsUrl', () => {
        it('should convert http:// to ws:// and append path', () => {
            expect(buildWsUrl('http://localhost:5000')).toBe('ws://localhost:5000/ws/agent-link');
        });

        it('should convert https:// to wss:// and append path', () => {
            expect(buildWsUrl('https://container.example.com')).toBe('wss://container.example.com/ws/agent-link');
        });

        it('should auto-prepend ws:// when no protocol is provided', () => {
            expect(buildWsUrl('localhost:5000')).toBe('ws://localhost:5000/ws/agent-link');
        });

        it('should auto-prepend ws:// for bare hostname', () => {
            expect(buildWsUrl('myhost')).toBe('ws://myhost/ws/agent-link');
        });

        it('should auto-prepend ws:// for IP:port', () => {
            expect(buildWsUrl('192.168.1.10:5000')).toBe('ws://192.168.1.10:5000/ws/agent-link');
        });

        it('should strip trailing slash before building URL', () => {
            expect(buildWsUrl('http://localhost:5000/')).toBe('ws://localhost:5000/ws/agent-link');
        });

        it('should use URL as-is if it already contains /ws/agent-link', () => {
            expect(buildWsUrl('ws://custom:9000/ws/agent-link')).toBe('ws://custom:9000/ws/agent-link');
        });

        it('should preserve wss:// protocol', () => {
            expect(buildWsUrl('wss://secure.host:443')).toBe('wss://secure.host:443/ws/agent-link');
        });

        it('should handle HTTP with uppercase', () => {
            expect(buildWsUrl('HTTP://localhost:5000')).toBe('ws://localhost:5000/ws/agent-link');
        });
    });
});
