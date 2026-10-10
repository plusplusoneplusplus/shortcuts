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

it('exposes revocation before transport submission without consuming independent tickets', async () => {
    const store = api.openGitPatchStore('transport-check', '/repo', 'Ubuntu');
    try {
        const request = store.beginTransport();
        const other = store.beginTransport();
        request.checkActive();
        request.checkActive();
        request.cancel();
        expect(() => request.checkActive()).toThrow('Cancelled');
        other.checkActive();
        await other.process(patch);
        expect(() => other.checkActive()).toThrow('Closed');
        const stale = store.beginTransport();
        store.refresh();
        expect(() => stale.checkActive()).toThrow('Stale');
        store.beginTransport().checkActive();
        const closed = store.beginTransport();
        store.dispose();
        expect(() => closed.checkActive()).toThrow('Closed');
    } finally {
        store.dispose();
    }
});

it.each(['wsl', 'remote'] as const)('rejects host request execution for %s scopes', async source => {
    const store = source === 'wsl' ? api.openGitPatchStore('host-rejection', '/repo', 'Ubuntu')
        : api.openRemoteGitPatchStore('host-rejection', tmpdir(), {
            provider: 'github', host: 'github.com', repository: 'github:example/repo', sourceId: 'pr:1',
        });
    try {
        await expect(store.beginTransport().revisionPatch('show', 'HEAD')).rejects.toThrow('InvalidIdentity');
        await expect(store.beginTransport().workingTreePatch('all')).rejects.toThrow('InvalidIdentity');
        expect((await store.beginTransport().process(patch)).files).toHaveLength(1);
    } finally {
        store.dispose();
    }
});

it.each([
    ['local', 'process'],
    ['local', 'processWorkingTree'],
    ['remote', 'process'],
] as const)('cancels submitted %s %s without revoking independent requests', async (source, method) => {
    const store = source === 'local' ? api.openGitPatchStore('request-cancellation', tmpdir()) :
        api.openRemoteGitPatchStore('request-cancellation', tmpdir(), {
            provider: 'github', host: 'github.com', repository: 'github:example/repo', sourceId: 'pr:1',
        });
    try {
        // Include a cache hit: cancellation also guards event-loop delivery
        // after the worker has already finished.
        await store.beginTransport().process(patch);
        if (source === 'local') await store.beginTransport().processWorkingTree([patch, '']);
        for (const raw of [patch, patch.replace('+++body', '+fresh')]) {
            const request = store.beginTransport();
            const independent = store.beginTransport();
            const pending = method === 'process' ? request.process(raw) : request.processWorkingTree([raw, '']);
            const other = method === 'process' ? independent.process(raw) : independent.processWorkingTree([raw, '']);
            request.cancel();
            request.cancel();
            await expect(pending).rejects.toThrow('Cancelled');
            expect((await other).files[0].raw).toBe(raw);
            expect(() => request.process(raw)).toThrow('Closed');
            expect((await store.beginTransport().process(raw)).content.raw).toBe(raw);
        }
    } finally {
        store.dispose();
    }
});

it.each(['cancel', 'refresh', 'dispose'] as const)('stops running host patches on %s without blocking Node', async action => {
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
            const ticket = store.beginTransport();
            const request = action === 'cancel' ? ticket : store;
            pending = workingTree ? request.workingTreePatch('all') : request.revisionPatch('show', 'HEAD', null, 'same.txt', null, null, { timeout: 0 });
            const rejection = expect(pending).rejects.toThrow(action === 'cancel' ? 'Cancelled' : action === 'refresh' ? 'Stale' : 'Closed');
            await expect.poll(() => fs.existsSync(started)).toBe(true);
            if (action === 'cancel') ticket.cancel();
            else store[action]();
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
            if (action !== 'dispose') {
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

it.each(['commit', 'show', 'range', 'comparison', 'working-tree'] as const)(
    'cancels queued and cached host %s results without closing same-store requests', async mode => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'patch-request-')));
        const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
        git('init', '--initial-branch=main');
        for (const [key, value] of [
            ['user.name', 'Test'], ['user.email', 'test@example.com'],
            ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'],
        ]) git('config', key, value);
        fs.writeFileSync(path.join(root, 'same.txt'), 'one\n');
        git('add', '.');
        git('commit', '-qm', 'initial');
        const base = git('rev-parse', 'HEAD').trim();
        fs.writeFileSync(path.join(root, 'same.txt'), 'two\n');
        git('add', '.');
        git('commit', '-qm', 'changed');
        fs.writeFileSync(path.join(root, 'same.txt'), 'disk\n');
        const store = api.openGitPatchStore('host-request', root);
        const read = (request: ReturnType<typeof store.beginTransport>) => mode === 'working-tree'
            ? request.workingTreePatch('all')
            : request.revisionPatch(mode, mode === 'range' || mode === 'comparison' ? base : 'HEAD',
                mode === 'range' || mode === 'comparison' ? 'HEAD' : undefined);
        try {
            for (let pass = 0; pass < 2; pass++) {
                const request = store.beginTransport();
                const pending = read(request);
                request.cancel();
                request.cancel();
                await expect(pending).rejects.toThrow('Cancelled');
                expect(() => read(request)).toThrow('Closed');
                const result = await read(store.beginTransport());
                expect(result.files[0].path).toBe('same.txt');
                expect(result.content.raw).toContain(mode === 'working-tree' ? '+disk' : '+two');
            }
            const unsent = store.beginTransport();
            unsent.cancel();
            expect(() => read(unsent)).toThrow('Closed');
        } finally {
            store.dispose();
            fs.rmSync(root, { recursive: true, force: true });
        }
    },
);

