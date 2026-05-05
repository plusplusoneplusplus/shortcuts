export type DevTunnelPortParseErrorCode =
    | 'zero-http-ports'
    | 'multiple-http-ports'
    | 'unparsable-output';

export class DevTunnelPortParseError extends Error {
    constructor(public readonly code: DevTunnelPortParseErrorCode, message: string) {
        super(message);
        this.name = 'DevTunnelPortParseError';
    }
}

interface ParsedPortRow {
    port: number;
    protocol: string;
}

function parseJsonRows(output: string): ParsedPortRow[] | undefined {
    try {
        const parsed = JSON.parse(output) as unknown;
        const rows = Array.isArray(parsed)
            ? parsed
            : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { ports?: unknown }).ports)
                ? (parsed as { ports: unknown[] }).ports
                : undefined;
        if (!rows) {
            return undefined;
        }
        return rows.flatMap(row => {
            if (typeof row !== 'object' || row === null) {
                return [];
            }
            const item = row as Record<string, unknown>;
            const portValue = item.port ?? item.portNumber ?? item.number;
            const protocolValue = item.protocol ?? item.protocols;
            const port = typeof portValue === 'number' ? portValue : Number(portValue);
            const protocol = Array.isArray(protocolValue)
                ? protocolValue.join(',')
                : typeof protocolValue === 'string'
                    ? protocolValue
                    : '';
            return Number.isInteger(port) && port > 0 && protocol ? [{ port, protocol }] : [];
        });
    } catch {
        return undefined;
    }
}

function parseTextRows(output: string): ParsedPortRow[] {
    const rows: ParsedPortRow[] = [];
    for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || /^[-\s|+]+$/.test(line) || /port/i.test(line) && /protocol/i.test(line)) {
            continue;
        }
        const leadingPort = line.match(/^(\d{1,5})\b/);
        if (!leadingPort) {
            continue;
        }
        const port = Number(leadingPort[1]);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            continue;
        }
        const rest = line.slice(leadingPort[0].length).trim();
        const protocol = (rest.match(/\b(https?|tcp|ssh)\b/i)?.[0] ?? rest.split(/\s+/)[0] ?? '').toLowerCase();
        if (protocol) {
            rows.push({ port, protocol });
        }
    }
    return rows;
}

export function parseDevTunnelHttpPort(output: string): number {
    const trimmed = output.trim();
    if (!trimmed) {
        throw new DevTunnelPortParseError('unparsable-output', 'devtunnel port list returned no output');
    }

    const rows = parseJsonRows(trimmed) ?? parseTextRows(trimmed);
    if (rows.length === 0) {
        throw new DevTunnelPortParseError('unparsable-output', 'Unable to parse devtunnel port list output');
    }

    const httpPorts = rows
        .filter(row => row.protocol.split(/[,\s]+/).some(protocol => protocol.toLowerCase() === 'http'))
        .map(row => row.port);
    const unique = Array.from(new Set(httpPorts));
    if (unique.length === 0) {
        throw new DevTunnelPortParseError('zero-http-ports', 'No HTTP ports are configured for this DevTunnel');
    }
    if (unique.length > 1) {
        throw new DevTunnelPortParseError('multiple-http-ports', 'Multiple HTTP ports are configured for this DevTunnel');
    }
    return unique[0];
}
