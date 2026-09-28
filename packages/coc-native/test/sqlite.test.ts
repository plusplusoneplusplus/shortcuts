import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NativeDatabase } from '../src/sqlite';

let directory: string;
let databases: NativeDatabase[];

beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-sqlite-'));
    databases = [];
});

afterEach(() => {
    for (const database of databases) {
        try {
            database.close();
        } catch {
            // A close-behavior test may already have closed it.
        }
    }
    fs.rmSync(directory, { recursive: true, force: true });
});

function open(file = ':memory:', options?: { readonly?: boolean }): NativeDatabase {
    const database = new NativeDatabase(file, options);
    databases.push(database);
    return database;
}

describe('NativeDatabase statements', () => {
    it('executes batches and exposes run, get, all, and iterable results', () => {
        const database = open();
        expect(database.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)')).toBe(database);
        const insert = database.prepare('INSERT INTO items(name) VALUES (?)');
        expect(insert.run('first')).toEqual({ changes: 1, lastInsertRowid: 1 });
        expect(insert.run(['second'])).toEqual({ changes: 1, lastInsertRowid: 2 });

        expect(database.prepare('SELECT * FROM items WHERE id = ?').get(1)).toEqual({ id: 1, name: 'first' });
        expect(database.prepare('SELECT * FROM items WHERE id = ?').get(99)).toBeUndefined();
        expect(database.prepare('SELECT * FROM items ORDER BY id').all()).toEqual([
            { id: 1, name: 'first' },
            { id: 2, name: 'second' },
        ]);
        expect([...database.prepare('SELECT name FROM items ORDER BY id').iterate()]).toEqual([
            { name: 'first' },
            { name: 'second' },
        ]);
    });

    it('binds bare and prefixed names for @, :, and $ parameters', () => {
        const database = open();
        const statement = database.prepare('SELECT @at AS at, :colon AS colon, $dollar AS dollar');
        expect(statement.get({ at: 1, colon: 'two', dollar: 3 })).toEqual({
            at: 1,
            colon: 'two',
            dollar: 3,
        });
        expect(statement.get({ '@at': 4, ':colon': 'five', '$dollar': 6 })).toEqual({
            at: 4,
            colon: 'five',
            dollar: 6,
        });
    });

    it('preserves SQLite null, integer, real, text, and blob values', () => {
        const database = open();
        const blob = Buffer.from([0, 127, 255]);
        const row = database
            .prepare('SELECT ? AS nullValue, ? AS integerValue, ? AS realValue, ? AS textValue, ? AS blobValue')
            .get(null, 42, 1.25, 'hello', blob);
        expect(row).toEqual({
            nullValue: null,
            integerValue: 42,
            realValue: 1.25,
            textValue: 'hello',
            blobValue: blob,
        });
        expect(Buffer.isBuffer(row?.blobValue)).toBe(true);
    });
});

describe('NativeDatabase lifecycle', () => {
    it('commits successful transactions, forwards arguments, and returns callback values', () => {
        const database = open();
        database.exec('CREATE TABLE items (value TEXT)');
        const insert = database.prepare('INSERT INTO items(value) VALUES (?)');
        const add = database.transaction((left: string, right: string) => {
            insert.run(left);
            insert.run(right);
            return `${left}:${right}`;
        });
        expect(add('a', 'b')).toBe('a:b');
        expect(database.prepare('SELECT value FROM items ORDER BY rowid').all()).toEqual([
            { value: 'a' },
            { value: 'b' },
        ]);
    });

    it('rolls back when a transaction callback throws', () => {
        const database = open();
        database.exec('CREATE TABLE items (value TEXT)');
        const insert = database.prepare('INSERT INTO items(value) VALUES (?)');
        const fail = database.transaction(() => {
            insert.run('discarded');
            throw new Error('stop');
        });
        expect(fail).toThrow('stop');
        expect(database.prepare('SELECT value FROM items').all()).toEqual([]);
    });

    it('rejects asynchronous transaction callbacks before committing their writes', () => {
        const database = open();
        database.exec('CREATE TABLE items (value TEXT)');
        const insert = database.prepare('INSERT INTO items(value) VALUES (?)');
        const invalid = database.transaction(() => {
            insert.run('discarded');
            return Promise.resolve('too late');
        });
        expect(invalid).toThrow('transaction callbacks must be synchronous');
        expect(database.prepare('SELECT value FROM items').all()).toEqual([]);
    });

    it('supports pragma rows and simple values', () => {
        const database = open();
        database.pragma('user_version = 17');
        expect(database.pragma('user_version')).toEqual([{ user_version: 17 }]);
        expect(database.pragma('user_version', { simple: true })).toBe(17);
    });

    it('opens an existing database readonly', () => {
        const file = path.join(directory, 'readonly.db');
        const writer = open(file);
        writer.exec('CREATE TABLE items (value TEXT); INSERT INTO items VALUES (\'saved\')');
        writer.close();

        const reader = open(file, { readonly: true });
        expect(reader.prepare('SELECT value FROM items').get()).toEqual({ value: 'saved' });
        expect(() => reader.prepare('INSERT INTO items VALUES (?)').run('blocked')).toThrow();
    });

    it('invalidates the database and retained statements on close', () => {
        const database = open();
        const statement = database.prepare('SELECT 1 AS value');
        database.close();
        expect(() => database.exec('SELECT 1')).toThrow('database connection is closed');
        expect(() => statement.get()).toThrow('database connection is closed');
    });
});

describe('SQLite features and errors', () => {
    it('attaches the extended SQLite error code', () => {
        const database = open();
        database.exec('CREATE TABLE unique_items (value TEXT UNIQUE); INSERT INTO unique_items VALUES (\'same\')');
        try {
            database.prepare('INSERT INTO unique_items VALUES (?)').run('same');
            throw new Error('expected a constraint error');
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error & { code?: number }).code).toBe(2067);
        }
    });

    it('includes FTS5 in the bundled SQLite build', () => {
        const database = open();
        database.exec("CREATE VIRTUAL TABLE search USING fts5(content); INSERT INTO search VALUES ('native sqlite works')");
        expect(database.prepare("SELECT content FROM search WHERE search MATCH 'sqlite'").all()).toEqual([
            { content: 'native sqlite works' },
        ]);
    });
});
