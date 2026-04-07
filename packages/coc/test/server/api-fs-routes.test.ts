import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@plusplusoneplusplus/forge', () => ({
    getDefaultWslDistro: vi.fn(),
    getWslExecutablePath: vi.fn().mockReturnValue('C:\\Windows\\System32\\wsl.exe'),
}));

vi.mock('child_process', async () => {
    const actual = await vi.importActual<typeof import('child_process')>('child_process');
    return {
        ...actual,
        execFileSync: vi.fn(),
    };
});

vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        existsSync: vi.fn(),
    };
});

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as forge from '@plusplusoneplusplus/forge';
import { listBrowseRoots } from '../../src/server/routes/api-fs-routes';

describe('listBrowseRoots', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.runIf(process.platform === 'win32')('returns WSL home plus available drive roots on Windows', () => {
        vi.mocked(fs.existsSync).mockImplementation(pathLike => ['C:\\', 'Q:\\', 'S:\\'].includes(String(pathLike)));
        vi.mocked(forge.getDefaultWslDistro).mockReturnValue('Ubuntu-24.04');
        vi.spyOn(childProcess, 'execFileSync').mockReturnValue('/home/georgeqiao\n' as never);

        const roots = listBrowseRoots();

        expect(roots).toEqual([
            { label: 'WSL Home (Ubuntu-24.04)', path: String.raw`\\wsl$\Ubuntu-24.04\home\georgeqiao` },
            { label: 'C:\\', path: 'C:\\' },
            { label: 'Q:\\', path: 'Q:\\' },
            { label: 'S:\\', path: 'S:\\' },
        ]);
    });
});
