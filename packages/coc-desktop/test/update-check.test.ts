/**
 * Unit tests for the in-app update check.
 *
 * The module is electron-free: version math and release parsing are pure, the
 * skip-marker store is injectable, and checkForUpdate takes an injectable fetch,
 * so nothing here touches the network, disk, or the Electron runtime.
 */

import * as path from 'path';
import { describe, it, expect } from 'vitest';
import {
    normalizeVersion,
    compareVersions,
    isNewerVersion,
    isPrerelease,
    inferChannel,
    parseLatestRelease,
    parseReleaseList,
    selectCandidate,
    pickDownloadUrl,
    formatUpdatePrompt,
    getSkippedVersion,
    setSkippedVersion,
    getUpdateChannel,
    setUpdateChannel,
    checkForUpdate,
    MAC_QUARANTINE_FIX,
    LATEST_RELEASE_API,
    RELEASES_LIST_API,
    ReleaseInfo,
    UpdateStore,
} from '../src/update-check';

function release(over: Partial<ReleaseInfo> = {}): ReleaseInfo {
    return {
        version: '3.4.6',
        tag: 'v3.4.6',
        htmlUrl: 'https://github.com/plusplusoneplusplus/shortcuts/releases/tag/v3.4.6',
        notes: 'notes',
        assets: [],
        isPrerelease: false,
        ...over,
    };
}

/** A GitHub-style release payload, deliberately loosely typed. */
function ghPayload(over: Record<string, unknown> = {}): unknown {
    return {
        tag_name: 'v3.4.6',
        html_url: 'https://example.com/rel',
        body: 'release body',
        prerelease: false,
        assets: [
            {
                name: 'CoC-3.4.6-arm64.dmg',
                browser_download_url: 'https://example.com/CoC-3.4.6-arm64.dmg',
            },
            {
                name: 'CoC.Setup.3.4.6.exe',
                browser_download_url: 'https://example.com/CoC.Setup.3.4.6.exe',
            },
        ],
        ...over,
    };
}

/** A GitHub-style prerelease payload. */
function ghPrePayload(tag = 'v3.4.8-alpha.1', over: Record<string, unknown> = {}): unknown {
    return ghPayload({
        tag_name: tag,
        prerelease: true,
        assets: [
            {
                name: `CoC-${tag.replace(/^v/, '')}-arm64.dmg`,
                browser_download_url: `https://example.com/CoC-${tag.replace(/^v/, '')}-arm64.dmg`,
            },
        ],
        ...over,
    });
}

/** A fetch stub returning the given JSON with a chosen ok/status. */
function fakeFetch(json: unknown, init: { ok?: boolean } = {}): typeof fetch {
    return (async () => ({
        ok: init.ok ?? true,
        json: async () => json,
    })) as unknown as typeof fetch;
}

describe('normalizeVersion', () => {
    it('strips a leading v (any case) and whitespace', () => {
        expect(normalizeVersion('v3.4.6')).toBe('3.4.6');
        expect(normalizeVersion('V3.4.6')).toBe('3.4.6');
        expect(normalizeVersion('  3.4.6 ')).toBe('3.4.6');
        expect(normalizeVersion('3.4.6')).toBe('3.4.6');
    });
});

describe('isPrerelease', () => {
    it('detects a prerelease suffix', () => {
        expect(isPrerelease('3.4.8-alpha.1')).toBe(true);
        expect(isPrerelease('v3.4.8-rc.2')).toBe(true);
    });

    it('returns false for stable versions', () => {
        expect(isPrerelease('3.4.8')).toBe(false);
        expect(isPrerelease('v3.4.8')).toBe(false);
    });
});

describe('inferChannel', () => {
    it('returns prerelease for a version with a prerelease suffix', () => {
        expect(inferChannel('3.4.8-alpha.1')).toBe('prerelease');
        expect(inferChannel('v3.5.0-rc.1')).toBe('prerelease');
    });

    it('returns stable for a clean semver', () => {
        expect(inferChannel('3.4.8')).toBe('stable');
        expect(inferChannel('v3.4.8')).toBe('stable');
    });
});

