/**
 * "What's New" service — the server side of the release-notes story.
 *
 * On startup the SPA asks whether the running app version has release notes it
 * has not shown yet. This module answers that question:
 *
 *   1. resolve the running app version (the desktop app's version, not this
 *      package's — see {@link resolveAppVersion}),
 *   2. compare it against the persisted "last seen version" marker,
 *   3. when it is unseen, fetch the GitHub Release tagged `v<version>` and pull
 *      the `## What's New` block out of its body.
 *
 * Everything that can fail — no marker file, no matching release, GitHub down,
 * GitHub rate-limiting us — resolves to `{ show: false }` with a reason. The
 * endpoint must never block or delay dashboard startup, so the network call is
 * hard-capped by a timeout and both positive and negative results are cached in
 * memory for the life of the server process.
 *
 * Network, filesystem and clock are injectable so tests never touch
 * api.github.com.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Marker file under the CoC data dir, following the `tasks-settings.json` precedent. */
export const WHATS_NEW_FILE = 'whats-new.json';

/** GitHub "release by tag" endpoint for this project. */
export function releaseByTagApi(tag: string): string {
    return `https://api.github.com/repos/plusplusoneplusplus/shortcuts/releases/tags/${encodeURIComponent(tag)}`;
}

/** Hard cap on the GitHub request so a hung socket can never stall the SPA. */
export const FETCH_TIMEOUT_MS = 5_000;

/** The normalized subset of a GitHub release this feature needs. */
export interface WhatsNewRelease {
    /** Raw tag, e.g. "v3.4.9-alpha.31". */
    tag: string;
    /** Release title (GitHub `name`), falling back to the tag. */
    title: string;
    /** The notes to render — the `## What's New` block when present. */
    notes: string;
    /** Human-facing release page URL. */
    htmlUrl: string;
    isPrerelease: boolean;
}

export type WhatsNewReason = 'seen' | 'no-release' | 'fetch-failed' | 'first-launch';

export interface WhatsNewShow {
    show: true;
    version: string;
    tag: string;
    title: string;
    notes: string;
    htmlUrl: string;
    isPrerelease: boolean;
}

export interface WhatsNewHide {
    show: false;
    version: string;
    reason: WhatsNewReason;
}

export type WhatsNewStatus = WhatsNewShow | WhatsNewHide;

/** A minimal HTTP seam: returns the status code and the parsed JSON body. */
export type FetchJson = (url: string, timeoutMs: number) => Promise<{ status: number; json: unknown }>;

export interface WhatsNewDeps {
    /** CoC data dir — the marker file lives directly under it. */
    dataDir: string;
    /** Resolves the running app version, or null when it cannot be determined. */
    appVersion?: () => string | null;
    fetchJson?: FetchJson;
    now?: () => Date;
}

/** Persisted shape of `whats-new.json`. */
export interface WhatsNewMarker {
    lastSeenVersion: string;
    updatedAt: string;
}

// ============================================================================
// Release parsing
// ============================================================================

/**
 * Extract the `## What's New` block from a release body: the heading through to
 * the next top-level `##` heading, or the end of the body.
 *
 * Returns the trimmed block, or `null` when the body has no such heading — the
 * caller then falls back to the whole body, so releases cut before this feature
 * existed still show something rather than nothing.
 */
export function extractWhatsNewBlock(body: string): string | null {
    const lines = body.split('\n');
    const start = lines.findIndex(l => /^##\s+What's New\s*$/i.test(l.trim()));
    if (start < 0) {
        return null;
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^##(?!#)/.test(lines[i])) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join('\n').trim();
}

/**
 * Parse a GitHub "release by tag" payload. Returns null when the payload has no
 * usable tag (an error body, or an empty `{}`), so callers treat "couldn't read
 * a release" uniformly.
 */
export function parseRelease(json: unknown): WhatsNewRelease | null {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return null;
    }
    const obj = json as Record<string, unknown>;
    const tag = typeof obj.tag_name === 'string' ? obj.tag_name : '';
    if (!tag) {
        return null;
    }
    const body = typeof obj.body === 'string' ? obj.body : '';
    const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : tag;
    return {
        tag,
        title: name,
        notes: extractWhatsNewBlock(body) ?? body.trim(),
        htmlUrl: typeof obj.html_url === 'string' ? obj.html_url : '',
        isPrerelease: obj.prerelease === true,
    };
}

// ============================================================================
// App version resolution
// ============================================================================

/**
 * Resolve the version of the *running app*.
 *
 * This is deliberately not this package's version. `.github/workflows/release.yml`
 * rewrites `packages/coc-desktop/package.json`'s version from the git tag at build
 * time without committing it, so the tag is the version — and the coc server
 * package has a version of its own that no release is ever tagged with.
 *
 * Order:
 *   1. `COC_APP_VERSION`, which coc-desktop sets when it forks the server.
 *   2. A `@plusplusoneplusplus/coc-desktop` package.json found by walking up from
 *      this module — covers an attached (not forked) server and a dev checkout.
 *
 * Returns null when neither is available; the caller then shows nothing.
 */
export function resolveAppVersion(
    env: NodeJS.ProcessEnv = process.env,
    startDir: string = __dirname,
): string | null {
    const fromEnv = (env.COC_APP_VERSION ?? '').trim();
    if (fromEnv) {
        return fromEnv.replace(/^v/i, '');
    }
    for (const candidate of desktopPackageJsonCandidates(startDir)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
            if (parsed?.name === '@plusplusoneplusplus/coc-desktop' && typeof parsed.version === 'string') {
                return parsed.version.replace(/^v/i, '');
            }
        } catch {
            // Not there, or not readable — try the next candidate.
        }
    }
    return null;
}

