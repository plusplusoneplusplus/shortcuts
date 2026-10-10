import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadNativeGit, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { execFileAsync as realExecFileAsync } from '@plusplusoneplusplus/coc-agent-sdk/platform';
import { execFileAsync } from '../../src/utils/exec-utils';
import * as execution from '../../src/utils/workspace-execution';
import {
    loadCommitPatch, loadCommitShowPatch, loadComparisonPatch, loadRangePatch, loadWorkingTreePatch,
    type LocalPatchOptions,
} from '../../src/diff/local-patch';

vi.mock('../../src/utils/exec-utils', () => ({ execFileAsync: vi.fn() }));
vi.mock('../../src/git/safe-directory', () => ({ ensureGitSafeDirectoryAsync: vi.fn() }));
vi.mock('../../src/utils/workspace-execution', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/utils/workspace-execution')>(),
    getWslExecutablePath: () => process.execPath,
}));

const patch = 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-old\n+new\n';
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-cancel-')));
    roots.push(root);
    const store = loadNativeGit().openGitPatchStore(root, root.replaceAll('\\', '/').replace(/^[A-Za-z]:/, ''), 'Ubuntu');
    vi.spyOn(loadNativeGit(), 'openGitPatchStore').mockReturnValue(store);
    const begin = vi.spyOn(store, 'beginTransport');
    // Keep a real child blocked behind the WSL executable seam. Cancellation
    // must terminate it, not wait for a fabricated transport response.
    vi.mocked(execFileAsync).mockImplementation((_exec, args, options) => realExecFileAsync(process.execPath, [
        '-e', `
const fs = require('node:fs');
fs.writeFileSync(process.argv[1], String(process.pid));
setInterval(() => {
    if (fs.existsSync(process.argv[1] + '.release')) {
        process.stdout.write(${JSON.stringify(patch)});
        process.exit(0);
    }
}, 5);
setTimeout(() => process.exit(0), 10000);
`, path.join(root, args?.includes('independent') ? 'other' : args?.includes('--cached') ? 'staged' : 'unstaged'),
    ], options));
    return { root, store, begin, wslRoot: `\\\\wsl$\\Ubuntu${root.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '').replaceAll('/', '\\')}` };
}

function exited(pid: number) {
    try { process.kill(pid, 0); return false; } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
        throw error;
    }
}

const reads = [
    ['commit', (root: string, options?: LocalPatchOptions) => loadCommitPatch(root, 'HEAD', undefined, options)],
    ['show', (root: string, options?: LocalPatchOptions) => loadCommitShowPatch(root, 'HEAD', undefined, options)],
    ['range', (root: string, options?: LocalPatchOptions) => loadRangePatch(root, 'base', 'head', undefined, options)],
    ['comparison', (root: string, options?: LocalPatchOptions) => loadComparisonPatch(root, 'base', 'head', undefined, options)],
    ['working-tree', (root: string, options?: LocalPatchOptions) => loadWorkingTreePatch(root, 'all', undefined, options)],
] as const;

