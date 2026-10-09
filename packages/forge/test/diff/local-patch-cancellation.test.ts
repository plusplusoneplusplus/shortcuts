import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadNativeGit, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { ensureGitSafeDirectoryAsync } from '../../src/git/safe-directory';
import {
    loadCommitPatch, loadCommitShowPatch, loadComparisonPatch, loadPendingPatch, loadRangePatch,
    loadWorkingTreePatch, type LocalPatchOptions,
} from '../../src/diff/local-patch';

vi.mock('../../src/git/safe-directory', () => ({ ensureGitSafeDirectoryAsync: vi.fn() }));

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(ensureGitSafeDirectoryAsync).mockReset();
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-cancel-')));
    roots.push(root);
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    git('init', '--initial-branch=main');
    for (const [key, value] of [
        ['user.name', 'Test'], ['user.email', 'test@example.com'],
        ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'],
    ]) git('config', key, value);
    fs.writeFileSync(path.join(root, 'same.txt'), 'before\n');
    git('add', '.');
    git('commit', '-qm', 'initial');
    const base = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'same.txt'), 'after\n');
    git('add', '.');
    git('commit', '-qm', 'changed');
    fs.writeFileSync(path.join(root, 'same.txt'), 'disk\n');
    const store = loadNativeGit().openGitPatchStore(root, root);
    const open = vi.spyOn(loadNativeGit(), 'openGitPatchStore').mockReturnValue(store);
    const begin = vi.spyOn(store, 'beginTransport');
    return { root, base, git, store, open, begin };
}

const reads = [
    ['commit', (root: string, _base: string, options: LocalPatchOptions) => loadCommitPatch(root, 'HEAD', undefined, options)],
    ['show', (root: string, _base: string, options: LocalPatchOptions) => loadCommitShowPatch(root, 'HEAD', undefined, options)],
    ['range', (root: string, base: string, options: LocalPatchOptions) => loadRangePatch(root, base, 'HEAD', undefined, options)],
    ['comparison', (root: string, base: string, options: LocalPatchOptions) => loadComparisonPatch(root, base, 'HEAD', undefined, options)],
    ['working-tree', (root: string, _base: string, options: LocalPatchOptions) => loadWorkingTreePatch(root, 'all', undefined, options)],
    ['pending', (root: string, _base: string, options: LocalPatchOptions) => loadPendingPatch(root, options)],
] as const;