/**
 * Candidate locations of the desktop package.json, walking up from `startDir`.
 * In a packaged app the server lives at `<app>/node_modules/@plusplusoneplusplus/coc/dist/...`
 * so `<app>/package.json` is an ancestor; in the monorepo the desktop package is
 * a sibling under `packages/`.
 */
function desktopPackageJsonCandidates(startDir: string): string[] {
    const out: string[] = [];
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
        out.push(path.join(dir, 'package.json'));
        out.push(path.join(dir, 'packages', 'coc-desktop', 'package.json'));
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    return out;
}

// ============================================================================
// Default network seam
// ============================================================================

/** Default {@link FetchJson}: a timeout-capped unauthenticated GitHub request. */
export const defaultFetchJson: FetchJson = async (url, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'coc-whats-new',
            },
        });
        // A non-2xx body is still read so a 404 can be told apart from a 403.
        const text = await res.text();
        let json: unknown = null;
        try {
            json = JSON.parse(text);
        } catch {
            json = null;
        }
        return { status: res.status, json };
    } finally {
        clearTimeout(timer);
    }
};

// ============================================================================
// Service
// ============================================================================

type CacheEntry =
    | { kind: 'ok'; release: WhatsNewRelease }
    | { kind: 'no-release' }
    | { kind: 'fetch-failed' };

export class WhatsNewService {
    private readonly dataDir: string;
    private readonly appVersion: () => string | null;
    private readonly fetchJson: FetchJson;
    private readonly now: () => Date;
    /** Per-version release lookups, positive and negative alike, for the process lifetime. */
    private readonly cache = new Map<string, CacheEntry>();

    constructor(deps: WhatsNewDeps) {
        this.dataDir = deps.dataDir;
        this.appVersion = deps.appVersion ?? (() => resolveAppVersion());
        this.fetchJson = deps.fetchJson ?? defaultFetchJson;
        this.now = deps.now ?? (() => new Date());
    }

    /** Absolute path of the seen-version marker. */
    get markerPath(): string {
        return path.join(this.dataDir, WHATS_NEW_FILE);
    }

    /**
     * Read the marker. Returns null when it is missing, unreadable or corrupt —
     * all of which are treated as "first launch" by {@link getStatus}.
     */
    readMarker(): WhatsNewMarker | null {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.markerPath, 'utf-8'));
            if (parsed && typeof parsed.lastSeenVersion === 'string' && parsed.lastSeenVersion) {
                return {
                    lastSeenVersion: parsed.lastSeenVersion,
                    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
                };
            }
        } catch {
            // Missing or corrupt — rewritten on the next ack.
        }
        return null;
    }

    /** Record `version` as seen. Concurrent writers race harmlessly: last write wins. */
    async ack(version: string): Promise<void> {
        const marker: WhatsNewMarker = {
            lastSeenVersion: version,
            updatedAt: this.now().toISOString(),
        };
        await fs.promises.mkdir(this.dataDir, { recursive: true });
        await fs.promises.writeFile(this.markerPath, JSON.stringify(marker, null, 2), 'utf-8');
    }

    /** Answer "is there unseen release content for the running version?". */
    async getStatus(): Promise<WhatsNewStatus> {
        const version = this.appVersion();
        if (!version) {
            return { show: false, version: '', reason: 'no-release' };
        }

        const marker = this.readMarker();
        if (!marker) {
            // Very first launch (or a corrupt marker): never show notes
            // retroactively — just record where the user is starting from.
            await this.ack(version);
            return { show: false, version, reason: 'first-launch' };
        }
        if (marker.lastSeenVersion === version) {
            return { show: false, version, reason: 'seen' };
        }

        const entry = await this.lookupRelease(version);
        if (entry.kind !== 'ok') {
            return { show: false, version, reason: entry.kind };
        }
        const { release } = entry;
        if (!release.notes) {
            return { show: false, version, reason: 'no-release' };
        }
        return {
            show: true,
            version,
            tag: release.tag,
            title: release.title,
            notes: release.notes,
            htmlUrl: release.htmlUrl,
            isPrerelease: release.isPrerelease,
        };
    }

    /** Fetch (or replay from cache) the release tagged `v<version>`. */
    private async lookupRelease(version: string): Promise<CacheEntry> {
        const cached = this.cache.get(version);
        if (cached) {
            return cached;
        }
        const entry = await this.fetchRelease(version);
        this.cache.set(version, entry);
        return entry;
    }

    private async fetchRelease(version: string): Promise<CacheEntry> {
        try {
            const { status, json } = await this.fetchJson(releaseByTagApi(`v${version}`), FETCH_TIMEOUT_MS);
            if (status === 404) {
                return { kind: 'no-release' };
            }
            if (status < 200 || status >= 300) {
                // 403 rate-limit included: cached, so we never retry-storm GitHub.
                return { kind: 'fetch-failed' };
            }
            const release = parseRelease(json);
            return release ? { kind: 'ok', release } : { kind: 'no-release' };
        } catch {
            // Offline, DNS failure, abort on timeout.
            return { kind: 'fetch-failed' };
        }
    }
}
