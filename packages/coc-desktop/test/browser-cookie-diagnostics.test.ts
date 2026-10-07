import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as os from 'node:os';
import * as path from 'node:path';
import { diskCookies } from './e2e/browser-cookie-diagnostics';

let directory: string;
let profile: string;

beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'coc-cookie-diagnostics-'));
    profile = path.join(directory, 'coc', 'browser', 'electron', 'Network');
    mkdirSync(profile, { recursive: true });
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
});

describe('Electron cookie diagnostics', () => {
    it('reads cookie metadata without values and closes the database', () => {
        const db = new DatabaseSync(path.join(profile, 'Cookies'));
        db.exec("CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, is_persistent INTEGER); INSERT INTO cookies VALUES ('example.test', 'fixture', 'secret', X'1234', 1);");
        db.close();
        const close = vi.spyOn(DatabaseSync.prototype, 'close');
        expect(diskCookies(directory)).toEqual([{
            file: path.join('Network', 'Cookies'), size: expect.any(Number),
            rows: [{ host_key: 'example.test', name: 'fixture', plain: 6, encrypted: 2, is_persistent: 1 }],
        }]);
        expect(close).toHaveBeenCalledOnce();
    });

    it.each(['invalid SQLite', 'missing cookies table'])('closes the database after a failed query: %s', failure => {
        const filename = path.join(profile, 'Cookies');
        if (failure === 'invalid SQLite') writeFileSync(filename, 'not a database');
        else new DatabaseSync(filename).close();
        const close = vi.spyOn(DatabaseSync.prototype, 'close');
        const result = diskCookies(directory);
        expect(result?.[0].rows).toEqual(expect.stringMatching(/file is not a database|no such table: cookies/));
        expect(close).toHaveBeenCalledOnce();
        // Windows cannot remove a database while a diagnostic handle remains open.
        rmSync(filename);
    });

    it('ignores cookie journal files and similarly named directories', () => {
        writeFileSync(path.join(profile, 'Cookies-journal'), 'journal');
        writeFileSync(path.join(profile, 'Cookies-wal'), 'write-ahead log');
        mkdirSync(path.join(profile, 'Cookies-cache'));
        const close = vi.spyOn(DatabaseSync.prototype, 'close');
        expect(diskCookies(directory)).toEqual([]);
        expect(close).not.toHaveBeenCalled();
    });

    it('returns no diagnostics for an absent profile', () => {
        expect(diskCookies(path.join(directory, 'missing'))).toBeNull();
    });
});