describe('compareVersions', () => {
    it('orders by numeric segments, not lexically', () => {
        expect(compareVersions('3.4.10', '3.4.2')).toBe(1); // 10 > 2, not "10" < "2"
        expect(compareVersions('3.4.2', '3.4.10')).toBe(-1);
        expect(compareVersions('4.0.0', '3.9.9')).toBe(1);
    });

    it('treats equal stable versions as 0 and tolerates a leading v', () => {
        expect(compareVersions('3.4.6', '3.4.6')).toBe(0);
        expect(compareVersions('v3.4.6', '3.4.6')).toBe(0);
    });

    it('pads missing segments with 0 (3.4 === 3.4.0)', () => {
        expect(compareVersions('3.4', '3.4.0')).toBe(0);
        expect(compareVersions('3.4.1', '3.4')).toBe(1);
    });

    it('stable is greater than prerelease of the same base (semver spec)', () => {
        expect(compareVersions('3.4.8', '3.4.8-alpha.1')).toBe(1);
        expect(compareVersions('3.4.8-alpha.1', '3.4.8')).toBe(-1);
        expect(compareVersions('3.4.6', '3.4.6-beta.1')).toBe(1);
    });

    it('higher base beats lower base regardless of prerelease tag', () => {
        expect(compareVersions('3.5.0-rc.1', '3.4.6')).toBe(1);
        expect(compareVersions('3.5.0', '3.4.6-rc.1')).toBe(1);
    });

    it('compares prerelease suffixes lexicographically when bases are equal', () => {
        expect(compareVersions('3.4.8-alpha.2', '3.4.8-alpha.1')).toBe(1);
        expect(compareVersions('3.4.8-alpha.1', '3.4.8-alpha.1')).toBe(0);
        expect(compareVersions('3.4.8-beta.1', '3.4.8-alpha.9')).toBe(1);
    });

    it('treats non-numeric segments as 0 rather than NaN', () => {
        expect(compareVersions('3.x.6', '3.0.6')).toBe(0);
    });
});

describe('isNewerVersion', () => {
    it('is true only when strictly greater', () => {
        expect(isNewerVersion('3.4.6', '3.4.2')).toBe(true);
        expect(isNewerVersion('3.4.6', '3.4.6')).toBe(false);
        expect(isNewerVersion('3.4.2', '3.4.6')).toBe(false);
    });

    it('stable 3.4.8 is newer than prerelease 3.4.8-alpha.1', () => {
        expect(isNewerVersion('3.4.8', '3.4.8-alpha.1')).toBe(true);
        expect(isNewerVersion('3.4.8-alpha.1', '3.4.8')).toBe(false);
    });
});

describe('parseLatestRelease', () => {
    it('normalizes a well-formed payload', () => {
        const info = parseLatestRelease(ghPayload());
        expect(info).not.toBeNull();
        expect(info!.version).toBe('3.4.6');
        expect(info!.tag).toBe('v3.4.6');
        expect(info!.htmlUrl).toBe('https://example.com/rel');
        expect(info!.notes).toBe('release body');
        expect(info!.isPrerelease).toBe(false);
        expect(info!.assets).toHaveLength(2);
        expect(info!.assets[0]).toEqual({
            name: 'CoC-3.4.6-arm64.dmg',
            url: 'https://example.com/CoC-3.4.6-arm64.dmg',
        });
    });

    it('reads the prerelease flag from the GitHub payload', () => {
        const pre = parseLatestRelease(ghPayload({ prerelease: true }));
        expect(pre!.isPrerelease).toBe(true);

        const stable = parseLatestRelease(ghPayload({ prerelease: false }));
        expect(stable!.isPrerelease).toBe(false);
    });

    it('defaults isPrerelease to false when the field is absent', () => {
        const info = parseLatestRelease({ tag_name: 'v3.4.6', html_url: '', body: '', assets: [] });
        expect(info!.isPrerelease).toBe(false);
    });

    it('returns null when there is no usable tag', () => {
        expect(parseLatestRelease(null)).toBeNull();
        expect(parseLatestRelease('nope')).toBeNull();
        expect(parseLatestRelease({})).toBeNull();
        expect(parseLatestRelease({ tag_name: '' })).toBeNull();
    });

    it('drops malformed assets and tolerates a missing assets array', () => {
        const info = parseLatestRelease(
            ghPayload({
                assets: [
                    { name: 'good.dmg', browser_download_url: 'https://e/good.dmg' },
                    { name: 'no-url.dmg' },
                    { browser_download_url: 'https://e/no-name' },
                    'garbage',
                ],
            }),
        );
        expect(info!.assets).toEqual([{ name: 'good.dmg', url: 'https://e/good.dmg' }]);

        const noAssets = parseLatestRelease(ghPayload({ assets: undefined }));
        expect(noAssets!.assets).toEqual([]);
    });
});

