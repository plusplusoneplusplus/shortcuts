import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@plusplusoneplusplus/forge', () => ({
    getDefaultWslDistro: vi.fn(),
    getWslExecutablePath: vi.fn().mockReturnValue('C:\\Windows\\System32\\wsl.exe'),
    // WSL home lookup now runs through forge's non-blocking execFileAsync.
    execFileAsync: vi.fn(),
    // Importing api-fs-routes transitively loads sse-handler, whose module-level
    // WarmStatusBridge singleton defaults its registry to forge's
    // `sdkServiceRegistry`. A full forge mock must stub it (the bridge only calls
    // `.get()`, defensively) or the import graph throws on a missing export.
    sdkServiceRegistry: { get: () => undefined },
}));

vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            access: vi.fn(),
        },
    };
});

import * as fs from 'fs';
import * as forge from '@plusplusoneplusplus/forge';
import { listBrowseRoots } from '../../src/server/routes/api-fs-routes';

/** Make fs.promises.access resolve for the given paths and reject for everything else. */
function mockExistingPaths(existing: string[]): void {
    vi.mocked(fs.promises.access).mockImplementation((async (pathLike: fs.PathLike) => {
        if (existing.includes(String(pathLike))) {
            return undefined;
        }
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }) as typeof fs.promises.access);
}

describe('listBrowseRoots', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.runIf(process.platform === 'win32')('returns WSL home plus available drive roots on Windows', async () => {
        mockExistingPaths(['C:\\', 'Q:\\', 'S:\\']);
        vi.mocked(forge.getDefaultWslDistro).mockReturnValue('Ubuntu-24.04');
        vi.mocked(forge.execFileAsync).mockResolvedValue({ stdout: '/home/georgeqiao\n', stderr: '' });

        const roots = await listBrowseRoots();

        expect(roots).toEqual([
            { label: 'WSL Home (Ubuntu-24.04)', path: String.raw`\\wsl$\Ubuntu-24.04\home\georgeqiao` },
            { label: 'C:\\', path: 'C:\\' },
            { label: 'Q:\\', path: 'Q:\\' },
            { label: 'S:\\', path: 'S:\\' },
        ]);
    });

    it.runIf(process.platform === 'win32')('keeps a WSL distro root even when home lookup fails', async () => {
        mockExistingPaths(['C:\\']);
        vi.mocked(forge.getDefaultWslDistro).mockReturnValue('Ubuntu-24.04');
        vi.mocked(forge.execFileAsync).mockRejectedValue(new Error('home lookup failed'));

        const roots = await listBrowseRoots();

        expect(roots).toEqual([
            { label: 'WSL (Ubuntu-24.04)', path: String.raw`\\wsl$\Ubuntu-24.04` },
            { label: 'C:\\', path: 'C:\\' },
        ]);
    });
});
