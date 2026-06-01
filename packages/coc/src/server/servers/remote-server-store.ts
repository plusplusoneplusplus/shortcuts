import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
    DevTunnelRemoteServer,
    RemoteServer,
    RemoteServerCreateInput,
    RemoteServerUpdateInput,
    SshRemoteServer,
    UrlRemoteServer,
} from './remote-server-types';

const REGISTRY_FILE = 'remote-servers.json';

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

function requireObject(value: unknown, message = 'Request body must be a JSON object'): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(message);
    }
    return value as Record<string, unknown>;
}

function normalizeLabel(label: unknown): string {
    if (typeof label !== 'string') {
        throw new Error('label must be a string');
    }
    const trimmed = label.trim();
    if (!trimmed) {
        throw new Error('label is required');
    }
    return trimmed;
}

export function normalizeRemoteServerUrl(value: unknown): string {
    if (typeof value !== 'string') {
        throw new Error('url must be a string');
    }
    const trimmed = stripTrailingSlash(value.trim());
    if (!trimmed) {
        throw new Error('url is required');
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error('url must be a valid absolute URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('url must use http or https');
    }
    return parsed.toString().replace(/\/+$/, '');
}

export function normalizeTunnelId(value: unknown): string {
    if (typeof value !== 'string') {
        throw new Error('tunnelId must be a string');
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error('tunnelId is required');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(trimmed)) {
        throw new Error('tunnelId may contain only letters, numbers, dots, underscores, and hyphens');
    }
    return trimmed;
}

export function normalizeSshHost(value: unknown): string {
    if (typeof value !== 'string') {
        throw new Error('host must be a string');
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error('host is required');
    }
    return trimmed;
}

export function normalizeSshLocalPort(value: unknown): number {
    const num = typeof value === 'string' ? parseInt(value, 10) : value;
    if (typeof num !== 'number' || !Number.isInteger(num) || num < 1 || num > 65535) {
        throw new Error('localPort must be an integer between 1 and 65535');
    }
    return num;
}

function parseRemoteServer(value: unknown): RemoteServer | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.label !== 'string') {
        return undefined;
    }
    const addedAt = typeof item.addedAt === 'number' ? item.addedAt : Date.now();
    const updatedAt = typeof item.updatedAt === 'number' ? item.updatedAt : addedAt;
    if (item.kind === 'url') {
        return {
            id: item.id,
            label: item.label,
            kind: 'url',
            url: normalizeRemoteServerUrl(item.url),
            addedAt,
            updatedAt,
        };
    }
    if (item.kind === 'devtunnel') {
        return {
            id: item.id,
            label: item.label,
            kind: 'devtunnel',
            tunnelId: normalizeTunnelId(item.tunnelId),
            addedAt,
            updatedAt,
        };
    }
    if (item.kind === 'ssh') {
        return {
            id: item.id,
            label: item.label,
            kind: 'ssh',
            host: normalizeSshHost(item.host),
            localPort: normalizeSshLocalPort(item.localPort),
            addedAt,
            updatedAt,
        };
    }
    return undefined;
}

function buildCreateInput(value: unknown): RemoteServerCreateInput {
    const body = requireObject(value);
    const kind = body.kind;
    if (kind === 'url') {
        return { kind, label: normalizeLabel(body.label), url: normalizeRemoteServerUrl(body.url) };
    }
    if (kind === 'devtunnel') {
        return { kind, label: normalizeLabel(body.label), tunnelId: normalizeTunnelId(body.tunnelId) };
    }
    if (kind === 'ssh') {
        return { kind, label: normalizeLabel(body.label), host: normalizeSshHost(body.host), localPort: normalizeSshLocalPort(body.localPort) };
    }
    throw new Error('kind must be "url", "devtunnel", or "ssh"');
}