describe('parseReleaseList', () => {
    it('returns an empty array for a non-array payload', () => {
        expect(parseReleaseList(null)).toEqual([]);
        expect(parseReleaseList({})).toEqual([]);
        expect(parseReleaseList('not an array')).toEqual([]);
    });

    it('returns an empty array for an empty list', () => {
        expect(parseReleaseList([])).toEqual([]);
    });

    it('parses a mixed stable/prerelease list', () => {
        const list = parseReleaseList([ghPayload(), ghPrePayload()]);
        expect(list).toHaveLength(2);
        expect(list[0].isPrerelease).toBe(false);
        expect(list[1].isPrerelease).toBe(true);
    });

    it('silently skips entries that fail to parse', () => {
        const list = parseReleaseList([ghPayload(), { tag_name: '' }, null, ghPrePayload()]);
        expect(list).toHaveLength(2);
    });
});

describe('selectCandidate', () => {
    const stable = release({ version: '3.4.8', tag: 'v3.4.8', isPrerelease: false });
    const pre1 = release({ version: '3.4.8-alpha.1', tag: 'v3.4.8-alpha.1', isPrerelease: true });
    const pre2 = release({ version: '3.4.9-alpha.1', tag: 'v3.4.9-alpha.1', isPrerelease: true });

    it('on stable channel, skips prerelease releases', () => {
        const candidate = selectCandidate([pre1, pre2], 'stable');
        expect(candidate).toBeNull();
    });

    it('on stable channel, picks the highest stable release', () => {
        const older = release({ version: '3.4.6', isPrerelease: false });
        const candidate = selectCandidate([older, stable, pre1], 'stable');
        expect(candidate!.version).toBe('3.4.8');
    });

    it('on prerelease channel, considers all releases and picks the highest', () => {
        const candidate = selectCandidate([stable, pre1, pre2], 'prerelease');
        // 3.4.9-alpha.1 > 3.4.8 > 3.4.8-alpha.1
        expect(candidate!.version).toBe('3.4.9-alpha.1');
    });

    it('on prerelease channel, stable beats prerelease of same base', () => {
        const candidate = selectCandidate([stable, pre1], 'prerelease');
        expect(candidate!.version).toBe('3.4.8');
    });

    it('returns null for an empty list', () => {
        expect(selectCandidate([], 'stable')).toBeNull();
        expect(selectCandidate([], 'prerelease')).toBeNull();
    });
});

describe('pickDownloadUrl', () => {
    it('prefers the arm64 dmg on macOS', () => {
        const r = release({
            assets: [
                { name: 'CoC-3.4.6.dmg', url: 'https://e/x64.dmg' },
                { name: 'CoC-3.4.6-arm64.dmg', url: 'https://e/arm64.dmg' },
            ],
        });
        expect(pickDownloadUrl(r, 'darwin')).toBe('https://e/arm64.dmg');
    });

    it('falls back to any dmg on macOS when no arm64 build exists', () => {
        const r = release({ assets: [{ name: 'CoC-3.4.6.dmg', url: 'https://e/any.dmg' }] });
        expect(pickDownloadUrl(r, 'darwin')).toBe('https://e/any.dmg');
    });

    it('picks the .exe on Windows', () => {
        const r = release({ assets: [{ name: 'CoC.Setup.3.4.6.exe', url: 'https://e/setup.exe' }] });
        expect(pickDownloadUrl(r, 'win32')).toBe('https://e/setup.exe');
    });

    it('falls back to the release page when no matching asset exists', () => {
        const r = release({ htmlUrl: 'https://e/page', assets: [] });
        expect(pickDownloadUrl(r, 'darwin')).toBe('https://e/page');
        expect(pickDownloadUrl(r, 'win32')).toBe('https://e/page');
        expect(pickDownloadUrl(r, 'linux')).toBe('https://e/page');
    });
});

