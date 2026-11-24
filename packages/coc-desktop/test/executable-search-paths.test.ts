/**
 * Installation-wide executable search paths for the desktop-started server.
 *
 * REGRESSION: a Finder/Dock-launched macOS app inherits launchd's minimal
 * PATH, so the forked server (and the PR tools it runs) could not find
 * Homebrew's `/opt/homebrew/bin/gh`. The default macOS list now includes the
 * Homebrew folders and the forked server's PATH gains them after the
 * inherited PATH.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
    EXECUTABLE_PATHS_FILENAME,
    MAX_EXECUTABLE_PATHS,
    appendExecutableSearchPaths,
    defaultExecutableSearchPaths,
    getExecutablePathsState,
    pathEnvKey,
    readExecutableSearchPaths,
    saveExecutablePaths,
    validateExecutableSearchPaths,
    writeExecutableSearchPaths,
} from '../src/executable-search-paths';
import { buildServerEnv } from '../src/server-controller';

const identity = (value: string) => value;
const LAUNCHD_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

describe('defaultExecutableSearchPaths', () => {
    it('includes the Homebrew folders on macOS', () => {
        const defaults = defaultExecutableSearchPaths({ platform: 'darwin' });
        expect(defaults.slice(0, 2)).toEqual(['/opt/homebrew/bin', '/opt/homebrew/sbin']);
        expect(defaults).toContain('/usr/local/bin');
    });

    it('uses common Linux install folders', () => {
        const defaults = defaultExecutableSearchPaths({ platform: 'linux' });
        expect(defaults).toEqual(expect.arrayContaining(['/usr/local/bin', '~/.local/bin', '/home/linuxbrew/.linuxbrew/bin', '/snap/bin']));
    });

    it('builds Windows folders from the environment with any key spelling', () => {
        const defaults = defaultExecutableSearchPaths({
            platform: 'win32',
            env: { PROGRAMFILES: 'D:\\Apps', LocalAppData: 'C:\\Users\\me\\AppData\\Local' },
        });
        expect(defaults).toEqual([
            'D:\\Apps\\GitHub CLI',
            'D:\\Apps\\Git\\cmd',
            'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links',
        ]);
        expect(defaultExecutableSearchPaths({ platform: 'win32', env: {} })).toEqual([
            'C:\\Program Files\\GitHub CLI',
            'C:\\Program Files\\Git\\cmd',
        ]);
    });

    it('produces only entries that pass validation on each platform', () => {
        for (const platform of ['darwin', 'linux', 'win32'] as const) {
            const defaults = defaultExecutableSearchPaths({ platform, env: { LOCALAPPDATA: 'C:\\L' } });
            expect(validateExecutableSearchPaths(defaults, platform)).toEqual({ paths: defaults, errors: [] });
        }
    });
});

describe('validateExecutableSearchPaths', () => {
    it('trims, drops blank rows and removes duplicates', () => {
        expect(validateExecutableSearchPaths([' /opt/homebrew/bin ', '', '   ', '/opt/homebrew/bin', '~/bin'], 'darwin'))
            .toEqual({ paths: ['/opt/homebrew/bin', '~/bin'], errors: [] });
    });

    it('treats Windows duplicates case-insensitively', () => {
        expect(validateExecutableSearchPaths(['C:\\Tools', 'c:\\tools'], 'win32').paths).toEqual(['C:\\Tools']);
    });

    it('reports bad rows by index', () => {
        const { errors } = validateExecutableSearchPaths(['relative/bin', '/a:/b', 7, '/ok', 'x\ny'], 'darwin');
        expect(errors.map(error => error.index)).toEqual([0, 1, 2, 4]);
        expect(errors[1].message).toContain('":"');
    });

    it('allows a Windows drive letter but rejects joined Windows folders', () => {
        expect(validateExecutableSearchPaths(['C:\\Tools'], 'win32').errors).toEqual([]);
        expect(validateExecutableSearchPaths(['bin\\gh'], 'win32').errors).toHaveLength(1);
        expect(validateExecutableSearchPaths(['C:\\A;C:\\B'], 'win32').errors[0].message).toContain('";"');
    });

    it('rejects a non-list and too many entries', () => {
        expect(validateExecutableSearchPaths('/opt/bin', 'darwin').errors[0].index).toBeNull();
        const many = Array.from({ length: MAX_EXECUTABLE_PATHS + 1 }, (_, i) => `/p${i}`);
        expect(validateExecutableSearchPaths(many, 'darwin').errors).toEqual([expect.objectContaining({ index: null })]);
    });
});

describe('stored setting', () => {
    let dataDir: string;
    beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-exec-paths-')); });
    afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

    it('falls back to OS defaults when nothing is saved', () => {
        expect(readExecutableSearchPaths(dataDir, { platform: 'darwin' }))
            .toEqual({ paths: defaultExecutableSearchPaths({ platform: 'darwin' }), custom: false });
    });

    it('round-trips a custom list, including an empty one, and restores defaults on null', () => {
        writeExecutableSearchPaths(dataDir, ['/custom/bin']);
        expect(readExecutableSearchPaths(dataDir, { platform: 'darwin' })).toEqual({ paths: ['/custom/bin'], custom: true });
        writeExecutableSearchPaths(dataDir, []);
        expect(readExecutableSearchPaths(dataDir, { platform: 'darwin' })).toEqual({ paths: [], custom: true });
        writeExecutableSearchPaths(dataDir, null);
        expect(fs.existsSync(path.join(dataDir, EXECUTABLE_PATHS_FILENAME))).toBe(false);
        expect(readExecutableSearchPaths(dataDir, { platform: 'darwin' }).custom).toBe(false);
    });

    it('uses defaults for a corrupt or invalid file so server start never fails', () => {
        const file = path.join(dataDir, EXECUTABLE_PATHS_FILENAME);
        fs.writeFileSync(file, '{not json');
        expect(readExecutableSearchPaths(dataDir, { platform: 'linux' }).custom).toBe(false);
        fs.writeFileSync(file, JSON.stringify({ version: 1, paths: ['relative'] }));
        expect(readExecutableSearchPaths(dataDir, { platform: 'linux' }).custom).toBe(false);
    });

    it('saves valid input and reports when the owned server needs a restart', () => {
        const server = { ownership: 'owned' as const, appliedPaths: defaultExecutableSearchPaths({ platform: 'darwin' }) };
        expect(getExecutablePathsState(dataDir, server, { platform: 'darwin' }).restartRequired).toBe(false);
        const saved = saveExecutablePaths(dataDir, ['/opt/homebrew/bin', ' '], server, { platform: 'darwin' });
        expect(saved).toEqual({ ok: true, state: expect.objectContaining({ paths: ['/opt/homebrew/bin'], custom: true, restartRequired: true }) });
        const reset = saveExecutablePaths(dataDir, null, server, { platform: 'darwin' });
        expect(reset).toEqual({ ok: true, state: expect.objectContaining({ custom: false, restartRequired: false }) });
    });

    it('keeps the saved list when input is invalid', () => {
        writeExecutableSearchPaths(dataDir, ['/keep']);
        const result = saveExecutablePaths(dataDir, ['/ok', 'bad'], { ownership: 'owned', appliedPaths: [] }, { platform: 'darwin' });
        expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'invalid', errors: [expect.objectContaining({ index: 1 })] }));
        expect(readExecutableSearchPaths(dataDir, { platform: 'darwin' }).paths).toEqual(['/keep']);
    });

    it('never asks an attached external server to restart', () => {
        writeExecutableSearchPaths(dataDir, ['/custom/bin']);
        const state = getExecutablePathsState(dataDir, { ownership: 'external', appliedPaths: ['/x'] }, { platform: 'darwin' });
        expect(state.server).toEqual({ ownership: 'external', appliedPaths: null });
        expect(state.restartRequired).toBe(false);
    });
});

describe('PATH composition', () => {
    it('appends configured folders after the inherited PATH and skips ones already present', () => {
        expect(appendExecutableSearchPaths(LAUNCHD_PATH, ['/opt/homebrew/bin', '/usr/bin', '~/.local/bin'], { platform: 'darwin', homeDir: '/Users/me' }))
            .toBe(`${LAUNCHD_PATH}:/opt/homebrew/bin:/Users/me/.local/bin`);
    });

    it('handles an empty inherited PATH and Windows separators/case', () => {
        expect(appendExecutableSearchPaths('', ['/opt/homebrew/bin'], { platform: 'darwin' })).toBe('/opt/homebrew/bin');
        expect(appendExecutableSearchPaths('C:\\Windows;C:\\TOOLS', ['c:\\tools', 'C:\\Gh', '~\\bin'], { platform: 'win32', homeDir: 'C:\\Users\\me' }))
            .toBe('C:\\Windows;C:\\TOOLS;C:\\Gh;C:\\Users\\me\\bin');
    });

    it('keeps bundled folders first, the inherited PATH next, configured folders last', () => {
        const env = buildServerEnv({ PATH: '/usr/local/bin:/usr/bin', HOME: '/h' }, ['/opt/homebrew/bin', '/usr/local/bin'], 'darwin',
            base => ['/bundle/copilot', base].join(':'));
        expect(env.PATH).toBe('/bundle/copilot:/usr/local/bin:/usr/bin:/opt/homebrew/bin');
        expect(env.HOME).toBe('/h');
    });

    it('keeps the inherited Windows Path spelling and never adds a second PATH key', () => {
        const env = buildServerEnv({ Path: 'C:\\Windows' }, ['C:\\Program Files\\GitHub CLI'], 'win32', identity);
        expect(Object.keys(env).filter(key => key.toUpperCase() === 'PATH')).toEqual(['Path']);
        expect(env.Path).toBe('C:\\Windows;C:\\Program Files\\GitHub CLI');
        expect(pathEnvKey({}, 'win32')).toBe('Path');
        expect(pathEnvKey({ Path: 'x' }, 'linux')).toBe('PATH');
    });

    it('leaves PATH unchanged with no configured folders', () => {
        expect(buildServerEnv({ PATH: LAUNCHD_PATH }, [], 'darwin', identity).PATH).toBe(LAUNCHD_PATH);
    });

    // Real process: a child started with a launchd-style PATH finds a tool
    // only through the configured folder, as a forked server's PR tool would.
    it.skipIf(process.platform === 'win32')('lets a child process with a minimal PATH resolve a tool in a configured folder', () => {
        const toolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-exec-tool-'));
        try {
            const tool = path.join(toolDir, 'coc-fake-gh');
            fs.writeFileSync(tool, '#!/bin/sh\necho fake-gh-ok\n');
            fs.chmodSync(tool, 0o755);
            const minimal = { PATH: LAUNCHD_PATH };
            expect(() => execFileSync('coc-fake-gh', [], { env: buildServerEnv(minimal, [], process.platform, identity) })).toThrow();
            const env = buildServerEnv(minimal, [toolDir], process.platform, identity);
            // The server's own children (here /bin/sh) inherit the same PATH.
            expect(execFileSync('/bin/sh', ['-c', 'coc-fake-gh'], { env, encoding: 'utf8' }).trim()).toBe('fake-gh-ok');
        } finally {
            fs.rmSync(toolDir, { recursive: true, force: true });
        }
    });
});