describe('parseGitPatch worker boundary', () => {
    it('exposes the Rust root/first-parent commit plan on a worker', async () => {
        const pending = api.prepareGitRevisionPatch('commit', 'HEAD', undefined, '[ab].txt', 0);
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

describe('prepareGitRevisionPatch worker boundary', () => {
    it.each(['commit', 'show', 'range', 'comparison'] as const)(
        'plans %s with literal paths, option boundaries and nullable defaults', async mode => {
            const prefix = mode === 'commit'
                ? ['diff-tree', '--root', '--first-parent', '-m', '-r', '-p', '--no-commit-id']
                : mode === 'show' ? ['show', '--format=', '--patch'] : ['diff'];
            for (const options of [
                { base: 'base', head: 'head', file: undefined, context: undefined },
                { base: 'base', head: 'head', file: null, context: null },
                { base: 'base', head: 'head', file: '[ab].txt', context: 0 },
                { base: '--output=oops', head: '--exit-code', file: ':(glob)*.txt', context: 99999 },
                { base: 'base', head: 'head', file: '--output=oops', context: 3 },
            ]) {
                const needsHead = mode === 'range' || mode === 'comparison';
                const head = needsHead ? options.head : options.file === null ? null : undefined;
                const pending = api.prepareGitRevisionPatch(mode, options.base, head, options.file, options.context);
                expect(typeof pending.then).toBe('function');
                const revisions = mode === 'range' ? [`${options.base}...${options.head}`]
                    : mode === 'comparison' ? [options.base, options.head] : [options.base];
                expect(await pending).toEqual([
                    '--literal-pathspecs', ...prefix,
                    '-M', '-C', '--no-color', '--src-prefix=a/', '--dst-prefix=b/',
                    ...(options.context == null ? [] : [`-U${options.context}`]),
                    '--end-of-options', ...revisions, '--',
                    ...(options.file == null ? [] : [options.file]),
                ]);
            }
            if (mode === 'commit' || mode === 'show') {
                expect(await api.prepareGitRevisionPatch(mode, 'base')).toEqual(
                    await api.prepareGitRevisionPatch(mode, 'base', null, null, null),
                );
            }
        },
    );

    it.each([
        ['invalid', undefined], ['invalid', 'head'], ['', undefined], ['COMMIT', undefined],
        ['working-tree', undefined], ['commit', 'head'], ['commit', ''],
        ['show', 'head'], ['show', ''], ['range', undefined], ['range', null],
        ['comparison', undefined], ['comparison', null],
    ] as const)('rejects mode %j with head %j with the same Git error as host execution', async (mode, head) => {
        const store = api.openGitPatchStore('invalid-revision-plan', path.resolve('.'));
        try {
            const pending = api.prepareGitRevisionPatch(mode, 'base', head, '[ab].txt', 0);
            expect(typeof pending.then).toBe('function');
            await expect(pending).rejects.toThrow(/^git  failed: invalid patch mode$/);
            await expect(store.revisionPatch(mode, 'base', head, '[ab].txt', 0))
                .rejects.toThrow(/^git  failed: invalid patch mode$/);
        } finally {
            store.dispose();
        }
    });
});
