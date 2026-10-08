import { describe, expect, it } from 'vitest';
import { loadNativeGit } from '../src/git';

const api = loadNativeGit();
const patch = 'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n' +
    '--- "a/caf\\303\\251.txt"\n+++ "b/caf\\303\\251.txt"\n' +
    '@@ -1 +1 @@\n---body\n+++body\n';

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
        expect(batch).toHaveLength(2);
        batch.forEach(args => {
            expect(args).toEqual(expect.arrayContaining(['--root', '--first-parent', '-z', '--end-of-options']));
            expect(args).not.toContain('-p');
        });
        expect(batch[0]).toContain('--name-status');
        expect(batch[1]).toContain('--numstat');
        const pending = api.processGitCommitFiles('R100\0old\0café\t\n.txt\0M\0bin\0', '2\t1\t\0old\0café\t\n.txt\0-\t-\tbin\0');
        expect(typeof pending.then).toBe('function');
        expect(await pending).toEqual([
            { path: 'café\t\n.txt', originalPath: 'old', status: 'renamed', additions: 2, deletions: 1 },
            { path: 'bin', status: 'modified' },
        ]);
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
    const result = await api.processGitWorkingTreePatch([patch, patch.replace('+++body', '+new\n+extra')], 2);
    expect(result.files).toHaveLength(1);
    expect(result.summary).toEqual({ filesChanged: 1, additions: 2, deletions: 1 });
    expect(result.files[0].raw).toContain('+++body');
    expect(result.files[0].raw).toContain('+extra');
    expect(result.content.truncated).toBe(true);
    await expect(api.prepareGitWorkingTreePatch('invalid')).rejects.toThrow('invalid working-tree scope');
});
