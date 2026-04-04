import { afterEach, describe, expect, it } from 'vitest';
import { getWslExecutablePath } from '../../src/utils/workspace-execution';

describe('workspace-execution', () => {
    const originalSystemRoot = process.env['SystemRoot'];

    afterEach(() => {
        if (originalSystemRoot === undefined) {
            delete process.env['SystemRoot'];
        } else {
            process.env['SystemRoot'] = originalSystemRoot;
        }
    });

    it('uses SystemRoot when available', () => {
        process.env['SystemRoot'] = 'D:\\Windows';
        expect(getWslExecutablePath()).toBe('D:\\Windows\\System32\\wsl.exe');
    });

    it('uses a Windows-safe fallback when SystemRoot is missing', () => {
        delete process.env['SystemRoot'];
        expect(getWslExecutablePath()).toBe('C:\\Windows\\System32\\wsl.exe');
    });
});
