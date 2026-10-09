import { describe, expect, it } from 'vitest';
import { readWindowsCredential } from '../src/windows-credentials';
import { randomUUID } from 'node:crypto';

describe('Windows credential native boundary', () => {
    it('rejects invalid targets without exposing the supplied target', async () => {
        await expect(readWindowsCredential('fixture\0private')).rejects.toThrow('Invalid Windows credential target.');
    });

    it('reads an exact missing credential or reports an unsupported platform', async () => {
        const pending = readWindowsCredential(`coc-test/missing-${randomUUID()}`);
        expect(pending).toBeInstanceOf(Promise);
        if (process.platform === 'win32') {
            await expect(pending).resolves.toBeNull();
        } else {
            await expect(pending).rejects.toThrow('Windows Credential Manager is unavailable on this platform.');
        }
    });
});
