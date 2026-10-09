import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadNativeGit } from '../src/git';

const api = loadNativeGit();
const patch = 'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n' +
    '--- "a/caf\\303\\251.txt"\n+++ "b/caf\\303\\251.txt"\n' +
    '@@ -1 +1 @@\n---body\n+++body\n';

it.each(['refresh', 'dispose'] as const)('stops running host patches on %s without blocking Node', async action => {
    for (const workingTree of [false, true]) {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'patch-cancel-')));
        const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
        const started = path.join(root, 'started'), release = path.join(root, 'release');
        const finished = path.join(root, 'finished');
        const quote = (value: string) => `'${value.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
        const helper = path.join(root, 'blocking.cjs');
        fs.writeFileSync(helper, `
const fs = require('node:fs'), path = require('node:path');
const root = process.argv[2];
fs.writeFileSync(path.join(root, 'started'), 'ready');
const deadline = Date.now() + 10000;
const timer = setInterval(() => {
    if (fs.existsSync(path.join(root, 'release')) || Date.now() >= deadline) {
        clearInterval(timer);
        fs.writeFileSync(path.join(root, 'finished'), 'done');
    }
}, 5);
`);
        git('init', '--initial-branch=main');
        for (const [key, value] of [
            ['user.name', 'Test'], ['user.email', 'test@example.com'],
            ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'],
            ['diff.block.textconv', `${quote(process.execPath)} ${quote(helper)} ${quote(root)}`],
        ]) git('config', key, value);
        fs.writeFileSync(path.join(root, '.gitattributes'), '*.txt diff=block\n');
        fs.writeFileSync(path.join(root, 'same.txt'), 'one\n');
        git('add', '.');
        git('commit', '-qm', 'fixture');
        fs.writeFileSync(path.join(root, 'same.txt'), 'two\n');
        const store = api.openGitPatchStore('cancel', root);
        const independent = api.openGitPatchStore('other', root);
        let pending: Promise<unknown> | undefined;
        try {
            pending = workingTree ? store.workingTreePatch('all') : store.revisionPatch('show', 'HEAD', null, 'same.txt', null, null, { timeout: 0 });
            const rejection = expect(pending).rejects.toThrow(action === 'refresh' ? 'Stale' : 'Closed');
            await expect.poll(() => fs.existsSync(started)).toBe(true);
            store[action]();
            // The blocked helper is released only in finally; completion proves
            // revocation stops Git rather than waiting for its normal output.
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([rejection, new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('revoked Git did not stop')), 2000);
                })]);
            } finally {
                clearTimeout(timer);
            }
            expect((await independent.revisionPatch('commit', 'HEAD')).files.find(file => file.path === 'same.txt'))
                .toMatchObject({ additions: 1 });
            if (action === 'refresh') {
                git('config', '--unset', 'diff.block.textconv');
                await expect(store.revisionPatch('show', 'HEAD', null, 'same.txt')).resolves.toMatchObject({ summary: { additions: 1 } });
            } else {
                await expect(store.revisionPatch('show', 'missing')).rejects.toThrow('Closed');
            }
        } finally {
            store.dispose();
            independent.dispose();
            fs.writeFileSync(release, '');
            await pending?.catch(() => undefined);
            if (fs.existsSync(started)) await expect.poll(() => fs.existsSync(finished)).toBe(true);
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
});

describe('parseGitPatch worker boundary', () => {
    it('exposes the Rust root/first-parent commit plan on a worker', async () => {
        const pending = api.prepareGitCommitPatch('HEAD', '[ab].txt', 0);
        expect(typeof pending.then).toBe('function');
        const args = await pending;
        expect(args).toEqual([
            '--literal-pathspecs', 'diff-tree', '--root', '--first-parent', '-m', '-r', '-p',
            '--no-commit-id', '-M', '-C', '--no-color', '--src-prefix=a/', '--dst-prefix=b/',
            '-U0', '--end-of-options', 'HEAD', '--', '[ab].txt',
        ]);
    });

    it('shares a NUL metadata batch and worker join for literal rename paths', async () => {
        const batch = await api.prepareGitCommitFiles('HEAD');
        expect(batch).toHaveLength(3);
        batch.slice(0, 2).forEach(args => {
            expect(args).toEqual(expect.arrayContaining(['--root', '--first-parent', '-z', '--end-of-options']));
            expect(args).not.toContain('-p');
        });
        expect(batch[0]).toContain('--name-status');
        expect(batch[1]).toContain('--numstat');
        const pending = api.processGitCommitMetadata('R100\0old\0café\t\n.txt\0M\0bin\0', '2\t1\t\0old\0café\t\n.txt\0-\t-\tbin\0', 'first second\n');
        expect(typeof pending.then).toBe('function');
        expect(await pending).toEqual({ parentHash: 'first', files: [
            { path: 'café\t\n.txt', originalPath: 'old', status: 'renamed', additions: 2, deletions: 1 },
            { path: 'bin', status: 'modified' },
        ] });
        expect(batch[2]).toEqual(['log', '-1', '--format=%P', '--no-show-signature', '--end-of-options', 'HEAD', '--']);
        expect((await api.processGitCommitMetadata('', '', '')).parentHash).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    });

    it('decodes Git quoting, counts header-like content and preserves bytes', async () => {
        const pending = api.parseGitPatch(patch);
        expect(typeof pending.then).toBe('function');
        const [file] = await pending;
        expect(file).toEqual({
            path: 'café.txt', status: 'modified', additions: 1, deletions: 1,
            isBinary: false, raw: patch, totalLines: patch.split('\n').length,
        });
        expect(file).not.toHaveProperty('originalPath');
    });

    it('carries optional rename paths, mode-only and explicit binary classification', async () => {
        const rename = 'diff --git a/old b/new\nsimilarity index 100%\nrename from old\nrename to new\n';
        const mode = 'diff --git a/mode b/mode\nold mode 100644\nnew mode 100755\n';
        const binary = 'diff --git a/bin b/bin\nBinary files a/bin and b/bin differ\n';
        const files = await api.parseGitPatch(rename + mode + binary);
        expect(files.map(file => file.path)).toEqual(['new', 'mode', 'bin']);
        expect(files[0]).toMatchObject({ originalPath: 'old', status: 'renamed', isBinary: false });
        expect(files[1]).toMatchObject({ status: 'modified', isBinary: false, raw: mode });
        expect(files[2].isBinary).toBe(true);
    });

    it('handles empty, malformed and preamble-only input', async () => {
        for (const raw of ['', ' \n ', 'commit deadbeef\n', 'diff --git "bad b/x\n']) {
            await expect(api.parseGitPatch(raw)).resolves.toEqual([]);
        }
    });

    it('preserves CRLF and missing final newline without command-runner trimming', async () => {
        for (const raw of [patch.replaceAll('\n', '\r\n'), patch.slice(0, -1)]) {
            const files = await api.parseGitPatch(raw);
            expect(files[0].raw).toBe(raw);
            expect(files[0].totalLines).toBe(raw.split('\n').length);
        }
    });

    it('isolates concurrent supplied sources with the same relative path', async () => {
        const patches = Array.from({ length: 20 }, (_, i) =>
            `diff --git a/same b/same\n@@ -0,0 +1 @@\n+source ${i}\n`);
        const results = await Promise.all(patches.map(raw => api.parseGitPatch(raw)));
        expect(results.map(files => files[0].raw)).toEqual(patches);
    });

    it('allows the event loop to progress during substantial parsing', async () => {
        const large = patch.replace('+++body\n', '+body\n'.repeat(150_000));
        let turns = 0;
        let running = true;
        function tick() {
            if (!running) return;
            turns++;
            setImmediate(tick);
        }
        setImmediate(tick);
        try {
            const [file] = await api.parseGitPatch(large);
            expect(file.additions).toBe(150_000);
            expect(turns).toBeGreaterThan(0);
        } finally {
            running = false;
        }
    });
});

it('exposes working-tree batch planning and composition on workers', async () => {
    const pending = api.prepareGitWorkingTreePatch('all', '[ab].txt', 0);
    expect(typeof pending.then).toBe('function');
    const batch = await pending;
    expect(batch).toHaveLength(2);
    expect(batch[0]).toContain('--cached');
    expect(batch[1]).not.toContain('--cached');
    batch.forEach(args => expect(args).toEqual(expect.arrayContaining(['--literal-pathspecs', '-U0', '[ab].txt'])));
    const result = await api.composeGitWorkingTreePatch([patch, patch.replace('+++body', '+new\n+extra')], 2);
    expect(result.files).toHaveLength(1);
    expect(result.summary).toEqual({ filesChanged: 1, additions: 2, deletions: 1 });
    expect(result.files[0].raw).toContain('+++body');
    expect(result.files[0].raw).toContain('+extra');
    expect(result.content.truncated).toBe(true);
    await expect(api.prepareGitWorkingTreePatch('invalid')).rejects.toThrow('invalid working-tree scope');
});

it('composes pending headings on a worker without parsing them as file content', async () => {
    const pending = api.composeGitWorkingTreePatch([patch, ''], undefined, true);
    expect(typeof pending.then).toBe('function');
    const result = await pending;
    expect(result.content.raw).toBe(`# Staged Changes\n\n${patch}`);
    expect(result.files[0].raw).toBe(patch);
    expect(result.summary).toEqual((await api.composeGitWorkingTreePatch([patch, ''])).summary);
});

