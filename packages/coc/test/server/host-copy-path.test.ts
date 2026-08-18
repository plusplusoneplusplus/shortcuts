import { describe, it, expect } from 'vitest';
import { resolveHostCopyPath } from '../../src/server/host-copy-path';

describe('resolveHostCopyPath', () => {
    it('returns the raw path when the server is not running inside WSL', () => {
        expect(resolveHostCopyPath('/home/yiheng/projects/shortcuts', { isNativeWsl: false, wslDistro: 'Ubuntu' }))
            .toBe('/home/yiheng/projects/shortcuts');
    });

    it('rewrites the path to the Windows UNC form inside WSL', () => {
        expect(resolveHostCopyPath('/home/yiheng/projects/shortcuts', { isNativeWsl: true, wslDistro: 'Ubuntu' }))
            .toBe('\\\\wsl.localhost\\Ubuntu\\home\\yiheng\\projects\\shortcuts');
    });

    it('falls back to the raw path when the distro name is unknown', () => {
        expect(resolveHostCopyPath('/home/yiheng', { isNativeWsl: true, wslDistro: '' }))
            .toBe('/home/yiheng');
    });

    it('leaves an already-UNC path unchanged', () => {
        const unc = '\\\\wsl.localhost\\Ubuntu\\home\\yiheng';
        expect(resolveHostCopyPath(unc, { isNativeWsl: true, wslDistro: 'Ubuntu' })).toBe(unc);
    });

    it('leaves an empty path unchanged', () => {
        expect(resolveHostCopyPath('', { isNativeWsl: true, wslDistro: 'Ubuntu' })).toBe('');
    });
});
