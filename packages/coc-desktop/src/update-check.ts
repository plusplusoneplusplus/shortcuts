/**
 * CoC Desktop — in-app update check.
 *
 * Polls the project's GitHub Releases for a newer published release and surfaces
 * a notification so the user can upgrade "from the app directly". The download is
 * one click: it opens the platform installer (or the release page) in the system
 * browser. This works for the current UNSIGNED builds on every platform —
 * detection never depends on a code signature.
 *
 * Why not silent auto-install? On macOS the OS updater (Squirrel.Mac) refuses to
 * apply an update to an unsigned/un-notarized app, so a true background install
 * is impossible until the app is signed. A notify + one-click-download flow gives
 * the same "update from the app" experience without that requirement, and on
 * macOS it also hands the user the one-line Gatekeeper quarantine fix.
 *
 * This module imports NOTHING from `electron`, so the version math, release
 * parsing, and dialog-content formatting are unit-testable under plain Node. The
 * electron wiring (showing the dialog, opening the browser, clipboard) lives in
 * `main.ts`. Network, filesystem, and platform seams are all injectable so tests
 * never hit the real network or disk.
 */

import * as fs from 'fs';
import * as path from 'path';

/** GitHub "latest published release" endpoint for this repo. */
export const LATEST_RELEASE_API =
    'https://api.github.com/repos/plusplusoneplusplus/shortcuts/releases/latest';

/** The one-line command that clears macOS download quarantine for an unsigned build. */
export const MAC_QUARANTINE_FIX = 'xattr -dr com.apple.quarantine /Applications/CoC.app';

/** A single downloadable file attached to a release. */
export interface ReleaseAsset {
    name: string;
    url: string;
}

/** The normalized subset of a GitHub release we care about. */
export interface ReleaseInfo {
    /** Version with any leading "v" stripped, e.g. "3.4.6". */
    version: string;
    /** Raw tag, e.g. "v3.4.6". */
    tag: string;
    /** Human-facing release page URL. */
    htmlUrl: string;
    /** Release body / notes (may be empty). */
    notes: string;
    /** Downloadable installer assets. */
    assets: ReleaseAsset[];
}

/**
 * Parse the JSON returned by the GitHub releases API into a {@link ReleaseInfo}.
 * Returns `null` when the payload is missing a usable tag (e.g. an error body or
 * an empty `{}`), so callers can treat "couldn't determine a release" uniformly.
 */
export function parseLatestRelease(json: unknown): ReleaseInfo | null {
    if (!json || typeof json !== 'object') {
        return null;
    }
    const obj = json as Record<string, unknown>;
    const tag = typeof obj.tag_name === 'string' ? obj.tag_name : '';
    if (!tag) {
        return null;
    }
    const assetsRaw = Array.isArray(obj.assets) ? obj.assets : [];
    const assets: ReleaseAsset[] = assetsRaw
        .map((a): ReleaseAsset | null => {
            if (!a || typeof a !== 'object') {
                return null;
            }
            const rec = a as Record<string, unknown>;
            const name = typeof rec.name === 'string' ? rec.name : '';
            const url =
                typeof rec.browser_download_url === 'string' ? rec.browser_download_url : '';
            return name && url ? { name, url } : null;
        })
        .filter((a): a is ReleaseAsset => a !== null);
    return {
        version: normalizeVersion(tag),
        tag,
        htmlUrl: typeof obj.html_url === 'string' ? obj.html_url : '',
        notes: typeof obj.body === 'string' ? obj.body : '',
        assets,
    };
}

/** Strip a leading "v"/"V" and surrounding whitespace from a version/tag string. */
export function normalizeVersion(v: string): string {
    return v.trim().replace(/^v/i, '');
}

/**
 * Compare two dotted numeric versions. Returns 1 if `a > b`, -1 if `a < b`, 0 if
 * equal. Leading "v" is tolerated. Numeric segments are compared left-to-right;
 * a missing segment counts as 0 (so "3.4" === "3.4.0"). Any non-numeric
 * pre-release tail (e.g. "-beta.1") is ignored for ordering — a pragmatic choice
 * that keeps the common release case correct without a full semver parser.
 */
