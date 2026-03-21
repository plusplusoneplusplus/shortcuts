import path from 'path';
import { describe, it, expect } from 'vitest';
import { getRepoDataPath } from '../../src/server/paths';

describe('getRepoDataPath', () => {
    it('returns canonical repo-scoped data file path', () => {
        const result = getRepoDataPath('/home/user/.coc', 'abc123', 'queue.json');
        expect(result).toBe(path.join('/home/user/.coc', 'repos', 'abc123', 'queue.json'));
    });

    it('handles empty filename', () => {
        const result = getRepoDataPath('/home/user/.coc', 'abc123', '');
        expect(result).toBe(path.join('/home/user/.coc', 'repos', 'abc123'));
    });

    it('handles nested filename', () => {
        const result = getRepoDataPath('/data', 'ws-kss6a7', 'sub/dir/file.json');
        expect(result).toBe(path.join('/data', 'repos', 'ws-kss6a7', 'sub/dir/file.json'));
    });

    it('is re-exported from the server barrel', async () => {
        const barrel = await import('../../src/server/index');
        expect(barrel.getRepoDataPath).toBe(getRepoDataPath);
    });
});
