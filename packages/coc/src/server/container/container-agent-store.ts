/**
 * Container Agent Store — JSON file persistence for container-mode agents.
 *
 * Stores agent registrations at `~/.coc/container-agents.json`.
 * Each agent has an address (URL), optional tunnelId for devtunnel auth,
 * and a display name.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
    ContainerAgent,
    ContainerAgentCreateInput,
    ContainerAgentUpdateInput,
} from './container-agent-types';
import { isDevTunnelUrl } from './container-agent-types';

const STORE_FILE = 'container-agents.json';

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

function normalizeAddress(value: unknown): string {
    if (typeof value !== 'string') {
        throw new Error('address must be a string');
    }
    const trimmed = stripTrailingSlash(value.trim());
    if (!trimmed) {
        throw new Error('address is required');
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error('address must be a valid absolute URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('address must use http or https');
    }
    return parsed.toString().replace(/\/+$/, '');
}

function normalizeTunnelId(value: unknown): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new Error('tunnelId must be a string');
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(trimmed)) {
        throw new Error('tunnelId may contain only letters, numbers, dots, underscores, and hyphens');
    }
    return trimmed;
}

function parseAgent(value: unknown): ContainerAgent | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.address !== 'string') {
        return undefined;
    }
    return {
        id: item.id,
        name: typeof item.name === 'string' ? item.name : '',
        address: item.address,
        tunnelId: typeof item.tunnelId === 'string' ? item.tunnelId : undefined,
        addedAt: typeof item.addedAt === 'number' ? item.addedAt : Date.now(),
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
    };
}

export class ContainerAgentStore {
    private readonly filePath: string;

    constructor(private readonly dataDir: string) {
        this.filePath = path.join(dataDir, STORE_FILE);
    }

    list(): ContainerAgent[] {
        if (!fs.existsSync(this.filePath)) {
            return [];
        }
        try {
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed.map(parseAgent).filter((a): a is ContainerAgent => a !== undefined);
        } catch {
            return [];
        }
    }

    get(id: string): ContainerAgent | undefined {
        return this.list().find(a => a.id === id);
    }

    create(value: unknown): ContainerAgent {
        const body = requireObject(value);
        const address = normalizeAddress(body.address);
        const name = typeof body.name === 'string' && body.name.trim()
            ? body.name.trim()
            : deriveNameFromAddress(address);
        let tunnelId = normalizeTunnelId(body.tunnelId);
        // Auto-detect: if address is a devtunnel URL and no tunnelId provided, leave as undefined
        // (the UI should prompt for it, but don't enforce here)
        if (!tunnelId && isDevTunnelUrl(address)) {
            tunnelId = undefined;
        }
        const now = Date.now();
        const agent: ContainerAgent = {
            id: randomUUID(),
            name,
            address,
            tunnelId,
            addedAt: now,
            updatedAt: now,
        };
        this.save([...this.list(), agent]);
        return agent;
    }

    update(id: string, value: unknown): ContainerAgent {
        const body = requireObject(value);
        const agents = this.list();
        const idx = agents.findIndex(a => a.id === id);
        if (idx < 0) {
            throw new Error(`Agent not found: ${id}`);
        }
        const existing = agents[idx];
        const updated: ContainerAgent = {
            ...existing,
            updatedAt: Date.now(),
        };
        if ('name' in body && typeof body.name === 'string') {
            updated.name = body.name.trim() || existing.name;
        }
        if ('address' in body) {
            updated.address = normalizeAddress(body.address);
        }
        if ('tunnelId' in body) {
            updated.tunnelId = body.tunnelId === null ? undefined : normalizeTunnelId(body.tunnelId);
        }
        agents[idx] = updated;
        this.save(agents);
        return updated;
    }

    remove(id: string): ContainerAgent | undefined {
        const agents = this.list();
        const removed = agents.find(a => a.id === id);
        if (!removed) {
            return undefined;
        }
        this.save(agents.filter(a => a.id !== id));
        return removed;
    }

    private save(agents: ContainerAgent[]): void {
        fs.mkdirSync(this.dataDir, { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(agents, null, 2), 'utf8');
        fs.renameSync(tmp, this.filePath);
    }
}

function requireObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Request body must be a JSON object');
    }
    return value as Record<string, unknown>;
}

function deriveNameFromAddress(address: string): string {
    try {
        const hostname = new URL(address).hostname;
        // For devtunnels: "abc123.devtunnels.ms" → "abc123"
        if (hostname.endsWith('.devtunnels.ms')) {
            return hostname.replace('.devtunnels.ms', '');
        }
        return hostname;
    } catch {
        return 'Agent';
    }
}