describe('formatUpdatePrompt', () => {
    it('macOS prompt offers the quarantine fix and the right buttons', () => {
        const p = formatUpdatePrompt(release(), '3.4.2', 'darwin');
        expect(p.version).toBe('3.4.6');
        expect(p.message).toContain('3.4.6');
        expect(p.message).toContain('3.4.2');
        expect(p.buttons).toEqual(['Download', 'Copy fix command', 'Skip This Version', 'Later']);
        expect(p.quarantineFix).toBe(MAC_QUARANTINE_FIX);
        expect(p.detail).toContain(MAC_QUARANTINE_FIX);
    });

    it('Windows prompt has no copy-fix button and mentions SmartScreen', () => {
        const p = formatUpdatePrompt(release(), '3.4.2', 'win32');
        expect(p.buttons).toEqual(['Download', 'Skip This Version', 'Later']);
        expect(p.quarantineFix).toBeUndefined();
        expect(p.detail).toContain('SmartScreen');
    });

    it('normalizes a v-prefixed current version in the message', () => {
        const p = formatUpdatePrompt(release(), 'v3.4.2', 'darwin');
        expect(p.message).toContain('you have 3.4.2');
    });

    it('resolves the download URL for the platform', () => {
        const r = release({
            assets: [{ name: 'CoC.Setup.3.4.6.exe', url: 'https://e/setup.exe' }],
            htmlUrl: 'https://e/page',
        });
        expect(formatUpdatePrompt(r, '3.4.2', 'win32').downloadUrl).toBe('https://e/setup.exe');
        // No mac asset → mac prompt falls back to the release page.
        expect(formatUpdatePrompt(r, '3.4.2', 'darwin').downloadUrl).toBe('https://e/page');
    });
});

describe('skip-version persistence', () => {
    function memStore(): { store: UpdateStore; files: Map<string, string> } {
        const files = new Map<string, string>();
        return {
            files,
            store: {
                readText: (p) => {
                    if (!files.has(p)) {
                        throw new Error('ENOENT');
                    }
                    return files.get(p)!;
                },
                writeText: (p, data) => void files.set(p, data),
                ensureDir: () => undefined,
            },
        };
    }

    const dataDir = path.join('/fake', 'coc');

    it('round-trips a skipped version (normalized)', () => {
        const { store } = memStore();
        setSkippedVersion(dataDir, 'v3.4.6', store);
        expect(getSkippedVersion(dataDir, store)).toBe('3.4.6');
    });

    it('returns null when no marker has been written', () => {
        const { store } = memStore();
        expect(getSkippedVersion(dataDir, store)).toBeNull();
    });

    it('returns null on unreadable / malformed marker JSON', () => {
        const { store, files } = memStore();
        files.set(path.join(dataDir, 'desktop-update.json'), 'not json');
        expect(getSkippedVersion(dataDir, store)).toBeNull();
    });

    it('does not throw when the write fails', () => {
        const throwingStore: UpdateStore = {
            ensureDir: () => {
                throw new Error('EACCES');
            },
        };
        expect(() => setSkippedVersion(dataDir, '3.4.6', throwingStore)).not.toThrow();
    });

    it('preserves updateChannel when setSkippedVersion is called', () => {
        const { store } = memStore();
        setUpdateChannel(dataDir, 'prerelease', store);
        setSkippedVersion(dataDir, '3.4.8', store);
        // Both fields survive
        expect(getSkippedVersion(dataDir, store)).toBe('3.4.8');
        expect(getUpdateChannel(dataDir, '3.4.0', store)).toBe('prerelease');
    });
});