export function compareVersions(a: string, b: string): number {
    const segs = (v: string): number[] =>
        normalizeVersion(v)
            .split('-')[0]
            .split('.')
            .map((s) => parseInt(s, 10))
            .map((n) => (Number.isFinite(n) ? n : 0));
    const av = segs(a);
    const bv = segs(b);
    const len = Math.max(av.length, bv.length);
    for (let i = 0; i < len; i++) {
        const diff = (av[i] ?? 0) - (bv[i] ?? 0);
        if (diff !== 0) {
            return diff > 0 ? 1 : -1;
        }
    }
    return 0;
}

/** True iff `latest` is strictly newer than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
    return compareVersions(latest, current) > 0;
}

/**
 * Choose the best download URL for a release on the given platform:
 *   - macOS  → the `.dmg` (preferring an arm64 build when several exist),
 *   - Windows → the `.exe` installer,
 * falling back to the release page when no matching asset is attached (e.g. a
 * release whose binaries are still uploading, or a platform with no asset).
 */
export function pickDownloadUrl(release: ReleaseInfo, platform: NodeJS.Platform): string {
    const byName = (pred: (name: string) => boolean): ReleaseAsset | undefined =>
        release.assets.find((a) => pred(a.name.toLowerCase()));
    if (platform === 'darwin') {
        const arm = byName((n) => n.endsWith('.dmg') && n.includes('arm64'));
        const dmg = arm ?? byName((n) => n.endsWith('.dmg'));
        if (dmg) {
            return dmg.url;
        }
    } else if (platform === 'win32') {
        const exe = byName((n) => n.endsWith('.exe'));
        if (exe) {
            return exe.url;
        }
    }
    return release.htmlUrl;
}

/** A renderable, electron-agnostic description of the update dialog. */
export interface UpdatePrompt {
    /** The available version (normalized, no leading "v") — used for "Skip". */
    version: string;
    title: string;
    /** One-line summary suitable for a dialog `message`. */
    message: string;
    /** Multi-line body suitable for a dialog `detail`. */
    detail: string;
    /** Button labels in order; `main.ts` maps the chosen index to an action. */
    buttons: string[];
    /** Resolved best-effort download URL for this platform. */
    downloadUrl: string;
    /** macOS only: the quarantine fix command offered via a "Copy fix" button. */
    quarantineFix?: string;
}

/**
 * Build the update dialog content for a newer release. On macOS the prompt also
 * explains the unsigned-build Gatekeeper step and offers to copy the quarantine
 * fix command; on Windows it notes the SmartScreen "Run anyway" step.
 */
export function formatUpdatePrompt(
    release: ReleaseInfo,
    currentVersion: string,
    platform: NodeJS.Platform,
): UpdatePrompt {
    const downloadUrl = pickDownloadUrl(release, platform);
    const base: UpdatePrompt = {
        version: release.version,
        title: 'Update Available',
        message: `CoC ${release.version} is available — you have ${normalizeVersion(currentVersion)}.`,
        detail: '',
        buttons: [],
        downloadUrl,
    };
    if (platform === 'darwin') {
        return {
            ...base,
            detail:
                'Click Download to get the new DMG, then drag CoC into Applications.\n\n' +
                'This build is not yet code-signed, so on first launch macOS may say ' +
                '"CoC is damaged." It is not corrupt — clear the download quarantine flag:\n\n' +
                `  ${MAC_QUARANTINE_FIX}\n\n` +
                'Use "Copy fix command" to put that on your clipboard.',
            buttons: ['Download', 'Copy fix command', 'Skip This Version', 'Later'],
            quarantineFix: MAC_QUARANTINE_FIX,
        };
    }
    if (platform === 'win32') {
        return {
            ...base,
            detail:
                'Click Download to get the new installer, then run it.\n\n' +
                'This installer is not yet signed, so SmartScreen may warn about an ' +
                'unknown publisher — choose "More info → Run anyway".',
            buttons: ['Download', 'Skip This Version', 'Later'],
        };
    }
    return {
        ...base,
        detail: 'Click Download to get the latest release.',
        buttons: ['Download', 'Skip This Version', 'Later'],
    };
}