describe('local patch AbortSignal boundary', () => {
    it.each(reads)('rejects pre-aborted %s before native or Git I/O', async (_name, read) => {
        const { root, base, store, open, begin } = fixture();
        const reason = new Error('abandoned read');
        try {
            await expect(read(root, base, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
            expect(open).not.toHaveBeenCalled();
            expect(begin).not.toHaveBeenCalled();
            expect(ensureGitSafeDirectoryAsync).not.toHaveBeenCalled();
        } finally { store.dispose(); }
    });

    it.each(reads)('cancels submitted/cached %s without revoking another same-store read', async (name, read) => {
        const { root, base, store, begin } = fixture();
        try {
            for (let pass = 0; pass < 2; pass++) {
                const controller = new AbortController();
                const reason = new Error('abandoned read');
                const remove = vi.spyOn(controller.signal, 'removeEventListener');
                const original = Object.getPrototypeOf(store).beginTransport;
                let first = true;
                begin.mockImplementation(() => {
                    const request = original.call(store) as ReturnType<typeof store.beginTransport>;
                    if (!first) return request;
                    first = false;
                    // Abort after dispatch even if the worker has a cached answer.
                    if (name === 'working-tree' || name === 'pending') {
                        const submit = request.workingTreePatch.bind(request);
                        vi.spyOn(request, 'workingTreePatch').mockImplementation((...args) => {
                            const pending = submit(...args);
                            controller.abort(reason);
                            return pending;
                        });
                    } else {
                        const submit = request.revisionPatch.bind(request);
                        vi.spyOn(request, 'revisionPatch').mockImplementation((...args) => {
                            const pending = submit(...args);
                            controller.abort(reason);
                            return pending;
                        });
                    }
                    return request;
                });
                const pending = read(root, base, { signal: controller.signal });
                const independent = read(root, base, {});
                await expect(pending).rejects.toBe(reason);
                expect((await independent).content.raw).toContain(name === 'working-tree' || name === 'pending' ? '+disk' : '+after');
                expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
                expect((await read(root, base, {})).files).toHaveLength(1);
            }
        } finally { store.dispose(); }
    });

    it('retires tickets while cancellation waits for safe-directory setup', async () => {
        const { root, store, begin } = fixture();
        let ready!: () => void;
        vi.mocked(ensureGitSafeDirectoryAsync).mockReturnValueOnce(new Promise<void>(resolve => { ready = resolve; }));
        const controller = new AbortController(), reason = new Error('setup abandoned');
        const pending = loadCommitPatch(root, 'HEAD', undefined, { signal: controller.signal });
        const rejected = expect(pending).rejects.toBe(reason);
        try {
            controller.abort(reason);
            expect(() => begin.mock.results[0].value.checkActive()).toThrow('Cancelled');
            ready();
            await rejected;
            expect(() => begin.mock.results[0].value.checkActive()).toThrow('Cancelled');
            expect(() => begin.mock.results[0].value.process('')).toThrow('Closed');
            expect((await loadCommitPatch(root, 'HEAD')).content.raw).toContain('+after');
        } finally { ready(); store.dispose(); await pending.catch(() => undefined); }
    });

    it.each(['revisionPatch', 'workingTreePatch'] as const)('exposes missing host %s capabilities and retires the ticket', async method => {
        const { root, store, begin } = fixture();
        const original = Object.getPrototypeOf(store).beginTransport;
        begin.mockImplementation(() => {
            const ticket = original.call(store);
            Object.defineProperty(ticket, method, { value: undefined });
            return ticket;
        });
        try {
            await expect(loadCommitPatch(root, 'HEAD')).rejects.toBeInstanceOf(NativeAddonLoadError);
            expect(ensureGitSafeDirectoryAsync).not.toHaveBeenCalled();
            expect(() => begin.mock.results[0].value.checkActive()).toThrow('Cancelled');
            expect(() => begin.mock.results[0].value.process('')).toThrow('Closed');
        } finally { store.dispose(); }
    });

    it('removes listeners on success and ordinary Git failure without hiding diagnostics', async () => {
        const { root, store, begin } = fixture();
        try {
            for (const commit of ['HEAD', 'missing-ref']) {
                const controller = new AbortController();
                const remove = vi.spyOn(controller.signal, 'removeEventListener');
                const pending = loadCommitPatch(root, commit, undefined, { signal: controller.signal });
                if (commit === 'HEAD') expect((await pending).content.raw).toContain('+after');
                else await expect(pending).rejects.toThrow('git');
                expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
                expect(() => begin.mock.results.at(-1)?.value.process('')).toThrow('Closed');
                controller.abort();
                expect((await loadCommitPatch(root, 'HEAD')).content.raw).toContain('+after');
            }
        } finally { store.dispose(); }
    });

    it.each(['show', 'working-tree'] as const)('stops executing %s Git before a blocked helper is released', async mode => {
        const { root, git, store } = fixture();
        const started = path.join(root, 'started'), release = path.join(root, 'release'), finished = path.join(root, 'finished');
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
        const quote = (value: string) => `'${value.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
        git('config', 'diff.block.textconv', `${quote(process.execPath)} ${quote(helper)} ${quote(root)}`);
        fs.writeFileSync(path.join(root, '.gitattributes'), '*.txt diff=block\n');
        const controller = new AbortController(), reason = new Error('executing read abandoned');
        const pending = mode === 'show' ? loadCommitShowPatch(root, 'HEAD', 'same.txt', { signal: controller.signal })
            : loadWorkingTreePatch(root, 'all', 'same.txt', { signal: controller.signal });
        const rejected = expect(pending).rejects.toBe(reason);
        try {
            await expect.poll(() => fs.existsSync(started)).toBe(true);
            controller.abort(reason);
            await rejected;
            expect(fs.existsSync(finished)).toBe(false);
            git('config', '--unset', 'diff.block.textconv');
            expect((await loadWorkingTreePatch(root, 'unstaged', 'same.txt')).content.raw).toContain('+disk');
        } finally {
            controller.abort(reason);
            fs.writeFileSync(release, '');
            store.dispose();
            await pending.catch(() => undefined);
            if (fs.existsSync(started)) await expect.poll(() => fs.existsSync(finished)).toBe(true);
        }
    });
});
