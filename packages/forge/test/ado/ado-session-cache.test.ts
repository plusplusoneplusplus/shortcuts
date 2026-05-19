import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
    readAdoSessionCache,
    writeAdoSessionCache,
    clearAdoSessionCache,
    isTokenValid,
    AdoSessionCache,
} from '../../src/ado/ado-session-cache';

vi.mock('fs/promises');

const mockedFs = vi.mocked(fs);

const FAKE_DIR = '/fake/.coc';
const CACHE_FILE = path.join(FAKE_DIR, 'ado-session.json');

const NOW = 1_700_000_000_000;

function validCache(overrides: Partial<AdoSessionCache> = {}): AdoSessionCache {
    return {
        token: 'bearer-abc',
        expiresAt: NOW + 60 * 60 * 1000, // 1 hour from now
        account: { upn: 'user@example.com', displayName: 'Test User', adoId: null },
        ...overrides,
    };
}

describe('readAdoSessionCache', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns null when file does not exist (ENOENT)', async () => {
        mockedFs.readFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
        expect(await readAdoSessionCache(FAKE_DIR)).toBeNull();
    });

    it('returns null on JSON parse error', async () => {
        mockedFs.readFile.mockResolvedValueOnce('not json' as never);
        expect(await readAdoSessionCache(FAKE_DIR)).toBeNull();
    });

    it('returns null when token field is missing', async () => {
        mockedFs.readFile.mockResolvedValueOnce(
            JSON.stringify({ expiresAt: NOW + 3600_000 }) as never,
        );
        expect(await readAdoSessionCache(FAKE_DIR)).toBeNull();
    });

    it('returns parsed cache on valid data', async () => {
        const cache = validCache();
        mockedFs.readFile.mockResolvedValueOnce(JSON.stringify(cache) as never);
        const result = await readAdoSessionCache(FAKE_DIR);
        expect(result).toEqual(cache);
    });
});

describe('writeAdoSessionCache', () => {
    beforeEach(() => vi.clearAllMocks());

    it('creates parent dir and writes via tmp → rename', async () => {
        mockedFs.mkdir.mockResolvedValueOnce(undefined as never);
        mockedFs.writeFile.mockResolvedValueOnce(undefined as never);
        mockedFs.rename.mockResolvedValueOnce(undefined as never);

        const cache = validCache();
        await writeAdoSessionCache(cache, FAKE_DIR);

        expect(mockedFs.mkdir).toHaveBeenCalledWith(path.dirname(CACHE_FILE), { recursive: true });
        expect(mockedFs.writeFile).toHaveBeenCalledWith(
            CACHE_FILE + '.tmp',
            JSON.stringify(cache, null, 2),
            'utf-8',
        );
        expect(mockedFs.rename).toHaveBeenCalledWith(CACHE_FILE + '.tmp', CACHE_FILE);
    });
});

describe('clearAdoSessionCache', () => {
    beforeEach(() => vi.clearAllMocks());

    it('deletes the ADO session cache file', async () => {
        mockedFs.unlink.mockResolvedValueOnce(undefined as never);

        await clearAdoSessionCache(FAKE_DIR);

        expect(mockedFs.unlink).toHaveBeenCalledWith(CACHE_FILE);
    });

    it('ignores ENOENT when the ADO session cache file is already missing', async () => {
        mockedFs.unlink.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) as never);

        await expect(clearAdoSessionCache(FAKE_DIR)).resolves.toBeUndefined();
    });

    it('rethrows non-ENOENT unlink errors', async () => {
        mockedFs.unlink.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }) as never);

        await expect(clearAdoSessionCache(FAKE_DIR)).rejects.toThrow('EACCES');
    });
});

describe('isTokenValid', () => {
    beforeEach(() => vi.setSystemTime(NOW));
    afterEach(() => vi.useRealTimers());

    it('returns true when expiry is > 5 min away', () => {
        expect(isTokenValid(validCache({ expiresAt: NOW + 10 * 60 * 1000 }))).toBe(true);
    });

    it('returns false when expiry is < 5 min away', () => {
        expect(isTokenValid(validCache({ expiresAt: NOW + 3 * 60 * 1000 }))).toBe(false);
    });

    it('returns false when token is exactly 5 min away', () => {
        expect(isTokenValid(validCache({ expiresAt: NOW + 5 * 60 * 1000 }))).toBe(false);
    });

    it('returns false when token is already expired', () => {
        expect(isTokenValid(validCache({ expiresAt: NOW - 1000 }))).toBe(false);
    });
});

describe('readAdoSessionCache — default path (no dataDir)', () => {
    const ORIG_ENV = process.env.COC_DATA_DIR;
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.COC_DATA_DIR;
    });
    afterEach(() => {
        if (ORIG_ENV !== undefined) process.env.COC_DATA_DIR = ORIG_ENV;
        else delete process.env.COC_DATA_DIR;
    });

    it('uses ~/.coc/ado-session.json by default', async () => {
        mockedFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
        await readAdoSessionCache();
        const expectedPath = path.join(os.homedir(), '.coc', 'ado-session.json');
        expect(mockedFs.readFile).toHaveBeenCalledWith(expectedPath, 'utf-8');
    });
});