describe('WSL executing patch transport cancellation', () => {
    it.each(reads)('stops %s children through the caller signal and removes its listener', async (name, read) => {
        const { root, store, begin, wslRoot } = fixture();
        const controller = new AbortController(), reason = new Error('WSL read abandoned');
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const pending = read(wslRoot, { signal: controller.signal });
        const rejected = expect(pending).rejects.toBe(reason);
        try {
            const markers = name === 'working-tree' ? ['staged', 'unstaged'] : ['unstaged'];
            await vi.waitFor(() => markers.forEach(marker => expect(fs.existsSync(path.join(root, marker))).toBe(true)));
            const pids = markers.map(marker => Number(fs.readFileSync(path.join(root, marker), 'utf8')));
            controller.abort(reason);
            await rejected;
            await vi.waitFor(() => pids.forEach(pid => expect(exited(pid)).toBe(true)));
            expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
            expect(() => begin.mock.results[0].value.checkActive()).toThrow('Cancelled');
            expect(() => begin.mock.results[0].value.process('')).toThrow('Closed');
            vi.mocked(execFileAsync).mockResolvedValue({ stdout: patch, stderr: '' });
            expect((await read(wslRoot)).content.raw).toContain('+new');
        } finally { controller.abort(reason); store.dispose(); await pending.catch(() => undefined); }
    });

    it.each(['revision', 'working-tree'] as const)('cancels submitted WSL %s processing after transport completes', async mode => {
        const { store, begin, wslRoot } = fixture();
        const controller = new AbortController(), reason = new Error('processing abandoned');
        const original = Object.getPrototypeOf(store).beginTransport;
        begin.mockImplementation(() => {
            const ticket = original.call(store) as ReturnType<typeof store.beginTransport>;
            if (mode === 'revision') {
                const submit = ticket.process.bind(ticket);
                vi.spyOn(ticket, 'process').mockImplementation((...args) => {
                    const pending = submit(...args);
                    controller.abort(reason);
                    return pending;
                });
            } else {
                const submit = ticket.processWorkingTree.bind(ticket);
                vi.spyOn(ticket, 'processWorkingTree').mockImplementation((...args) => {
                    const pending = submit(...args);
                    controller.abort(reason);
                    return pending;
                });
            }
            return ticket;
        });
        vi.mocked(execFileAsync).mockResolvedValue({ stdout: patch, stderr: '' });
        try {
            const pending = mode === 'revision' ? loadCommitPatch(wslRoot, 'HEAD', undefined, { signal: controller.signal })
                : loadWorkingTreePatch(wslRoot, 'all', undefined, { signal: controller.signal });
            await expect(pending).rejects.toBe(reason);
            expect(() => begin.mock.results[0].value.process(patch)).toThrow('Closed');
            begin.mockRestore();
            expect((await loadCommitPatch(wslRoot, 'HEAD')).content.raw).toContain('+new');
        } finally { store.dispose(); }
    });

    it('rejects a pre-aborted WSL read before creating a ticket or transport', async () => {
        const { store, begin, wslRoot } = fixture();
        const reason = new Error('pre-aborted WSL');
        try {
            vi.mocked(execFileAsync).mockClear();
            await expect(loadCommitPatch(wslRoot, 'HEAD', undefined, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
            expect(begin).not.toHaveBeenCalled();
            expect(execFileAsync).not.toHaveBeenCalled();
        } finally { store.dispose(); }
    });

    it('cancels unresolved-default-distro transport without inventing a store identity', async () => {
        const { root, store, begin, wslRoot } = fixture();
        vi.spyOn(execution, 'resolveWorkspaceExecutionContext').mockReturnValue({
            kind: 'wsl', linuxWorkingDirectory: root.replaceAll('\\', '/').replace(/^[A-Za-z]:/, ''),
        });
        const controller = new AbortController(), reason = new Error('default distro abandoned');
        const pending = loadCommitPatch(wslRoot, 'HEAD', undefined, { signal: controller.signal });
        const rejected = expect(pending).rejects.toBe(reason);
        try {
            await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'unstaged'))).toBe(true));
            const pid = Number(fs.readFileSync(path.join(root, 'unstaged'), 'utf8'));
            controller.abort(reason);
            await rejected;
            await vi.waitFor(() => expect(exited(pid)).toBe(true));
            expect(begin).not.toHaveBeenCalled();
        } finally { controller.abort(reason); store.dispose(); await pending.catch(() => undefined); }
    });

    it('cancels one executing request without stopping another request in the same scope', async () => {
        const { root, store, begin, wslRoot } = fixture();
        const cancelled = loadCommitPatch(wslRoot, 'HEAD');
        const independent = loadCommitPatch(wslRoot, 'independent');
        const rejected = expect(cancelled).rejects.toThrow('Cancelled');
        try {
            await vi.waitFor(() => ['unstaged', 'other'].forEach(marker =>
                expect(fs.existsSync(path.join(root, marker))).toBe(true)));
            begin.mock.results[0].value.cancel();
            await rejected;
            const independentPid = Number(fs.readFileSync(path.join(root, 'other'), 'utf8'));
            expect(exited(independentPid)).toBe(false);
            const call = vi.mocked(execFileAsync).mock.calls.find(call => call[1]?.includes('independent'));
            expect(call?.[2]?.signal?.aborted).toBe(false);
            fs.writeFileSync(path.join(root, 'other.release'), '');
            expect((await independent).content.raw).toContain('+new');
            await vi.waitFor(() => expect(exited(independentPid)).toBe(true));
        } finally {
            begin.mock.results.forEach(result => result.value?.cancel());
            store.dispose();
            await Promise.allSettled([cancelled, independent]);
        }
    });

    it.each(reads)('stops %s children on request cancellation, refresh and disposal', async (_name, read) => {
        for (const action of ['cancel', 'refresh', 'dispose'] as const) {
            const { root, store, begin, wslRoot } = fixture();
            let pending: ReturnType<typeof read> | undefined;
            try {
                pending = read(wslRoot);
                const rejected = expect(pending).rejects.toThrow(action === 'cancel' ? 'Cancelled' : action === 'refresh' ? 'Stale' : 'Closed');
                const markers = _name === 'working-tree' ? ['staged', 'unstaged'] : ['unstaged'];
                await vi.waitFor(() => markers.forEach(marker => expect(fs.existsSync(path.join(root, marker))).toBe(true)));
                const pids = markers.map(marker => Number(fs.readFileSync(path.join(root, marker), 'utf8')));
                const ticket = begin.mock.results[0].value;
                if (action === 'cancel') ticket.cancel(); else store[action]();
                await rejected;
                await vi.waitFor(() => pids.forEach(pid => expect(exited(pid)).toBe(true)));
                expect(() => ticket.process(patch)).toThrow('Closed');
                if (action !== 'dispose') {
                    vi.mocked(execFileAsync).mockResolvedValue({ stdout: patch, stderr: '' });
                    expect((await read(wslRoot)).content.raw).toContain('+new');
                }
                const independent = loadNativeGit().openRemoteGitPatchStore('other', root, {
                    provider: 'github', host: 'github.com', repository: 'github:example/repo', sourceId: 'pr:1',
                });
                try { expect((await independent.beginTransport().process(patch)).content.raw).toBe(patch); }
                finally { independent.dispose(); }
            } finally {
                begin.mock.results.forEach(result => result.value?.cancel());
                store.dispose();
                await pending?.catch(() => undefined);
                vi.restoreAllMocks();
            }
        }
    });

    it('retires revision continuations on failed transport and rejects stale cancellation capabilities before I/O', async () => {
        const { store, begin, wslRoot } = fixture();
        try {
            vi.mocked(execFileAsync).mockRejectedValue({ stderr: 'transport failed' });
            await expect(loadCommitPatch(wslRoot, 'HEAD')).rejects.toThrow('transport failed');
            expect(() => begin.mock.results[0].value.process(patch)).toThrow('Closed');
            const original = Object.getPrototypeOf(store).beginTransport;
            begin.mockImplementation(() => {
                const ticket = original.call(store);
                Object.defineProperty(ticket, 'checkActive', { value: undefined });
                return ticket;
            });
            vi.mocked(execFileAsync).mockClear();
            await expect(loadCommitPatch(wslRoot, 'HEAD')).rejects.toBeInstanceOf(NativeAddonLoadError);
            expect(execFileAsync).not.toHaveBeenCalled();
            expect(() => begin.mock.results.at(-1)?.value.process(patch)).toThrow('Closed');
        } finally { store.dispose(); }
    });

    it('aborts a blocked working-tree sibling when another command fails', async () => {
        const { root, store, begin, wslRoot } = fixture();
        const blocked = vi.mocked(execFileAsync).getMockImplementation()!;
        vi.mocked(execFileAsync).mockImplementation(async (exec, args, options) => {
            if (!args?.includes('--cached')) return blocked(exec, args, options);
            await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'unstaged'))).toBe(true));
            throw { stderr: 'staged command failed' };
        });
        try {
            await expect(loadWorkingTreePatch(wslRoot, 'all')).rejects.toThrow('staged command failed');
            const pid = Number(fs.readFileSync(path.join(root, 'unstaged'), 'utf8'));
            await vi.waitFor(() => expect(exited(pid)).toBe(true));
            expect(() => begin.mock.results[0].value.processWorkingTree([patch, ''])).toThrow('Closed');
        } finally { store.dispose(); }
    });
});
