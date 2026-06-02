import { describe, it, expect } from 'vitest';
import { DevTunnelPortParseError, parseDevTunnelForwardedPort, parseDevTunnelHttpPort, parseDevTunnelHttpPortInfo } from '../../src/server/servers/devtunnel-port-parser';

describe('parseDevTunnelHttpPort', () => {
    it('returns the single HTTP port from table output', () => {
        const output = `
Port  Protocol  Description
----  --------  -----------
4000  http      coc
9229  tcp       debugger
`;
        expect(parseDevTunnelHttpPort(output)).toBe(4000);
    });

    it('returns the single HTTP port from JSON output', () => {
        expect(parseDevTunnelHttpPort(JSON.stringify({
            ports: [
                { portNumber: 4000, protocol: 'http' },
                { portNumber: 22, protocol: 'tcp' },
            ],
        }))).toBe(4000);
    });

    it('reports zero HTTP ports explicitly', () => {
        expect(() => parseDevTunnelHttpPort('22 tcp ssh')).toThrow(DevTunnelPortParseError);
        try {
            parseDevTunnelHttpPort('22 tcp ssh');
        } catch (error) {
            expect((error as DevTunnelPortParseError).code).toBe('zero-http-ports');
        }
    });

    it('reports multiple HTTP ports explicitly', () => {
        try {
            parseDevTunnelHttpPort('4000 http coc\n5000 http other');
        } catch (error) {
            expect((error as DevTunnelPortParseError).code).toBe('multiple-http-ports');
        }
    });

    it('reports malformed output explicitly', () => {
        try {
            parseDevTunnelHttpPort('not a table');
        } catch (error) {
            expect((error as DevTunnelPortParseError).code).toBe('unparsable-output');
        }
    });
});

describe('parseDevTunnelHttpPortInfo', () => {
    it('returns port and publicUrl from JSON output with portUri', () => {
        const result = parseDevTunnelHttpPortInfo(JSON.stringify({
            ports: [
                { portNumber: 4000, protocol: 'http', portUri: 'https://abc123-4000.usw2.devtunnels.ms' },
                { portNumber: 22, protocol: 'tcp' },
            ],
        }));
        expect(result).toEqual({ port: 4000, publicUrl: 'https://abc123-4000.usw2.devtunnels.ms' });
    });

    it('returns port and publicUrl from JSON output with uri field', () => {
        const result = parseDevTunnelHttpPortInfo(JSON.stringify({
            ports: [
                { portNumber: 4000, protocol: 'http', uri: 'https://my-tunnel-4000.usw2.devtunnels.ms' },
            ],
        }));
        expect(result).toEqual({ port: 4000, publicUrl: 'https://my-tunnel-4000.usw2.devtunnels.ms' });
    });

    it('returns port without publicUrl when JSON output lacks portUri', () => {
        const result = parseDevTunnelHttpPortInfo(JSON.stringify({
            ports: [
                { portNumber: 4000, protocol: 'http' },
            ],
        }));
        expect(result).toEqual({ port: 4000, publicUrl: undefined });
    });

    it('extracts publicUrl from tabular output with Port URI column', () => {
        const output = `Port  Protocol  Port URI
----  --------  --------
4000  http      https://my-tunnel-4000.usw2.devtunnels.ms
9229  tcp       https://my-tunnel-9229.usw2.devtunnels.ms
`;
        const result = parseDevTunnelHttpPortInfo(output);
        expect(result).toEqual({ port: 4000, publicUrl: 'https://my-tunnel-4000.usw2.devtunnels.ms' });
    });

    it('returns undefined publicUrl from tabular output without Port URI column', () => {
        const output = `Port  Protocol  Description
----  --------  -----------
4000  http      coc
`;
        const result = parseDevTunnelHttpPortInfo(output);
        expect(result).toEqual({ port: 4000, publicUrl: undefined });
    });

    it('prefers portUri over uri in JSON', () => {
        const result = parseDevTunnelHttpPortInfo(JSON.stringify({
            ports: [
                { portNumber: 4000, protocol: 'http', portUri: 'https://preferred.devtunnels.ms', uri: 'https://other.devtunnels.ms' },
            ],
        }));
        expect(result.publicUrl).toBe('https://preferred.devtunnels.ms');
    });

    it('handles JSON array format', () => {
        const result = parseDevTunnelHttpPortInfo(JSON.stringify([
            { port: 4000, protocol: 'http', portUri: 'https://arr-4000.devtunnels.ms' },
        ]));
        expect(result).toEqual({ port: 4000, publicUrl: 'https://arr-4000.devtunnels.ms' });
    });

    it('throws on empty output', () => {
        expect(() => parseDevTunnelHttpPortInfo('')).toThrow(DevTunnelPortParseError);
    });

    it('throws on zero HTTP ports', () => {
        expect(() => parseDevTunnelHttpPortInfo('22 tcp ssh')).toThrow(DevTunnelPortParseError);
    });

    it('throws on multiple HTTP ports', () => {
        expect(() => parseDevTunnelHttpPortInfo('4000 http coc\n5000 http other')).toThrow(DevTunnelPortParseError);
    });
});

describe('parseDevTunnelForwardedPort', () => {
    it('parses the local port from a "Forwarding from <addr>:<local> to host port <host>" line', () => {
        const output = 'SSH: Forwarding from 127.0.0.1:63770 to host port 46279.';
        expect(parseDevTunnelForwardedPort(output, 46279)).toBe(63770);
    });

    it('parses the local port from an IPv6 forwarding line', () => {
        const output = 'SSH: Forwarding from [::1]:63770 to host port 46279.';
        expect(parseDevTunnelForwardedPort(output, 46279)).toBe(63770);
    });

    it('parses the local port from a "Forwarding port <host> to local port <local>" line', () => {
        const output = 'Forwarding port 46279 to local port 50001.';
        expect(parseDevTunnelForwardedPort(output, 46279)).toBe(50001);
    });

    it('handles same-port forwarding (local === host)', () => {
        const output = 'Forwarding from 127.0.0.1:46279 to host port 46279.';
        expect(parseDevTunnelForwardedPort(output, 46279)).toBe(46279);
    });

    it('picks the line matching the requested host port among several', () => {
        const output = [
            'Forwarding from 127.0.0.1:11111 to host port 22.',
            'Forwarding from 127.0.0.1:63770 to host port 46279.',
        ].join('\n');
        expect(parseDevTunnelForwardedPort(output, 46279)).toBe(63770);
    });

    it('parses real multi-line devtunnel connect output', () => {
        const output = [
            'Connected to tunnel: db-west3-wsl',
            'SSH: Forwarding from 127.0.0.1:63770 to host port 46279.',
            'SSH: Forwarding from [::1]:63770 to host port 46279.',
            'SSH: PortForwardingService listening on 127.0.0.1:63770.',
        ].join('\n');
        expect(parseDevTunnelForwardedPort(output, 46279)).toBe(63770);
    });

    it('returns undefined when no forwarding line matches the host port', () => {
        const output = 'Forwarding from 127.0.0.1:63770 to host port 22.';
        expect(parseDevTunnelForwardedPort(output, 46279)).toBeUndefined();
    });

    it('returns undefined for empty output', () => {
        expect(parseDevTunnelForwardedPort('', 46279)).toBeUndefined();
    });

    it('rejects out-of-range local ports', () => {
        const output = 'Forwarding from 127.0.0.1:99999 to host port 46279.';
        expect(parseDevTunnelForwardedPort(output, 46279)).toBeUndefined();
    });
});