// ---------------------------------------------------------------------------
// "Skip this version" persistence
//
// Mirrors agent-preflight's marker pattern: a small JSON file in the shared data
// dir, namespaced to the desktop app so it never collides with the CLI's files.
// A skipped version suppresses the *automatic* launch prompt for that exact
// version only; an explicit "Check for Updates…" always re-checks.
// ---------------------------------------------------------------------------

/** Injectable filesystem seams for the skipped-version marker. */
export interface UpdateStore {
    readText?: (filePath: string) => string;
    writeText?: (filePath: string, data: string) => void;
    ensureDir?: (dir: string) => void;
}

const MARKER_FILENAME = 'desktop-update.json';

function markerPath(dataDir: string): string {
    return path.join(dataDir, MARKER_FILENAME);
}

/** The version the user chose to skip, or `null` if none/unreadable. */
export function getSkippedVersion(dataDir: string, store: UpdateStore = {}): string | null {
    const readText = store.readText ?? ((p) => fs.readFileSync(p, 'utf8'));
    try {
        const parsed = JSON.parse(readText(markerPath(dataDir))) as { skipVersion?: string };
        return typeof parsed?.skipVersion === 'string' ? parsed.skipVersion : null;
    } catch {
        return null;
    }
}

/** Record a version the user wants to skip in the automatic launch prompt. */
export function setSkippedVersion(
    dataDir: string,
    version: string,
    store: UpdateStore = {},
): void {
    const ensureDir = store.ensureDir ?? ((d) => { fs.mkdirSync(d, { recursive: true }); });
    const writeText = store.writeText ?? ((p, data) => fs.writeFileSync(p, data));
    try {
        ensureDir(dataDir);
        writeText(markerPath(dataDir), JSON.stringify({ skipVersion: normalizeVersion(version) }));
    } catch {
        // Best-effort: a failed write only means we may re-prompt next launch.
    }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Injectable seams for {@link checkForUpdate}. */
export interface UpdateCheckOptions {
    /** Current app version (normally `app.getVersion()`). */
    currentVersion: string;
    /** Target platform; defaults to `process.platform`. */
    platform?: NodeJS.Platform;
    /** Fetch implementation; defaults to global `fetch`. */
    fetchFn?: typeof fetch;
    /** Releases endpoint; defaults to {@link LATEST_RELEASE_API}. */
    apiUrl?: string;
}

/** Why no prompt was produced, for logging / "Check for Updates…" feedback. */
export type UpdateCheckReason = 'newer' | 'up-to-date' | 'error';

/** The outcome of an update check. `release`/`prompt` are set only when newer. */
export interface UpdateCheckResult {
    reason: UpdateCheckReason;
    release: ReleaseInfo | null;
    prompt: UpdatePrompt | null;
}

/**
 * Fetch the latest release and decide whether to prompt. Never throws — a
 * network or parse failure resolves to `{ reason: 'error' }` so the caller (a
 * fire-and-forget launch check) can simply do nothing.
 */
export async function checkForUpdate(opts: UpdateCheckOptions): Promise<UpdateCheckResult> {
    const platform = opts.platform ?? process.platform;
    const fetchFn = opts.fetchFn ?? globalThis.fetch;
    const apiUrl = opts.apiUrl ?? LATEST_RELEASE_API;
    const miss = (reason: UpdateCheckReason): UpdateCheckResult => ({
        reason,
        release: null,
        prompt: null,
    });
    if (typeof fetchFn !== 'function') {
        return miss('error');
    }
    try {
        const res = await fetchFn(apiUrl, {
            headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) {
            return miss('error');
        }
        const release = parseLatestRelease(await res.json());
        if (!release) {
            return miss('error');
        }
        if (!isNewerVersion(release.version, opts.currentVersion)) {
            return { reason: 'up-to-date', release, prompt: null };
        }
        return {
            reason: 'newer',
            release,
            prompt: formatUpdatePrompt(release, opts.currentVersion, platform),
        };
    } catch {
        return miss('error');
    }
}