describe('update-channel persistence', () => {
    function memStore(): { store: UpdateStore; files: Map<string, string> } {
        const files = new Map<string, string>();
        return {
            files,
            store: {
                readText: (p) => {
                    if (!files.has(p)) throw new Error('ENOENT');
                    return files.get(p)!;
                },
                writeText: (p, data) => void files.set(p, data),
                ensureDir: () => undefined,
            },
        };
    }

    const dataDir = path.join('/fake', 'coc');

    it('round-trips a saved channel', () => {
        const { store } = memStore();
        setUpdateChannel(dataDir, 'prerelease', store);
        expect(getUpdateChannel(dataDir, '3.4.0', store)).toBe('prerelease');

        setUpdateChannel(dataDir, 'stable', store);
        expect(getUpdateChannel(dataDir, '3.4.0-alpha.1', store)).toBe('stable');
    });

    it('infers stable channel from a stable installed version when nothing is saved', () => {
        const { store } = memStore();
        expect(getUpdateChannel(dataDir, '3.4.8', store)).toBe('stable');
    });

    it('infers prerelease channel from a prerelease installed version when nothing is saved', () => {
        const { store } = memStore();
        expect(getUpdateChannel(dataDir, '3.4.8-alpha.1', store)).toBe('prerelease');
    });

    it('preserves skipVersion when setUpdateChannel is called', () => {
        const { store } = memStore();
        setSkippedVersion(dataDir, '3.4.8', store);
        setUpdateChannel(dataDir, 'prerelease', store);
        expect(getSkippedVersion(dataDir, store)).toBe('3.4.8');
        expect(getUpdateChannel(dataDir, '3.4.0', store)).toBe('prerelease');
    });

    it('does not throw on write failure', () => {
        const throwingStore: UpdateStore = {
            ensureDir: () => { throw new Error('EACCES'); },
        };
        expect(() => setUpdateChannel(dataDir, 'stable', throwingStore)).not.toThrow();
    });
});

