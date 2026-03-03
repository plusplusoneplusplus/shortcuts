/**
 * Tests for execAsync utility.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { exec } from 'child_process';
import { execAsync } from '../../src/utils/exec-utils';

vi.mock('child_process', () => ({
    exec: vi.fn(),
}));

const mockedExec = exec as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
    vi.clearAllMocks();
});

describe('execAsync', () => {
    it('resolves with stdout and stderr on success', async () => {
        mockedExec.mockImplementationOnce((_cmd: string, _opts: unknown, cb: Function) => {
            cb(null, 'out', 'err');
        });

        const result = await execAsync('echo hello');
        expect(result.stdout).toBe('out');
        expect(result.stderr).toBe('err');
    });

    it('rejects with the error on command failure', async () => {
        const err = Object.assign(new Error('Command failed: bad'), {
            code: 1,
            killed: false,
            signal: null,
            cmd: 'bad',
        });

        mockedExec.mockImplementationOnce((_cmd: string, _opts: unknown, cb: Function) => {
            cb(err, '', 'some git error');
        });

        await expect(execAsync('bad')).rejects.toThrow('Command failed: bad');
    });

    it('appends stderr to error message when process is killed and stderr is not already included', async () => {
        const err = Object.assign(new Error('Command failed: git pull --rebase'), {
            code: null,
            killed: true,
            signal: 'SIGTERM',
            cmd: 'git pull --rebase',
        });

        mockedExec.mockImplementationOnce((_cmd: string, _opts: unknown, cb: Function) => {
            cb(err, '', 'fatal: unable to access repo: Could not resolve host');
        });

        await expect(execAsync('git pull --rebase')).rejects.toThrow(
            'fatal: unable to access repo: Could not resolve host'
        );
    });

    it('does not duplicate stderr when it is already included in the error message', async () => {
        const stderr = 'fatal: not a git repo';
        const err = Object.assign(new Error(`Command failed: git pull\n${stderr}`), {
            code: 128,
            killed: false,
            signal: null,
            cmd: 'git pull',
        });

        mockedExec.mockImplementationOnce((_cmd: string, _opts: unknown, cb: Function) => {
            cb(err, '', stderr);
        });

        const rejected = await execAsync('git pull').catch((e: Error) => e);
        const occurrences = (rejected as Error).message.split(stderr).length - 1;
        expect(occurrences).toBe(1);
    });

    it('does not modify error message when stderr is empty', async () => {
        const err = Object.assign(new Error('Command failed: git pull --rebase'), {
            code: null,
            killed: true,
            signal: 'SIGTERM',
            cmd: 'git pull --rebase',
        });

        mockedExec.mockImplementationOnce((_cmd: string, _opts: unknown, cb: Function) => {
            cb(err, '', '');
        });

        const rejected = await execAsync('git pull --rebase').catch((e: Error) => e);
        expect((rejected as Error).message).toBe('Command failed: git pull --rebase');
    });
});
