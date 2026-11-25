import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { prepareWslImageOptions } from '../src/wsl-image-attachments';
import { resolveWorkspaceExecutionContext, resolveWorkspaceExecutionContextAsync } from '../src/platform/workspace-execution';
import type { SendMessageOptions } from '../src/types';

vi.mock('node:fs', () => ({
    lstatSync: vi.fn(), openSync: vi.fn(), fstatSync: vi.fn(), closeSync: vi.fn(),
}));
vi.mock('../src/platform/workspace-execution', async importOriginal => ({
    ...await importOriginal<typeof import('../src/platform/workspace-execution')>(),
    resolveWorkspaceExecutionContextAsync: vi.fn(),
}));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const workspace = String.raw`\\wsl$\Ubuntu\home\a\repo`;
const options = (imagePath: string): SendMessageOptions => ({
    prompt: 'look', workingDirectory: workspace,
    attachments: [{ type: 'file', path: imagePath, displayName: 'image.png' }],
});

beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.mocked(resolveWorkspaceExecutionContextAsync).mockResolvedValue({
        kind: 'wsl', distro: 'Ubuntu', linuxWorkingDirectory: '/home/a/repo', originalWorkingDirectory: workspace,
    });
    vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => false, isFile: () => true } as fs.Stats);
    vi.mocked(fs.openSync).mockReturnValue(42);
    vi.mocked(fs.fstatSync).mockReturnValue({ isFile: () => true, size: 12 } as fs.Stats);
});
afterEach(() => Object.defineProperty(process, 'platform', platform));

describe('host image transport for WSL', () => {
    it.each([
        [String.raw`C:\Users\me\Temp\upload.png`, String.raw`C:\Users\me\Temp\upload.png`],
        ['/tmp/upload.png', String.raw`\\wsl$\Ubuntu\tmp\upload.png`],
        [String.raw`\\wsl.localhost\ubuntu\tmp\upload.png`, String.raw`\\wsl$\ubuntu\tmp\upload.png`],
    ])('prepares %s for the host runtime', async (source, expected) => {
        const input = options(source);
        const result = await prepareWslImageOptions(input);
        expect(result.attachments?.[0].path).toBe(expected);
        expect(result.workingDirectory).toBe(workspace);
        expect(fs.openSync).toHaveBeenCalledWith(expected, 'r');
        expect(fs.closeSync).toHaveBeenCalledWith(42);
        expect(input.attachments?.[0].path).toBe(source);
    });

    it('uses the resolved default distro for a Linux workspace without guessing', async () => {
        const input = { ...options('/tmp/upload.png'), workingDirectory: '/home/a/repo' };
        expect((await prepareWslImageOptions(input)).workingDirectory).toBe(workspace);
        vi.mocked(resolveWorkspaceExecutionContextAsync).mockResolvedValue({
            kind: 'wsl', linuxWorkingDirectory: '/home/a/repo', originalWorkingDirectory: '/home/a/repo',
        });
        await expect(prepareWslImageOptions(input)).rejects.toThrow('resolved workspace distribution');
    });

    it.each([String.raw`\\wsl$\Debian\tmp\upload.png`, 'relative.png', String.raw`\\other\share\upload.png`])(
        'rejects foreign or ambiguous paths before reading: %s', async source => {
            await expect(prepareWslImageOptions(options(source))).rejects.toThrow('Cannot read WSL image attachment');
            expect(fs.openSync).not.toHaveBeenCalled();
        },
    );

    it.each([0, 10 * 1024 * 1024 + 1])('rejects invalid size %s and closes the file', async size => {
        vi.mocked(fs.fstatSync).mockReturnValue({ isFile: () => true, size } as fs.Stats);
        await expect(prepareWslImageOptions(options('/tmp/upload.png'))).rejects.toThrow('maximum 10 MB');
        expect(fs.closeSync).toHaveBeenCalledWith(42);
    });

    it('rejects directories and symlinks', async () => {
        vi.mocked(fs.fstatSync).mockReturnValue({ isFile: () => false, size: 12 } as fs.Stats);
        await expect(prepareWslImageOptions(options('/tmp/upload.png'))).rejects.toThrow('regular image');
        vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
        vi.mocked(fs.openSync).mockClear();
        await expect(prepareWslImageOptions(options('/tmp/upload.png'))).rejects.toThrow('regular image');
        expect(fs.openSync).not.toHaveBeenCalled();
    });

    it('rejects the batch if any image is unreadable without leaking paths or changing inputs', async () => {
        const input = options('/tmp/upload.png');
        input.attachments!.push({ type: 'file', path: '/private/missing.png', displayName: 'missing.png' });
        vi.mocked(fs.openSync).mockImplementationOnce(() => 42).mockImplementationOnce(() => { throw new Error('/private/missing.png'); });
        await expect(prepareWslImageOptions(input)).rejects.toThrow(/^Cannot read WSL image attachment:/);
        expect(input.attachments?.[0].path).toBe('/tmp/upload.png');
        expect(fs.closeSync).toHaveBeenCalledTimes(1);
    });

    it('preserves native image paths and document-only turns', async () => {
        vi.mocked(resolveWorkspaceExecutionContextAsync).mockResolvedValue({ kind: 'windows' });
        const native = options(String.raw`C:\Temp\image.png`);
        expect(await prepareWslImageOptions(native)).toBe(native);
        const document = options('/tmp/readme.txt');
        expect(await prepareWslImageOptions(document)).toBe(document);
        expect(fs.openSync).not.toHaveBeenCalled();
    });

    it('keeps concurrent workspace and distribution translations independent', async () => {
        vi.mocked(resolveWorkspaceExecutionContextAsync).mockImplementation(async cwd => resolveWorkspaceExecutionContext(cwd));
        const requests = ['Ubuntu', 'Debian'].map(distro => ({
            ...options('/tmp/upload.png'), workingDirectory: `\\\\wsl$\\${distro}\\home\\repo`,
        }));
        const results = await Promise.all(requests.map(prepareWslImageOptions));
        expect(results.map(result => result.attachments?.[0].path)).toEqual([
            String.raw`\\wsl$\Ubuntu\tmp\upload.png`, String.raw`\\wsl$\Debian\tmp\upload.png`,
        ]);
        expect(results.map(result => result.workingDirectory)).toEqual(requests.map(request => request.workingDirectory));
    });

    it('closes the file if cancelled during preparation', async () => {
        const controller = new AbortController();
        vi.mocked(fs.fstatSync).mockImplementation(() => {
            controller.abort();
            return { isFile: () => true, size: 12 } as fs.Stats;
        });
        await expect(prepareWslImageOptions({ ...options('/tmp/upload.png'), signal: controller.signal })).rejects.toThrow('aborted');
        expect(fs.closeSync).toHaveBeenCalledWith(42);
    });

    it('cancels before reading', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(prepareWslImageOptions({ ...options('/tmp/upload.png'), signal: controller.signal })).rejects.toThrow('aborted');
        expect(fs.openSync).not.toHaveBeenCalled();
    });
});
