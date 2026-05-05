import { describe, it, expect } from 'vitest';
import { DevTunnelPortParseError, parseDevTunnelHttpPort } from '../../src/server/servers/devtunnel-port-parser';

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
