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
    parseLatestRelease,
    pickDownloadUrl,
    formatUpdatePrompt,
    getSkippedVersion,
    setSkippedVersion,
    checkForUpdate,
    MAC_QUARANTINE_FIX,
    LATEST_RELEASE_API,
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
        ...over,
    };
}

/** A GitHub-style /releases/latest payload, deliberately loosely typed. */
function ghPayload(over: Record<string, unknown> = {}): unknown {
    return {
        tag_name: 'v3.4.6',
        html_url: 'https://example.com/rel',
        body: 'release body',
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

describe('compareVersions', () => {
    it('orders by numeric segments, not lexically', () => {
        expect(compareVersions('3.4.10', '3.4.2')).toBe(1); // 10 > 2, not "10" < "2"
        expect(compareVersions('3.4.2', '3.4.10')).toBe(-1);
        expect(compareVersions('4.0.0', '3.9.9')).toBe(1);
    });

    it('treats equal versions as 0 and tolerates a leading v', () => {
        expect(compareVersions('3.4.6', '3.4.6')).toBe(0);
        expect(compareVersions('v3.4.6', '3.4.6')).toBe(0);
    });

    it('pads missing segments with 0 (3.4 === 3.4.0)', () => {
        expect(compareVersions('3.4', '3.4.0')).toBe(0);
        expect(compareVersions('3.4.1', '3.4')).toBe(1);
    });

    it('ignores a pre-release tail for ordering', () => {
        expect(compareVersions('3.4.6-beta.1', '3.4.6')).toBe(0);
        expect(compareVersions('3.5.0-rc.1', '3.4.6')).toBe(1);
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
});

describe('parseLatestRelease', () => {
    it('normalizes a well-formed payload', () => {
        const info = parseLatestRelease(ghPayload());
        expect(info).not.toBeNull();
        expect(info!.version).toBe('3.4.6');
        expect(info!.tag).toBe('v3.4.6');
        expect(info!.htmlUrl).toBe('https://example.com/rel');
        expect(info!.notes).toBe('release body');
        expect(info!.assets).toHaveLength(2);
        expect(info!.assets[0]).toEqual({
            name: 'CoC-3.4.6-arm64.dmg',
            url: 'https://example.com/CoC-3.4.6-arm64.dmg',
        });
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
});

describe('checkForUpdate', () => {
    it('reports a newer release with a platform-specific prompt', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.2',
            platform: 'darwin',
            fetchFn: fakeFetch(ghPayload()),
        });
        expect(result.reason).toBe('newer');
        expect(result.release!.version).toBe('3.4.6');
        expect(result.prompt!.buttons).toContain('Copy fix command');
    });

    it('reports up-to-date when the latest equals the current version', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.6',
            fetchFn: fakeFetch(ghPayload()),
        });
        expect(result.reason).toBe('up-to-date');
        expect(result.prompt).toBeNull();
    });

    it('reports up-to-date when the current version is newer (dev/pre-release)', async () => {
        const result = await checkForUpdate({
            currentVersion: '4.0.0',
            fetchFn: fakeFetch(ghPayload()),
        });
        expect(result.reason).toBe('up-to-date');
    });

    it('reports error on a non-ok HTTP response', async () => {
        const result = await checkForUpdate({
            currentVersion: '3.4.2',
            fetchFn: fakeFetch(ghPayload(), { ok: false }),
        });
        expect(result.reason).toBe('error');
    });

    it('reports error on an unparseable payload', async () => {
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

    it('defaults to the project releases endpoint', async () => {
        let calledWith = '';
        const spyFetch = (async (url: string) => {
            calledWith = url;
            return { ok: true, json: async () => ghPayload() };
        }) as unknown as typeof fetch;
        await checkForUpdate({ currentVersion: '3.4.2', fetchFn: spyFetch });
        expect(calledWith).toBe(LATEST_RELEASE_API);
    });
});