function buildUpdateInput(value: unknown): RemoteServerUpdateInput {
    const body = requireObject(value);
    const patch: RemoteServerUpdateInput = {};
    if ('label' in body) {
        patch.label = normalizeLabel(body.label);
    }
    if ('kind' in body) {
        if (body.kind !== 'url' && body.kind !== 'devtunnel' && body.kind !== 'ssh') {
            throw new Error('kind must be "url", "devtunnel", or "ssh"');
        }
        patch.kind = body.kind;
    }
    if ('url' in body) {
        (patch as { url?: string }).url = normalizeRemoteServerUrl(body.url);
    }
    if ('tunnelId' in body) {
        (patch as { tunnelId?: string }).tunnelId = normalizeTunnelId(body.tunnelId);
    }
    if ('host' in body) {
        (patch as { host?: string }).host = normalizeSshHost(body.host);
    }
    if ('localPort' in body) {
        (patch as { localPort?: number }).localPort = normalizeSshLocalPort(body.localPort);
    }
    if (!('label' in patch) && !('kind' in patch) && !('url' in patch) && !('tunnelId' in patch) && !('host' in patch) && !('localPort' in patch)) {
        throw new Error('Request body must contain at least one editable field');
    }
    return patch;
}

export class RemoteServerStore {
    private readonly filePath: string;

    constructor(private readonly dataDir: string) {
        this.filePath = path.join(dataDir, REGISTRY_FILE);
    }

    list(): RemoteServer[] {
        if (!fs.existsSync(this.filePath)) {
            return [];
        }
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            throw new Error('remote-servers.json must contain an array');
        }
        return parsed.map(parseRemoteServer).filter((s): s is RemoteServer => s !== undefined);
    }

    get(id: string): RemoteServer | undefined {
        return this.list().find(s => s.id === id);
    }

    create(value: unknown): RemoteServer {
        const input = buildCreateInput(value);
        const now = Date.now();
        let server: RemoteServer;
        if (input.kind === 'url') {
            server = { id: randomUUID(), kind: 'url', label: input.label, url: input.url, addedAt: now, updatedAt: now };
        } else if (input.kind === 'devtunnel') {
            server = { id: randomUUID(), kind: 'devtunnel', label: input.label, tunnelId: input.tunnelId, addedAt: now, updatedAt: now };
        } else {
            server = { id: randomUUID(), kind: 'ssh', label: input.label, host: input.host, localPort: input.localPort, addedAt: now, updatedAt: now };
        }
        this.save([...this.list(), server]);
        return server;
    }

    validateCreate(value: unknown): RemoteServerCreateInput {
        return buildCreateInput(value);
    }

    update(id: string, value: unknown): RemoteServer {
        const patch = buildUpdateInput(value);
        let found = false;
        const next = this.list().map(server => {
            if (server.id !== id) {
                return server;
            }
            found = true;
            const kind = patch.kind ?? server.kind;
            const label = patch.label ?? server.label;
            if (kind === 'url') {
                const url = (patch as { url?: string }).url ?? (server.kind === 'url' ? server.url : undefined);
                if (!url) {
                    throw new Error('url is required when kind is "url"');
                }
                return { id: server.id, kind, label, url, addedAt: server.addedAt, updatedAt: Date.now() } satisfies UrlRemoteServer;
            }
            if (kind === 'devtunnel') {
                const tunnelId = (patch as { tunnelId?: string }).tunnelId ?? (server.kind === 'devtunnel' ? server.tunnelId : undefined);
                if (!tunnelId) {
                    throw new Error('tunnelId is required when kind is "devtunnel"');
                }
                return { id: server.id, kind, label, tunnelId, addedAt: server.addedAt, updatedAt: Date.now() } satisfies DevTunnelRemoteServer;
            }
            // kind === 'ssh'
            const host = (patch as { host?: string }).host ?? (server.kind === 'ssh' ? server.host : undefined);
            if (!host) {
                throw new Error('host is required when kind is "ssh"');
            }
            const localPort = (patch as { localPort?: number }).localPort ?? (server.kind === 'ssh' ? server.localPort : undefined);
            if (localPort === undefined) {
                throw new Error('localPort is required when kind is "ssh"');
            }
            return { id: server.id, kind, label, host, localPort, addedAt: server.addedAt, updatedAt: Date.now() } satisfies SshRemoteServer;
        });
        if (!found) {
            throw new Error(`Remote server not found: ${id}`);
        }
        this.save(next);
        return next.find(s => s.id === id)!;
    }

    remove(id: string): RemoteServer | undefined {
        const existing = this.list();
        const removed = existing.find(s => s.id === id);
        if (!removed) {
            return undefined;
        }
        this.save(existing.filter(s => s.id !== id));
        return removed;
    }

    private save(servers: RemoteServer[]): void {
        fs.mkdirSync(this.dataDir, { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(servers, null, 2), 'utf8');
        fs.renameSync(tmp, this.filePath);
    }
}
