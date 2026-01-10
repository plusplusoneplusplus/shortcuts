/**
 * Tests for CSV Reader
 *
 * Comprehensive tests for CSV parsing functionality.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
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
} from '../../../shortcuts/yaml-pipeline/csv-reader';

suite('CSV Reader', () => {
    suite('parseCSVContent', () => {
        suite('basic parsing', () => {
            test('parses simple CSV with headers', () => {
                const csv = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
                const result = parseCSVContent(csv);

                assert.deepStrictEqual(result.headers, ['name', 'age', 'city']);
                assert.strictEqual(result.rowCount, 2);
                assert.strictEqual(result.items.length, 2);

                assert.deepStrictEqual(result.items[0], { name: 'Alice', age: '30', city: 'NYC' });
                assert.deepStrictEqual(result.items[1], { name: 'Bob', age: '25', city: 'LA' });
            });

            test('parses CSV with single row', () => {
                const csv = 'id,value\n1,test';
                const result = parseCSVContent(csv);

                assert.strictEqual(result.rowCount, 1);
                assert.deepStrictEqual(result.items[0], { id: '1', value: 'test' });
            });

            test('parses empty CSV', () => {
                const csv = '';
                const result = parseCSVContent(csv);

                assert.strictEqual(result.rowCount, 0);
                assert.deepStrictEqual(result.items, []);
                assert.deepStrictEqual(result.headers, []);
            });

            test('parses CSV with only headers', () => {
                const csv = 'name,age,city';
                const result = parseCSVContent(csv);

                assert.deepStrictEqual(result.headers, ['name', 'age', 'city']);
                assert.strictEqual(result.rowCount, 0);
                assert.deepStrictEqual(result.items, []);
            });

            test('handles Windows line endings (CRLF)', () => {
                const csv = 'a,b\r\n1,2\r\n3,4';
                const result = parseCSVContent(csv);

                assert.strictEqual(result.rowCount, 2);
                assert.deepStrictEqual(result.items[0], { a: '1', b: '2' });
                assert.deepStrictEqual(result.items[1], { a: '3', b: '4' });
            });

            test('handles old Mac line endings (CR)', () => {
                const csv = 'a,b\r1,2\r3,4';
                const result = parseCSVContent(csv);

                assert.strictEqual(result.rowCount, 2);
            });

            test('trims header whitespace', () => {
                const csv = ' name , age , city \nAlice,30,NYC';
                const result = parseCSVContent(csv);

                assert.deepStrictEqual(result.headers, ['name', 'age', 'city']);
            });
        });

        suite('quoted values', () => {
            test('parses quoted values', () => {
                const csv = 'name,description\n"Alice","Hello, World"';
                const result = parseCSVContent(csv);

                assert.deepStrictEqual(result.items[0], {
                    name: 'Alice',
                    description: 'Hello, World'
                });
            });

            test('handles escaped quotes (double quotes)', () => {
                const csv = 'name,quote\n"Alice","She said ""Hello"""';
                const result = parseCSVContent(csv);

                assert.deepStrictEqual(result.items[0], {
                    name: 'Alice',
                    quote: 'She said "Hello"'
                });
            });

            test('handles multi-line quoted values', () => {
                const csv = 'name,description\n"Alice","Line 1\nLine 2\nLine 3"';
                const result = parseCSVContent(csv);

                assert.deepStrictEqual(result.items[0], {
                    name: 'Alice',
                    description: 'Line 1\nLine 2\nLine 3'
                });
            });

            test('handles empty quoted values', () => {
                const csv = 'name,value\n"Alice",""';
                const result = parseCSVContent(csv);

                assert.deepStrictEqual(result.items[0], { name: 'Alice', value: '' });
            });

            test('handles quoted values with only spaces', () => {
                const csv = 'name,value\n"Alice","   "';
                const result = parseCSVContent(csv);

                assert.deepStrictEqual(result.items[0], { name: 'Alice', value: '   ' });
            });
        });

        suite('delimiters', () => {
            test('uses custom delimiter (semicolon)', () => {
                const csv = 'name;age;city\nAlice;30;NYC';
                const result = parseCSVContent(csv, { delimiter: ';' });

                assert.deepStrictEqual(result.items[0], { name: 'Alice', age: '30', city: 'NYC' });
            });

            test('uses custom delimiter (tab)', () => {
                const csv = 'name\tage\tcity\nAlice\t30\tNYC';
                const result = parseCSVContent(csv, { delimiter: '\t' });

                assert.deepStrictEqual(result.items[0], { name: 'Alice', age: '30', city: 'NYC' });
            });

            test('uses custom delimiter (pipe)', () => {
                const csv = 'name|age|city\nAlice|30|NYC';
                const result = parseCSVContent(csv, { delimiter: '|' });

                assert.deepStrictEqual(result.items[0], { name: 'Alice', age: '30', city: 'NYC' });
            });
        });

        suite('no headers mode', () => {
            test('generates default headers when hasHeaders is false', () => {
                const csv = 'Alice,30,NYC\nBob,25,LA';
                const result = parseCSVContent(csv, { hasHeaders: false });

                assert.deepStrictEqual(result.headers, ['col0', 'col1', 'col2']);
                assert.strictEqual(result.rowCount, 2);
                assert.deepStrictEqual(result.items[0], { col0: 'Alice', col1: '30', col2: 'NYC' });
            });
        });

        suite('edge cases', () => {
            test('handles missing values (fewer columns than headers)', () => {
                const csv = 'a,b,c\n1,2\n3';
                const result = parseCSVContent(csv);

                assert.deepStrictEqual(result.items[0], { a: '1', b: '2', c: '' });
                assert.deepStrictEqual(result.items[1], { a: '3', b: '', c: '' });
            });

            test('handles extra values (more columns than headers)', () => {
                const csv = 'a,b\n1,2,3,4';
                const result = parseCSVContent(csv);

                // Extra values are ignored
                assert.deepStrictEqual(result.items[0], { a: '1', b: '2' });
            });

            test('handles Unicode characters', () => {
                const csv = 'name,emoji\n日本語,🎉\nПривет,👋';
                const result = parseCSVContent(csv);

                assert.deepStrictEqual(result.items[0], { name: '日本語', emoji: '🎉' });
                assert.deepStrictEqual(result.items[1], { name: 'Привет', emoji: '👋' });
            });

            test('handles values with leading/trailing spaces', () => {
                const csv = 'name,value\n  Alice  ,  hello  ';
                const result = parseCSVContent(csv);

                // Values are NOT trimmed (only headers are)
                assert.deepStrictEqual(result.items[0], { name: '  Alice  ', value: '  hello  ' });
            });

            test('throws on duplicate headers', () => {
                const csv = 'name,name,age\nAlice,Bob,30';

                assert.throws(() => parseCSVContent(csv), CSVParseError);
            });

            test('handles numeric-looking values as strings', () => {
                const csv = 'id,value\n001,00123';
                const result = parseCSVContent(csv);

                assert.strictEqual(result.items[0].id, '001');
                assert.strictEqual(result.items[0].value, '00123');
            });
        });
    });

    suite('file operations', () => {
        let tempDir: string;

        setup(async () => {
            tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csv-test-'));
        });

        teardown(async () => {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        });

        suite('readCSVFile', () => {
            test('reads CSV file asynchronously', async () => {
                const csvPath = path.join(tempDir, 'test.csv');
                await fs.promises.writeFile(csvPath, 'name,age\nAlice,30\nBob,25');

                const result = await readCSVFile(csvPath);

                assert.strictEqual(result.rowCount, 2);
                assert.deepStrictEqual(result.items[0], { name: 'Alice', age: '30' });
            });

            test('throws CSVParseError for missing file', async () => {
                const csvPath = path.join(tempDir, 'nonexistent.csv');

                await assert.rejects(
                    async () => readCSVFile(csvPath),
                    CSVParseError
                );
            });

            test('reads file with custom encoding', async () => {
                const csvPath = path.join(tempDir, 'test.csv');
                await fs.promises.writeFile(csvPath, 'name,value\ntest,hello', 'utf-8');

                const result = await readCSVFile(csvPath, { encoding: 'utf-8' });

                assert.strictEqual(result.rowCount, 1);
            });
        });

        suite('readCSVFileSync', () => {
            test('reads CSV file synchronously', () => {
                const csvPath = path.join(tempDir, 'test.csv');
                fs.writeFileSync(csvPath, 'name,age\nAlice,30');

                const result = readCSVFileSync(csvPath);

                assert.strictEqual(result.rowCount, 1);
                assert.deepStrictEqual(result.items[0], { name: 'Alice', age: '30' });
            });

            test('throws CSVParseError for missing file', () => {
                const csvPath = path.join(tempDir, 'nonexistent.csv');

                assert.throws(() => readCSVFileSync(csvPath), CSVParseError);
            });
        });
    });

    suite('resolveCSVPath', () => {
        test('returns absolute path unchanged', () => {
            const absPath = '/home/user/data.csv';
            const result = resolveCSVPath(absPath, '/workspace');

            assert.strictEqual(result, absPath);
        });

        test('resolves relative path against working directory', () => {
            const result = resolveCSVPath('./data.csv', '/workspace');

            assert.strictEqual(result, path.resolve('/workspace', './data.csv'));
        });

        test('resolves parent directory references', () => {
            const result = resolveCSVPath('../data/file.csv', '/workspace/project');

            assert.strictEqual(result, path.resolve('/workspace/project', '../data/file.csv'));
        });
    });

    suite('validateCSVHeaders', () => {
        test('returns valid for all expected columns present', () => {
            const result = validateCSVHeaders(
                ['name', 'age', 'city'],
                ['name', 'age']
            );

            assert.strictEqual(result.valid, true);
            assert.deepStrictEqual(result.missingColumns, []);
        });

        test('returns invalid with missing columns', () => {
            const result = validateCSVHeaders(
                ['name', 'age'],
                ['name', 'age', 'city', 'country']
            );

            assert.strictEqual(result.valid, false);
            assert.deepStrictEqual(result.missingColumns, ['city', 'country']);
        });

        test('handles empty expected columns', () => {
            const result = validateCSVHeaders(['name', 'age'], []);

            assert.strictEqual(result.valid, true);
            assert.deepStrictEqual(result.missingColumns, []);
        });

        test('handles empty headers', () => {
            const result = validateCSVHeaders([], ['name']);

            assert.strictEqual(result.valid, false);
            assert.deepStrictEqual(result.missingColumns, ['name']);
        });
    });

    suite('getCSVPreview', () => {
        test('returns first N items', () => {
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

            assert.strictEqual(preview.length, 3);
            assert.deepStrictEqual(preview[0], { name: 'Alice' });
            assert.deepStrictEqual(preview[2], { name: 'Charlie' });
        });

        test('returns all items if fewer than maxRows', () => {
            const result = {
                items: [{ name: 'Alice' }, { name: 'Bob' }],
                headers: ['name'],
                rowCount: 2
            };

            const preview = getCSVPreview(result, 5);

            assert.strictEqual(preview.length, 2);
        });

        test('uses default maxRows of 5', () => {
            const result = {
                items: Array.from({ length: 10 }, (_, i) => ({ name: `User${i}` })),
                headers: ['name'],
                rowCount: 10
            };

            const preview = getCSVPreview(result);

            assert.strictEqual(preview.length, 5);
        });
    });

    suite('DEFAULT_CSV_OPTIONS', () => {
        test('has correct default values', () => {
            assert.strictEqual(DEFAULT_CSV_OPTIONS.delimiter, ',');
            assert.strictEqual(DEFAULT_CSV_OPTIONS.hasHeaders, true);
            assert.strictEqual(DEFAULT_CSV_OPTIONS.encoding, 'utf-8');
        });
    });

    suite('real-world CSV scenarios', () => {
        test('parses bug tracking CSV (from design doc)', () => {
            const csv = `id,title,description,priority
1,Login broken,Users can't login,high
2,Slow search,Search takes 10s,medium
3,UI glitch,"Button misaligned on mobile",low`;

            const result = parseCSVContent(csv);

            assert.strictEqual(result.rowCount, 3);
            assert.deepStrictEqual(result.headers, ['id', 'title', 'description', 'priority']);

            assert.deepStrictEqual(result.items[0], {
                id: '1',
                title: 'Login broken',
                description: "Users can't login",
                priority: 'high'
            });

            assert.deepStrictEqual(result.items[2], {
                id: '3',
                title: 'UI glitch',
                description: 'Button misaligned on mobile',
                priority: 'low'
            });
        });

        test('parses CSV with commas in quoted fields', () => {
            const csv = `name,address,phone
"Smith, John","123 Main St, Apt 4",555-1234
"Doe, Jane","456 Oak Ave, Suite 100",555-5678`;

            const result = parseCSVContent(csv);

            assert.strictEqual(result.rowCount, 2);
            assert.strictEqual(result.items[0].name, 'Smith, John');
            assert.strictEqual(result.items[0].address, '123 Main St, Apt 4');
        });
    });
});
