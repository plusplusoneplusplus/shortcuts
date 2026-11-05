import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
export { browserApprovalSite } from '../shared/browser-approval-site';

const ALWAYS_ALLOWED_FILE = 'browser-approved-sites.json';

/**
 * Root domains of major sign-in providers and sites, always allowed until the
 * user edits the list. Shared-hosting roots (googleusercontent.com, sharepoint.com,
 * okta.com tenants, ...) are left out because anyone can publish under them.
 */
export const DEFAULT_BROWSER_APPROVED_SITES: readonly string[] = [
    'amazon.com', 'apple.com', 'atlassian.com', 'azure.com', 'bing.com', 'dropbox.com',
    'github.com', 'gmail.com', 'google.com', 'icloud.com', 'linkedin.com', 'live.com',
    'microsoft.com', 'microsoft365.com', 'microsoftonline.com', 'office.com', 'outlook.com',
    'salesforce.com', 'slack.com', 'youtube.com', 'zoom.us',
];

/** Global "Always allow" list file, shared by every workspace. */
export function getBrowserApprovedSitesPath(dataDir: string): string {
    return path.join(dataDir, ALWAYS_ALLOWED_FILE);
}

/**
 * Sites the user chose to always allow. A missing file reads as the default
 * list; a corrupt file reads as empty.
 */
export function readBrowserApprovedSites(dataDir: string): string[] {
    const file = getBrowserApprovedSitesPath(dataDir);
    if (!fs.existsSync(file)) return [...DEFAULT_BROWSER_APPROVED_SITES].sort();
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
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
