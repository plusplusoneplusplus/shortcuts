import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseDomain } from 'tldts';

/**
 * The approval key for an agent-driven top-level navigation: the root domain
 * (eTLD+1, private suffixes such as `github.io` included) or, for IP and
 * single-label hosts, the exact host. Returns `null` for navigations that never
 * need approval: non-HTTP(S) URLs (`about:blank`, `data:`), `localhost`
 * (and `*.localhost`), loopback IPs, and unparsable input.
 */
export function browserApprovalSite(url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || isLoopbackIp(host)) return null;
    const info = parseDomain(host, { allowPrivateDomains: true });
    if (info.isIp) return host;
    return info.domain ?? host;
}

function isLoopbackIp(host: string): boolean {
    if (/^127(\.\d{1,3}){3}$/.test(host)) return true;
    if (host === '::1') return true;
    // WHATWG URL serializes IPv4-mapped loopback as ::ffff:7fxx:xxxx.
    return /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host);
}

const ALWAYS_ALLOWED_FILE = 'browser-approved-sites.json';

/** Global "Always allow" list file, shared by every workspace. */
export function getBrowserApprovedSitesPath(dataDir: string): string {
    return path.join(dataDir, ALWAYS_ALLOWED_FILE);
}

/** Sites the user chose to always allow. A missing or corrupt file reads as empty. */
export function readBrowserApprovedSites(dataDir: string): string[] {
    try {
        const parsed = JSON.parse(fs.readFileSync(getBrowserApprovedSitesPath(dataDir), 'utf8'));
        const sites: unknown = parsed?.sites;
        return Array.isArray(sites) ? [...new Set(sites.filter((site): site is string => typeof site === 'string' && !!site))].sort() : [];
    } catch {
        return [];
    }
}

function writeBrowserApprovedSites(dataDir: string, sites: string[]): void {
    const file = getBrowserApprovedSitesPath(dataDir);
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.mkdirSync(dataDir, { recursive: true });
    try {
        fs.writeFileSync(temp, JSON.stringify({ sites: [...new Set(sites)].sort() }, null, 2) + '\n', 'utf8');
        fs.renameSync(temp, file);
    } finally {
        fs.rmSync(temp, { force: true });
    }
}

/** Adds a site to the global "Always allow" list. */
export function addBrowserApprovedSite(dataDir: string, site: string): void {
    const sites = readBrowserApprovedSites(dataDir);
    const normalized = site.trim().toLowerCase();
    if (!normalized || sites.includes(normalized)) return;
    writeBrowserApprovedSites(dataDir, [...sites, normalized]);
}

/** Removes a site from the global "Always allow" list. Returns whether it was listed. */
export function removeBrowserApprovedSite(dataDir: string, site: string): boolean {
    const sites = readBrowserApprovedSites(dataDir);
    const normalized = site.trim().toLowerCase();
    if (!sites.includes(normalized)) return false;
    writeBrowserApprovedSites(dataDir, sites.filter(entry => entry !== normalized));
    return true;
}

/**
 * Approval memory for agent-driven navigation: "Allow once" sites live in memory
 * per conversation (workspaceId + processId); "Always allow" sites persist in the
 * global list under the data dir.
 */
export class BrowserNavigationApprovals {
    private readonly once = new Map<string, Set<string>>();

    constructor(private readonly dataDir: string) {}

    isAllowed(workspaceId: string, processId: string, site: string): boolean {
        return !!this.once.get(conversationKey(workspaceId, processId))?.has(site)
            || readBrowserApprovedSites(this.dataDir).includes(site);
    }

    allowOnce(workspaceId: string, processId: string, site: string): void {
        const key = conversationKey(workspaceId, processId);
        let sites = this.once.get(key);
        if (!sites) {
            sites = new Set();
            this.once.set(key, sites);
        }
        sites.add(site);
    }

    allowAlways(site: string): void {
        addBrowserApprovedSite(this.dataDir, site);
    }

    forgetConversation(workspaceId: string, processId: string): void {
        this.once.delete(conversationKey(workspaceId, processId));
    }
}

function conversationKey(workspaceId: string, processId: string): string {
    return JSON.stringify([workspaceId, processId]);
}
