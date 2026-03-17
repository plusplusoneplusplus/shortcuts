/**
 * Tests for CSV Reader
 *
 * Comprehensive tests for CSV parsing functionality.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    parseCSVContent,
    readCSVFile,
    readCSVFileSync,
    resolveCSVPath,
    validateCSVHeaders,
    getCSVPreview,
    CSVParseError,
    DEFAULT_CSV_OPTIONS
} from '../../src/pipeline/csv-reader';

describe('CSV Reader', () => {
    describe('parseCSVContent', () => {
        describe('basic parsing', () => {
            it('parses simple CSV with headers', () => {
                const csv = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
                const result = parseCSVContent(csv);

                expect(result.headers).toEqual(['name', 'age', 'city']);
                expect(result.rowCount).toBe(2);
                expect(result.items.length).toBe(2);

                expect(result.items[0]).toEqual({ name: 'Alice', age: '30', city: 'NYC' });
                expect(result.items[1]).toEqual({ name: 'Bob', age: '25', city: 'LA' });
            });

            it('parses CSV with single row', () => {
                const csv = 'id,value\n1,test';
                const result = parseCSVContent(csv);

                expect(result.rowCount).toBe(1);
                expect(result.items[0]).toEqual({ id: '1', value: 'test' });
            });

            it('parses empty CSV', () => {
                const csv = '';
                const result = parseCSVContent(csv);

                expect(result.rowCount).toBe(0);
                expect(result.items).toEqual([]);
                expect(result.headers).toEqual([]);
            });

            it('parses CSV with only headers', () => {
                const csv = 'name,age,city';
                const result = parseCSVContent(csv);

                expect(result.headers).toEqual(['name', 'age', 'city']);
                expect(result.rowCount).toBe(0);
                expect(result.items).toEqual([]);
            });

            it('handles Windows line endings (CRLF)', () => {
                const csv = 'a,b\r\n1,2\r\n3,4';
                const result = parseCSVContent(csv);

                expect(result.rowCount).toBe(2);
                expect(result.items[0]).toEqual({ a: '1', b: '2' });
                expect(result.items[1]).toEqual({ a: '3', b: '4' });
            });

            it('handles old Mac line endings (CR)', () => {
                const csv = 'a,b\r1,2\r3,4';
                const result = parseCSVContent(csv);

                expect(result.rowCount).toBe(2);
            });

            it('trims header whitespace', () => {
                const csv = ' name , age , city \nAlice,30,NYC';
                const result = parseCSVContent(csv);

                expect(result.headers).toEqual(['name', 'age', 'city']);
            });
        });

        describe('quoted values', () => {
            it('parses quoted values', () => {
                const csv = 'name,description\n"Alice","Hello, World"';
                const result = parseCSVContent(csv);

                expect(result.items[0]).toEqual({
                    name: 'Alice',
                    description: 'Hello, World'
                });
            });

            it('handles escaped quotes (double quotes)', () => {
                const csv = 'name,quote\n"Alice","She said ""Hello"""';
                const result = parseCSVContent(csv);

                expect(result.items[0]).toEqual({
                    name: 'Alice',
                    quote: 'She said "Hello"'
                });
            });

            it('handles multi-line quoted values', () => {
                const csv = 'name,description\n"Alice","Line 1\nLine 2\nLine 3"';
                const result = parseCSVContent(csv);

                expect(result.items[0]).toEqual({
                    name: 'Alice',
                    description: 'Line 1\nLine 2\nLine 3'
                });
            });

            it('handles empty quoted values', () => {
                const csv = 'name,value\n"Alice",""';
                const result = parseCSVContent(csv);

                expect(result.items[0]).toEqual({ name: 'Alice', value: '' });
            });

            it('handles quoted values with only spaces', () => {
                const csv = 'name,value\n"Alice","   "';
                const result = parseCSVContent(csv);

                expect(result.items[0]).toEqual({ name: 'Alice', value: '   ' });
            });
        });

        describe('delimiters', () => {
            it('uses custom delimiter (semicolon)', () => {
                const csv = 'name;age;city\nAlice;30;NYC';
                const result = parseCSVContent(csv, { delimiter: ';' });

                expect(result.items[0]).toEqual({ name: 'Alice', age: '30', city: 'NYC' });
            });

            it('uses custom delimiter (tab)', () => {
                const csv = 'name\tage\tcity\nAlice\t30\tNYC';
                const result = parseCSVContent(csv, { delimiter: '\t' });

                expect(result.items[0]).toEqual({ name: 'Alice', age: '30', city: 'NYC' });
            });

            it('uses custom delimiter (pipe)', () => {
                const csv = 'name|age|city\nAlice|30|NYC';
                const result = parseCSVContent(csv, { delimiter: '|' });

                expect(result.items[0]).toEqual({ name: 'Alice', age: '30', city: 'NYC' });
            });
        });

        describe('no headers mode', () => {
            it('generates default headers when hasHeaders is false', () => {
                const csv = 'Alice,30,NYC\nBob,25,LA';
                const result = parseCSVContent(csv, { hasHeaders: false });

                expect(result.headers).toEqual(['col0', 'col1', 'col2']);
                expect(result.rowCount).toBe(2);
                expect(result.items[0]).toEqual({ col0: 'Alice', col1: '30', col2: 'NYC' });
            });
        });

        describe('edge cases', () => {
            it('handles missing values (fewer columns than headers)', () => {
                const csv = 'a,b,c\n1,2\n3';
                const result = parseCSVContent(csv);

                expect(result.items[0]).toEqual({ a: '1', b: '2', c: '' });
                expect(result.items[1]).toEqual({ a: '3', b: '', c: '' });
            });

            it('handles extra values (more columns than headers)', () => {
                const csv = 'a,b\n1,2,3,4';
                const result = parseCSVContent(csv);

                // Extra values are ignored
                expect(result.items[0]).toEqual({ a: '1', b: '2' });
            });

            it('handles Unicode characters', () => {
                const csv = 'name,emoji\n日本語,🎉\nПривет,👋';
                const result = parseCSVContent(csv);

                expect(result.items[0]).toEqual({ name: '日本語', emoji: '🎉' });
                expect(result.items[1]).toEqual({ name: 'Привет', emoji: '👋' });
            });

            it('handles values with leading/trailing spaces', () => {
                const csv = 'name,value\n  Alice  ,  hello  ';
                const result = parseCSVContent(csv);

                // Values are NOT trimmed (only headers are)
                expect(result.items[0]).toEqual({ name: '  Alice  ', value: '  hello  ' });
            });

            it('throws on duplicate headers', () => {
                const csv = 'name,name,age\nAlice,Bob,30';

                expect(() => parseCSVContent(csv)).toThrow(CSVParseError);
            });

            it('handles numeric-looking values as strings', () => {
                const csv = 'id,value\n001,00123';
                const result = parseCSVContent(csv);

                expect(result.items[0].id).toBe('001');
                expect(result.items[0].value).toBe('00123');
            });
        });
    });

    describe('file operations', () => {
        let tempDir: string;

        beforeEach(async () => {
            tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-test-'));
        });

        afterEach(async () => {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        });

        describe('readCSVFile', () => {
            it('reads CSV file asynchronously', async () => {
                const csvPath = path.join(tempDir, 'test.csv');
                await fs.promises.writeFile(csvPath, 'name,age\nAlice,30\nBob,25');

                const result = await readCSVFile(csvPath);

                expect(result.rowCount).toBe(2);
                expect(result.items[0]).toEqual({ name: 'Alice', age: '30' });
            });

            it('throws CSVParseError for missing file', async () => {
                const csvPath = path.join(tempDir, 'nonexistent.csv');

                await expect(readCSVFile(csvPath)).rejects.toThrow(CSVParseError);
            });

            it('reads file with custom encoding', async () => {
                const csvPath = path.join(tempDir, 'test.csv');
                await fs.promises.writeFile(csvPath, 'name,value\ntest,hello', 'utf-8');

                const result = await readCSVFile(csvPath, { encoding: 'utf-8' });

                expect(result.rowCount).toBe(1);
            });
        });

        describe('readCSVFileSync', () => {
            it('reads CSV file synchronously', () => {
                const csvPath = path.join(tempDir, 'test.csv');
                fs.writeFileSync(csvPath, 'name,age\nAlice,30');

                const result = readCSVFileSync(csvPath);

                expect(result.rowCount).toBe(1);
                expect(result.items[0]).toEqual({ name: 'Alice', age: '30' });
            });

            it('throws CSVParseError for missing file', () => {
                const csvPath = path.join(tempDir, 'nonexistent.csv');

                expect(() => readCSVFileSync(csvPath)).toThrow(CSVParseError);
            });
        });
    });

    describe('resolveCSVPath', () => {
        it('returns absolute path unchanged', () => {
            const absPath = '/home/user/data.csv';
            const result = resolveCSVPath(absPath, '/workspace');

            expect(result).toBe(absPath);
        });

        it('resolves relative path against working directory', () => {
            const result = resolveCSVPath('./data.csv', '/workspace');

            expect(result).toBe(path.resolve('/workspace', './data.csv'));
        });

        it('resolves parent directory references', () => {
            const result = resolveCSVPath('../data/file.csv', '/workspace/project');

            expect(result).toBe(path.resolve('/workspace/project', '../data/file.csv'));
        });
    });

    describe('validateCSVHeaders', () => {
        it('returns valid for all expected columns present', () => {
            const result = validateCSVHeaders(
                ['name', 'age', 'city'],
                ['name', 'age']
            );

            expect(result.valid).toBe(true);
            expect(result.missingColumns).toEqual([]);
        });

        it('returns invalid with missing columns', () => {
            const result = validateCSVHeaders(
                ['name', 'age'],
                ['name', 'age', 'city', 'country']
            );

            expect(result.valid).toBe(false);
            expect(result.missingColumns).toEqual(['city', 'country']);
        });

        it('handles empty expected columns', () => {
            const result = validateCSVHeaders(['name', 'age'], []);

            expect(result.valid).toBe(true);
            expect(result.missingColumns).toEqual([]);
        });

        it('handles empty headers', () => {
            const result = validateCSVHeaders([], ['name']);

            expect(result.valid).toBe(false);
            expect(result.missingColumns).toEqual(['name']);
        });
    });

    describe('getCSVPreview', () => {
        it('returns first N items', () => {
            const result = {
                items: [
                    { name: 'Alice' },
                    { name: 'Bob' },
                    { name: 'Charlie' },
                    { name: 'Diana' },
                    { name: 'Eve' },
                    { name: 'Frank' }
                ],
                headers: ['name'],
                rowCount: 6
            };

            const preview = getCSVPreview(result, 3);

            expect(preview.length).toBe(3);
            expect(preview[0]).toEqual({ name: 'Alice' });
            expect(preview[2]).toEqual({ name: 'Charlie' });
        });

        it('returns all items if fewer than maxRows', () => {
            const result = {
                items: [{ name: 'Alice' }, { name: 'Bob' }],
                headers: ['name'],
                rowCount: 2
            };

            const preview = getCSVPreview(result, 5);

            expect(preview.length).toBe(2);
        });

        it('uses default maxRows of 5', () => {
            const result = {
                items: Array.from({ length: 10 }, (_, i) => ({ name: `User${i}` })),
                headers: ['name'],
                rowCount: 10
            };

            const preview = getCSVPreview(result);

            expect(preview.length).toBe(5);
        });
    });

    describe('DEFAULT_CSV_OPTIONS', () => {
        it('has correct default values', () => {
            expect(DEFAULT_CSV_OPTIONS.delimiter).toBe(',');
            expect(DEFAULT_CSV_OPTIONS.hasHeaders).toBe(true);
            expect(DEFAULT_CSV_OPTIONS.encoding).toBe('utf-8');
        });
    });

    describe('real-world CSV scenarios', () => {
        it('parses bug tracking CSV (from design doc)', () => {
            const csv = `id,title,description,priority
1,Login broken,Users can't login,high
2,Slow search,Search takes 10s,medium
3,UI glitch,"Button misaligned on mobile",low`;

            const result = parseCSVContent(csv);

            expect(result.rowCount).toBe(3);
            expect(result.headers).toEqual(['id', 'title', 'description', 'priority']);

            expect(result.items[0]).toEqual({
                id: '1',
                title: 'Login broken',
                description: "Users can't login",
                priority: 'high'
            });

            expect(result.items[2]).toEqual({
                id: '3',
                title: 'UI glitch',
                description: 'Button misaligned on mobile',
                priority: 'low'
            });
        });

        it('parses CSV with commas in quoted fields', () => {
            const csv = `name,address,phone
"Smith, John","123 Main St, Apt 4",555-1234
"Doe, Jane","456 Oak Ave, Suite 100",555-5678`;

            const result = parseCSVContent(csv);

            expect(result.rowCount).toBe(2);
            expect(result.items[0].name).toBe('Smith, John');
            expect(result.items[0].address).toBe('123 Main St, Apt 4');
        });
    });
});