it('consumes composition tickets once and isolates remote processing from local batches', async () => {
    const store = api.openGitPatchStore('batch', tmpdir());
    try {
        const ticket = store.beginTransport();
        const result = await ticket.processWorkingTree([patch, ''], 1, true);
        expect(result.content.truncated).toBe(true);
        expect(result.content.totalLines).toBe(`# Staged Changes\n\n${patch}`.split('\n').length);
        expect(() => ticket.processWorkingTree([patch])).toThrow('Closed');
        const cancelled = store.beginTransport();
        cancelled.cancel();
        expect(() => cancelled.processWorkingTree([patch])).toThrow('Closed');
        const remote = api.openRemoteGitPatchStore('batch', tmpdir(), {
            provider: 'github', host: 'github.com', repository: 'github:example/repo', sourceId: 'pr:1',
        });
        try {
            await expect(remote.beginTransport().processWorkingTree([patch])).rejects.toThrow('InvalidIdentity');
            await expect(remote.workingTreePatch('all')).rejects.toThrow('InvalidIdentity');
        } finally {
            remote.dispose();
        }
    } finally {
        store.dispose();
    }
});

it('plans direct comparisons separately from three-dot branch ranges on a worker', async () => {
    const pending = api.prepareGitComparisonPatch('base', 'head', '[ab].txt', 99999);
    expect(typeof pending.then).toBe('function');
    const args = await pending;
    expect(args).toEqual([
        '--literal-pathspecs', 'diff', '-M', '-C', '--no-color', '--src-prefix=a/', '--dst-prefix=b/',
        '-U99999', '--end-of-options', 'base', 'head', '--', '[ab].txt',
    ]);
    expect(await api.prepareGitRangePatch('base', 'head')).toContain('base...head');
});
