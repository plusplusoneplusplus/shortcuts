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

export interface ParsedHttpPort {
    port: number;
    publicUrl?: string;
}

interface ParsedPortRow {
    port: number;
    protocol: string;
    portUri?: string;
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
            const portUri = typeof item.portUri === 'string' ? item.portUri
                : typeof item.uri === 'string' ? item.uri
                    : undefined;
            return Number.isInteger(port) && port > 0 && protocol ? [{ port, protocol, portUri }] : [];
        });
    } catch {
        return undefined;
    }
}

function parseTextRows(output: string): ParsedPortRow[] {
    const rows: ParsedPortRow[] = [];
    const lines = output.split(/\r?\n/);

    let uriColStart = -1;
    for (const rawLine of lines) {
        if (/port/i.test(rawLine) && /protocol/i.test(rawLine)) {
            const uriMatch = rawLine.match(/Port\s+URI/i);
            if (uriMatch && uriMatch.index !== undefined) {
                uriColStart = uriMatch.index;
            }
            break;
        }
    }

    for (const rawLine of lines) {
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

        let portUri: string | undefined;
        if (uriColStart >= 0 && rawLine.length > uriColStart) {
            const uriCandidate = rawLine.slice(uriColStart).trim();
            if (uriCandidate.startsWith('https://')) {
                portUri = uriCandidate.split(/\s/)[0];
            }
        }

        if (protocol) {
            rows.push({ port, protocol, portUri });
        }
    }
    return rows;
}

export function parseDevTunnelHttpPortInfo(output: string): ParsedHttpPort {
    const trimmed = output.trim();
    if (!trimmed) {
        throw new DevTunnelPortParseError('unparsable-output', 'devtunnel port list returned no output');
    }

    const rows = parseJsonRows(trimmed) ?? parseTextRows(trimmed);
    if (rows.length === 0) {
        throw new DevTunnelPortParseError('unparsable-output', 'Unable to parse devtunnel port list output');
    }

    const httpRows = rows
        .filter(row => row.protocol.split(/[,\s]+/).some(protocol => protocol.toLowerCase() === 'http'));
    const uniquePorts = Array.from(new Set(httpRows.map(row => row.port)));
    if (uniquePorts.length === 0) {
        throw new DevTunnelPortParseError('zero-http-ports', 'No HTTP ports are configured for this DevTunnel');
    }
    if (uniquePorts.length > 1) {
        throw new DevTunnelPortParseError('multiple-http-ports', 'Multiple HTTP ports are configured for this DevTunnel');
    }

    const matchingRow = httpRows.find(r => r.portUri);
    return {
        port: uniquePorts[0],
        publicUrl: matchingRow?.portUri,
    };
}

/** Compat wrapper — returns only the port number. */
export function parseDevTunnelHttpPort(output: string): number {
    return parseDevTunnelHttpPortInfo(output).port;
}
