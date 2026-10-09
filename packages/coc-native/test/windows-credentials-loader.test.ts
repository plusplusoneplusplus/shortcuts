import { beforeEach, describe, expect, it, vi } from 'vitest';

const load = vi.hoisted(() => vi.fn());
vi.mock('../src/loader', async importOriginal => ({
    ...await importOriginal<typeof import('../src/loader')>(),
    loadNativeAddon: load,
}));
import { readWindowsCredential } from '../src/windows-credentials';

beforeEach(() => { load.mockReset(); });
describe('Windows credential capability loading', () => {
    it('requires the credential capability in the installed addon', () => {
        load.mockReturnValue({});
        expect(() => readWindowsCredential('fixture')).toThrow('missing Windows credential reader');
    });
    it('propagates addon load failures', () => {
        load.mockImplementation(() => { throw new Error('addon unavailable'); });
        expect(() => readWindowsCredential('fixture')).toThrow('addon unavailable');
    });
    it('passes only the exact target to the native reader', async () => {
        const read = vi.fn().mockResolvedValue('gho_fixture');
        load.mockReturnValue({ readWindowsCredential: read });
        await expect(readWindowsCredential('copilot-cli/github.com:fixture')).resolves.toBe('gho_fixture');
        expect(read).toHaveBeenCalledExactlyOnceWith('copilot-cli/github.com:fixture');
    });
});
