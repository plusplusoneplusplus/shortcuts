import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitBlobTooLargeError, readGitBlob } from '../../src/git/exec';
import { ensureGitSafeDirectoryAsync } from '../../src/git/safe-directory';
import { resolveWorkspaceExecutionContext } from '../../src/utils/workspace-execution';

vi.mock('child_process', async importOriginal => ({
    ...await importOriginal<typeof import('child_process')>(),
    spawn: vi.fn(),
}));
vi.mock('../../src/git/safe-directory', () => ({ ensureGitSafeDirectoryAsync: vi.fn() }));
vi.mock('../../src/utils/workspace-execution', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/utils/workspace-execution')>(),
    resolveWorkspaceExecutionContext: vi.fn(),
    getWslExecutablePath: vi.fn(() => 'wsl.exe'),
}));

let repo: string;
let sha: string;
const bytes = Buffer.from([32, 9, 0, 255, 13, 10, 10]);
beforeAll(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge blob ')));
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    git('init', '--initial-branch=main');
    fs.writeFileSync(path.join(repo, 'raw'), bytes);
    git('-c', 'core.autocrlf=false', 'add', 'raw');
    sha = git('rev-parse', ':raw');
});
afterAll(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue({ kind: 'windows', workingDirectory: repo });
});

describe('readGitBlob host', () => {
    it('reads index-only blobs byte for byte, including at the exact cap', async () => {
        expect(await readGitBlob(repo, sha, { maxBytes: bytes.length })).toEqual(bytes);
        expect(ensureGitSafeDirectoryAsync).toHaveBeenCalledWith(repo);
        expect(spawn).not.toHaveBeenCalled();
    });
    it('exposes a typed error on overflow from the real addon', async () => {
        await expect(readGitBlob(repo, sha, { maxBytes: bytes.length - 1 })).rejects.toBeInstanceOf(GitBlobTooLargeError);
        await expect(readGitBlob(repo, sha, { maxBytes: 0 })).rejects.toMatchObject({ code: 'GIT_BLOB_TOO_LARGE' });
    });
    it('preserves ordinary failures and validates limits', async () => {
        await expect(readGitBlob(repo, '0'.repeat(40), { maxBytes: 0 })).rejects.toThrow('cat-file blob');
        await expect(readGitBlob(repo, sha, { maxBytes: -1 })).rejects.toBeInstanceOf(RangeError);
    });
    it('ensures safe.directory before dispatch and propagates failure', async () => {
        vi.mocked(ensureGitSafeDirectoryAsync).mockRejectedValueOnce(new Error('denied'));
        await expect(readGitBlob(repo, sha, { maxBytes: 10 })).rejects.toThrow('git cat-file blob');
        expect(spawn).not.toHaveBeenCalled();
    });
});

function wslChild() {
    vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue({
        kind: 'wsl', distro: 'Ubuntu', linuxWorkingDirectory: '/repo with spaces',
        originalWorkingDirectory: '/repo with spaces',
    });
    const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    return child;
}

// Emit through streams to exercise incremental limits, rather than mocking the runner's result.
describe('readGitBlob WSL', () => {
    it('retains whitespace, invalid UTF-8 and NUL across chunks', async () => {
        const child = wslChild();
        const result = readGitBlob('/repo with spaces', sha, { maxBytes: bytes.length });
        await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
        child.stdout.write(bytes.subarray(0, 3));
        child.stdout.write(bytes.subarray(3));
        child.emit('close', 0);
        expect(await result).toEqual(bytes);
        expect(child.kill).not.toHaveBeenCalled();
        expect(ensureGitSafeDirectoryAsync).toHaveBeenCalledWith('/repo with spaces');
        expect(vi.mocked(spawn).mock.calls[0][1]).toEqual(expect.arrayContaining(['git', '-C', '/repo with spaces', 'cat-file', 'blob', sha]));
    });
    it('kills immediately on overflow before exit and returns the same typed error', async () => {
        const child = wslChild();
        const result = readGitBlob('/repo with spaces', sha, { maxBytes: 2 });
        const assertion = expect(result).rejects.toBeInstanceOf(GitBlobTooLargeError);
        await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
        child.stdout.write(Buffer.from('ab'));
        expect(child.kill).not.toHaveBeenCalled();
        child.stdout.write(Buffer.from('c'));
        expect(child.kill).toHaveBeenCalledOnce();
        child.emit('close', null);
        await assertion;
    });
    it('keeps missing-object errors distinct from overflow', async () => {
        const child = wslChild();
        const result = readGitBlob('/repo with spaces', sha, { maxBytes: 0 });
        const assertion = expect(result).rejects.toThrow('missing blob');
        await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
        child.stderr.write(Buffer.from('missing blob'));
        child.emit('close', 128);
        await assertion;
    });
    it('accepts empty output with a zero cap', async () => {
        const child = wslChild();
        const result = readGitBlob('/repo with spaces', sha, { maxBytes: 0, timeout: 0 });
        await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
        child.emit('close', 0);
        expect(await result).toEqual(Buffer.alloc(0));
    });
    it('kills on timeout and clears its timer on spawn error', async () => {
        const child = wslChild();
        const result = readGitBlob('/repo with spaces', sha, { maxBytes: 10, timeout: 100 });
        const assertion = expect(result).rejects.toThrow('timed out');
        await vi.waitFor(() => expect(child.kill).toHaveBeenCalled());
        child.emit('close', null);
        await assertion;
        const failed = wslChild();
        const failure = readGitBlob('/repo with spaces', sha, { maxBytes: 10, timeout: 100 });
        const rejected = expect(failure).rejects.toThrow('spawn failed');
        await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
        failed.emit('error', new Error('spawn failed'));
        await rejected;
        expect(failed.kill).not.toHaveBeenCalled();
    });
});