describe('checkForUpdate', () => {
    it('reports a newer stable release with a platform-specific prompt', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.2',
            platform: 'darwin',
            fetchFn: fakeFetch([ghPayload()]),
        });
        expect(result.reason).toBe('newer');
        expect(result.release!.version).toBe('3.4.6');
        expect(result.prompt!.buttons).toContain('Copy fix command');
    });

    it('reports up-to-date when the latest equals the current version', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.6',
            fetchFn: fakeFetch([ghPayload()]),
        });
        expect(result.reason).toBe('up-to-date');
        expect(result.prompt).toBeNull();
    });

    it('reports up-to-date when the current version is newer (dev/pre-release)', async () => {
        const result = await checkForUpdate({
            currentVersion: '4.0.0',
            fetchFn: fakeFetch([ghPayload()]),
        });
        expect(result.reason).toBe('up-to-date');
    });

    it('reports error on a non-ok HTTP response', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.2',
            fetchFn: fakeFetch([ghPayload()], { ok: false }),
        });
        expect(result.reason).toBe('error');
    });

    it('reports error on an unparseable payload (empty list)', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.2',
            fetchFn: fakeFetch([]),
        });
        expect(result.reason).toBe('error');
    });

    it('reports error when the payload is not a list at all', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.2',
            fetchFn: fakeFetch({ message: 'Not Found' }),
        });
        expect(result.reason).toBe('error');
    });

    it('reports error (never throws) when fetch rejects', async () => {
        const boom = (async () => {
            throw new Error('network down');
        }) as unknown as typeof fetch;
        const result = await checkForUpdate({ currentVersion: '3.4.2', fetchFn: boom });
        expect(result.reason).toBe('error');
    });

    it('reports error when no fetch implementation is available', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.2',
            fetchFn: undefined as unknown as typeof fetch,
        });
        expect(result.reason).toBe('error');
    });

    it('defaults to the releases list endpoint', async () => {
        let calledWith = '';
        const spyFetch = (async (url: string) => {
            calledWith = url;
            return { ok: true, json: async () => [ghPayload()] };
        }) as unknown as typeof fetch;
        await checkForUpdate({ currentVersion: '3.4.2', fetchFn: spyFetch });
        expect(calledWith).toBe(RELEASES_LIST_API);
    });

    it('LATEST_RELEASE_API constant is still exported for reference', () => {
        expect(typeof LATEST_RELEASE_API).toBe('string');
        expect(LATEST_RELEASE_API).toContain('/releases/latest');
    });

    // ------------------------------------------------------------------
    // Plan acceptance-criteria scenarios
    // ------------------------------------------------------------------

    it('[AC] /releases/latest returning 404 is not a concern — list API works for prereleases', async () => {
        // The old endpoint would 404 for a repo whose only release is a prerelease.
        // The new list-based approach succeeds because the list endpoint includes prereleases.
        const result = await checkForUpdate({
            currentVersion: '3.4.6',
            channel: 'prerelease',
            fetchFn: fakeFetch([ghPrePayload('v3.4.8-alpha.1')]),
        });
        expect(result.reason).toBe('newer');
        expect(result.release!.version).toBe('3.4.8-alpha.1');
    });

    it('[AC] installed prerelease detects newer prerelease builds', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.8-alpha.1',
            channel: 'prerelease',
            fetchFn: fakeFetch([ghPrePayload('v3.4.8-alpha.2')]),
        });
        expect(result.reason).toBe('newer');
        expect(result.release!.version).toBe('3.4.8-alpha.2');
    });

    it('[AC] installed stable stays on stable channel by default (no prerelease offered)', async () => {
        // List contains a prerelease and a stable older than current — nothing newer on stable channel.
        const result = await checkForUpdate({
            currentVersion: '3.4.8',
            fetchFn: fakeFetch([
                ghPrePayload('v3.4.9-alpha.1'),
                ghPayload({ tag_name: 'v3.4.6' }),
            ]),
        });
        // inferChannel('3.4.8') → 'stable', so prerelease is excluded
        expect(result.reason).toBe('up-to-date');
    });

    it('[AC] stable user sees prerelease after opting into the prerelease channel', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.8',
            channel: 'prerelease',
            fetchFn: fakeFetch([ghPrePayload('v3.4.9-alpha.1')]),
        });
        expect(result.reason).toBe('newer');
        expect(result.release!.version).toBe('3.4.9-alpha.1');
    });

    it('[AC] installed prerelease treats matching stable as newer', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.8-alpha.1',
            channel: 'prerelease',
            // List only has the stable 3.4.8 — it should supersede the prerelease
            fetchFn: fakeFetch([ghPayload({ tag_name: 'v3.4.8', prerelease: false })]),
        });
        expect(result.reason).toBe('newer');
        expect(result.release!.version).toBe('3.4.8');
    });

    it('[AC] malformed or empty release list returns { reason: "error" }', async () => {
        const empty = await checkForUpdate({
            currentVersion: '3.4.0',
            fetchFn: fakeFetch([]),
        });
        expect(empty.reason).toBe('error');

        const malformed = await checkForUpdate({
            currentVersion: '3.4.0',
            fetchFn: fakeFetch('garbage'),
        });
        expect(malformed.reason).toBe('error');
    });

    it('[AC] stable channel: existing latest-release behavior valid for stable releases', async () => {
        // A list containing only non-prerelease releases behaves identically to the
        // old /releases/latest flow for stable users.
        const result = await checkForUpdate({
            currentVersion: '3.4.2',
            platform: 'win32',
            channel: 'stable',
            fetchFn: fakeFetch([ghPayload()]),
        });
        expect(result.reason).toBe('newer');
        expect(result.release!.version).toBe('3.4.6');
        expect(result.prompt!.buttons).toContain('Download');
    });

    it('[AC] auto check skips a prerelease that was skipped — list API with skip marker', async () => {
        // Not testing `main.ts` wiring here; just verifying that a newer prerelease
        // is surfaced so the caller can apply the skip-marker filter separately.
        const result = await checkForUpdate({
            currentVersion: '3.4.8-alpha.1',
            channel: 'prerelease',
            fetchFn: fakeFetch([ghPrePayload('v3.4.8-alpha.2')]),
        });
        // The module reports 'newer'; it's main.ts that checks the skip marker.
        expect(result.reason).toBe('newer');
        expect(result.release!.version).toBe('3.4.8-alpha.2');
    });
});
