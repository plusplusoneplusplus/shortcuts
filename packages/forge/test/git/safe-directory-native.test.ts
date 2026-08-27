/**
 * The async `safe.directory` ensure, running its two `git config --global`
 * calls in the native addon.
 *
 * These drive a real git rather than asserting which child process Node was
 * asked to start: `GIT_CONFIG_GLOBAL` points git at a temp file, so the ensure
 * genuinely reads and writes a global config and the assertions are about what
 * ended up in it. The developer's own `~/.gitconfig` is never touched.
 *
 * The path is win32-only in production — `resolveGitSafeDirectory` answers
 * `undefined` everywhere else — so `process.platform` is forced, which is what
 * the sibling suite has always done for the same reason.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded = vi.hoisted(() => ({ calls: [] as Array<{ fn: string; args: unknown[] }> }));

// A wrapper, not a replacement: the calls still reach the real addon and run
// real git, and the recording only exists to count them. Spreading `actual`
// keeps `NativeAddonLoadError` a real class, which `execGitAsync` narrows on.
vi.mock('@plusplusoneplusplus/coc-native', async importOriginal => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>();
    return {
        ...actual,
        loadNativeGit: () => {
            const addon = actual.loadNativeGit();
            return new Proxy(addon, {
                get(target, property, receiver) {
                    const value = Reflect.get(target, property, receiver);
                    if (property !== 'gitGlobalConfigGetAll' && property !== 'gitGlobalConfigAdd') {
                        return value;
                    }
                    return (...args: unknown[]) => {
                        recorded.calls.push({ fn: String(property), args });
                        return (value as (...rest: unknown[]) => unknown)(...args);
                    };
                },
            });
        },
    };
});

import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { clearGitSafeDirectoryCache, ensureGitSafeDirectoryAsync } from '../../src/git/safe-directory';

const REPO_ROOT = '\\\\wsl$\\Ubuntu-24.04\\home\\me\\repo';
const ENTRY = '%(prefix)///wsl$/Ubuntu-24.04/home/me/repo';

let configDir: string;
let configFile: string;
let originalPlatform: PropertyDescriptor | undefined;
let originalConfigGlobal: string | undefined;

/** Every `safe.directory` value in the temp global config, in file order. */
function configuredEntries(): string[] {
    if (!fs.existsSync(configFile)) return [];
    return fs
        .readFileSync(configFile, 'utf-8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith('directory ='))
        .map(line => line.slice('directory ='.length).trim());
}

beforeEach(() => {
    // Resolve the binary before `process.platform` is forced: the loader picks
    // the triple off the running platform, and a faked win32 would send it
    // looking for a Windows binary that this host has never had.
    loadNativeGit();
    recorded.calls.length = 0;
    clearGitSafeDirectoryCache();
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-safe-directory-'));
    configFile = path.join(configDir, 'gitconfig');
    originalConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = configFile;
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
});

afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    if (originalConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = originalConfigGlobal;
    fs.rmSync(configDir, { recursive: true, force: true });
    clearGitSafeDirectoryCache();
});

describe('ensureGitSafeDirectoryAsync on native', () => {
    it('appends the entry when the global config has none', async () => {
        await ensureGitSafeDirectoryAsync(REPO_ROOT);

        // The `$` and the `%(prefix)` sigil reach git unexpanded — no shell is
        // involved on either side of the boundary.
        expect(configuredEntries()).toEqual([ENTRY]);
    });

    it('leaves an already-configured entry alone', async () => {
        fs.writeFileSync(configFile, `[safe]\n\tdirectory = ${ENTRY}\n`);

        await ensureGitSafeDirectoryAsync(REPO_ROOT);

        expect(configuredEntries()).toEqual([ENTRY]);
        expect(recorded.calls.map(call => call.fn)).toEqual(['gitGlobalConfigGetAll']);
    });

    it('keeps every other approved repository when it appends', async () => {
        fs.writeFileSync(configFile, '[safe]\n\tdirectory = /already/approved\n');

        await ensureGitSafeDirectoryAsync(REPO_ROOT);

        expect(configuredEntries()).toEqual(['/already/approved', ENTRY]);
    });

    it('asks git once per entry and then answers from the cache', async () => {
        await ensureGitSafeDirectoryAsync(REPO_ROOT);
        await ensureGitSafeDirectoryAsync(REPO_ROOT);
        await ensureGitSafeDirectoryAsync(REPO_ROOT);

        expect(recorded.calls.map(call => call.fn)).toEqual([
            'gitGlobalConfigGetAll',
            'gitGlobalConfigAdd',
        ]);
        expect(configuredEntries()).toEqual([ENTRY]);
    });

    it('deduplicates concurrent ensures for the same repository', async () => {
        await Promise.all([
            ensureGitSafeDirectoryAsync(REPO_ROOT),
            ensureGitSafeDirectoryAsync(REPO_ROOT),
            ensureGitSafeDirectoryAsync(REPO_ROOT),
        ]);

        // Without the in-flight map each caller would read an empty list and
        // append, because `--add` never deduplicates.
        expect(configuredEntries()).toEqual([ENTRY]);
    });

    it('does nothing at all off win32', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        await ensureGitSafeDirectoryAsync(REPO_ROOT);

        // Not even a load: there is no entry to resolve, so the addon stays
        // untouched on the hosts where this whole path is dead.
        expect(recorded.calls).toEqual([]);
        expect(configuredEntries()).toEqual([]);
    });
});
