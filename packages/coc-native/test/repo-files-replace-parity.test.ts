/**
 * Differential test: Rust `RepoFiles.replaceContent` against the JavaScript
 * `RegExp` engine it replaced. The oracle below is the former TypeScript
 * implementation, kept here as the reference. Every case searches a line with
 * JS, sends every hit back as a target, and expects byte-identical output —
 * plus the same accept/reject decision for every pattern.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadNativeRepoFiles } from '../src/repo-files';
import { removeDir } from './helpers';

interface Options {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    preserveCase?: boolean;
}

function oracleMatcher(query: string, o: Options): RegExp {
    const body = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(o.wholeWord ? `\\b(?:${body})\\b` : body, o.caseSensitive ? 'g' : 'gi');
}

function oraclePreserveCase(matched: string, replacement: string): string {
    if (!matched || !replacement || !/[a-z]/i.test(matched)) return replacement;
    if (matched === matched.toUpperCase() && matched !== matched.toLowerCase()) return replacement.toUpperCase();
    if (matched === matched.toLowerCase()) return replacement.toLowerCase();
    if (matched[0] === matched[0].toUpperCase() && matched.slice(1) === matched.slice(1).toLowerCase()) {
        return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
    }
    return replacement;
}

function oracleExpand(replacement: string, m: RegExpExecArray, regex: boolean): string {
    if (!regex) return replacement;
    return replacement.replace(/\$(\$|&|\d{1,2})/g, (whole, token: string) => {
        if (token === '$') return '$';
        if (token === '&') return m[0];
        return m[Number(token)] ?? whole;
    });
}

/** Every hit on `line`, as targets, and the line with all of them replaced. */
function oracle(line: string, query: string, replacement: string, o: Options) {
    const re = oracleMatcher(query, o);
    const hits: RegExpExecArray[] = [];
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(line)) !== null) {
        hits.push(hit);
        if (hit[0].length === 0) re.lastIndex++;
    }
    let text = line;
    for (const m of [...hits].reverse()) {
        const expanded = oracleExpand(replacement, m, o.regex ?? false);
        const cased = o.preserveCase ? oraclePreserveCase(m[0], expanded) : expanded;
        text = text.slice(0, m.index) + cased + text.slice(m.index + m[0].length);
    }
    const targets = hits.map((m) => ({ line: 1, text: line, startColumn: m.index, endColumn: m.index + m[0].length }));
    return { targets, text };
}

const regex = { regex: true };
const CASES: [line: string, query: string, replacement: string, options: Options][] = [
    ['foo Foo FOO fOo', 'foo', 'bar', { preserveCase: true }],
    ['𐐀abc', '𐐀abc', 'bAr', { preserveCase: true }],
    ['𐐨abc', '𐐨abc', 'bAr', { preserveCase: true }],
    ['𐐀Abc', '𐐀Abc', 'bAr', { preserveCase: true }],
    ['𐐀ABC', '𐐀ABC', 'bAr', { preserveCase: true }],
    ['Abc', 'Abc', '𐐨XYZ', { preserveCase: true }],
    ['Abc', 'Abc', '𐐀XYZ', { preserveCase: true }],
    ['𐐀abc', '𐐀abc', '𐐨XYZ', { preserveCase: true }],
    ['𐐀abc', '𐐀abc', '𐐀XYZ', { preserveCase: true }],
    ['𐐀abc', '𐐀abc', 'ßXYZ', { preserveCase: true }],
    ['𐐀abc', '𐐀abc', '😀XYZ', { preserveCase: true }],
    ['𐐀abc', '(𐐀)(abc)', '$1XYZ', { regex: true, preserveCase: true }],
    ['foo Foo FOO', 'foo', 'bar', { caseSensitive: true }],
    ['a.c abc a.c', 'a.c', '$&!', {}],
    ['price $5', '$5', '$$6', {}],
    ['needle needles', 'needle', 'pin', { wholeWord: true }],
    ['user@host other@box', '(\\w+)@(\\w+)', '$2/$1 [$&] $$ $9 $0 $01 $12', regex],
    ['b ab', '(a)?b', '<$1>', regex],
    ['aaa', 'a*', '-', regex],
    ['abc', '(?=b)', '|', regex],
    ['xab', '(?<=a)b', 'B', regex],
    ['k-v', '(?<key>\\w)-(?<val>\\w)', '$<val>=$<key> $2$1', regex],
    ['a]b{c}', ']', '#', regex],
    ['a{b', 'a{', '#', regex],
    ['a{1}', 'a{1}', '#', regex],
    ['p{L} x', '\\p{L}', '#', regex],
    ['A\x42 C', '\\u0041\\x42', '#', regex],
    ['back\bspace', '[\\b]', '#', regex],
    ['aa ab', '(a)\\1', '#', regex],
    ['😀 😀x', '.', '_', regex],
    ['😀a', '\\uD83D', '_', regex],

    ['😀a', '\\uD83D', '$&', { regex: true, preserveCase: true }],
    ['😀a', '\\uDE00', '$0', { regex: true, preserveCase: true }],
    ['😀😀', '.', '$&', { regex: true, preserveCase: true }],
    ['😀a', '(\\uD83D)a?', '$1', { regex: true, preserveCase: true }],
    ['a😀', '(a)(\\uD83D)', '$1$2', { regex: true, preserveCase: true }],
    ['A😀', '(A)(\\uD83D)', '$1$2', { regex: true, preserveCase: true }],
    ['Ab😀', '(Ab)(\\uD83D)', '$1$2', { regex: true, preserveCase: true }],
    ['aB😀', '(aB)(\\uD83D)', '$1$2', { regex: true, preserveCase: true }],
    ['😀Ab', '(\\uDE00)(Ab)', '$1$2', { regex: true, preserveCase: true }],
    ['😀a', '(\\uD83D)(\\uDE00)a', '$1x$2', { regex: true, preserveCase: true }],
    ['a😀', '(a)(\\uD83D)', 'ΟΣ$2', { regex: true, preserveCase: true }],
    ['Ab😀', '(Ab)(\\uD83D)', 'xΟΣ$2', { regex: true, preserveCase: true }],
    ['Ünïcödé ÜNÏCÖDÉ', 'ünïcödé', 'x', {}],
    ['straße STRASSE', 'ß', 'ss', {}],
    ['ſ s S K k', '[a-z]', '.', regex],
    ['ſ s S K k', '\\w', '.', regex],
    ['é word', '\\bword\\b', 'W', regex],
    ['café cafe', 'caf\\w', 'X', regex],
    ['line end', 'end$', 'END', regex],
    ['start here', '^start', 'S', regex],
    ['aaaa', 'a{2,}?', 'b', regex],
    ['ÀB àb', 'àb', 'xyz', { preserveCase: true }],
    ['Σίσυφος', 'σ', 'x', {}],
    ['tab\there', '\\t', '\\n', regex],
    ['a.b', '\\.', '$', regex],
    ['\\d+ 42', '\\d+', '#', {}],
    ['x ( y', '(', ')', {}],
];

const BAD = ['[', ')', '\\', 'a{3,2}', '(?<1>a)', "('quoted", '(`globalThis.injected = true', '(unclosed', '[z-a]', 'a**', '(?<n>a)(?<n>b)', '\\k<nope>(?<n>a)', '(?<=a', '+a'];
const ACCEPTED = ['(?i:a)', '\\k', 'a{,2}', '{', '}', '\\c', '\\q', '[\\d-z]', '(?:)', 'a|', '\\8', '\\1(a)', '\\0'];

const addon = loadNativeRepoFiles();
let root: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-replace-parity-'));
});

afterAll(() => removeDir(root));

describe('replaceContent matches JavaScript RegExp', () => {
    it.each(CASES.map((c, i) => [i, ...c] as const))('case %i: %j / %j', async (i, line, query, replacement, options) => {
        const expected = oracle(line, query, replacement, options);
        expect(expected.targets.length, 'oracle finds hits').toBeGreaterThan(0);
        const file = `case-${i}.txt`;
        fs.writeFileSync(path.join(root, file), `${line}\r\nkeep\n`);

        const result = await addon
            .openRepoFiles(root)
            .replaceContent(query, replacement, [{ path: file, targets: expected.targets }], options);

        expect(result).toEqual({ replacedMatches: expected.targets.length, replacedFiles: 1, skipped: [] });
        // A lone surrogate is written as U+FFFD, exactly as `fs.writeFile` would.
        const written = Buffer.from(`${expected.text}\r\nkeep\n`, 'utf-8').toString('utf-8');
        expect(fs.readFileSync(path.join(root, file), 'utf-8')).toBe(written);
    });

    it.each(BAD.flatMap((query) => [false, true].flatMap((wholeWord) => [false, true].map((caseSensitive) => ({ query, wholeWord, caseSensitive })))))
        ('preserves Node diagnostics for $query ($wholeWord, $caseSensitive)', async ({ query, wholeWord, caseSensitive }) => {
            const options = { regex: true, wholeWord, caseSensitive };
            let message = '';
            try {
                oracleMatcher(query, options);
            } catch (error) {
                message = `Invalid regular expression: ${(error as Error).message}`;
            }
            expect(message).not.toBe('');
            const files = addon.openRepoFiles(root);
            const file = 'invalid-query.txt';
            fs.writeFileSync(path.join(root, file), 'keep');
            try {
                await expect(files.replaceContent(query, 'changed', [{ path: file, targets: [
                    { line: 1, text: 'keep', startColumn: 0, endColumn: 4 },
                ] }], options)).rejects.toMatchObject({ code: 'InvalidArg', message });
                expect(fs.readFileSync(path.join(root, file), 'utf-8')).toBe('keep');
            } finally {
                files.dispose();
            }
        });

    it('keeps query validation and disposed-handle errors ahead of regex diagnostics', async () => {
        const files = addon.openRepoFiles(root);
        await expect(files.replaceContent('', '', [], { regex: true })).rejects.toMatchObject({
            code: 'InvalidArg', message: 'Missing required field: query',
        });
        await expect(files.replaceContent('(\n', '', [], { regex: true })).rejects.toMatchObject({
            code: 'InvalidArg', message: 'Replace does not support multi-line queries',
        });
        files.dispose();
        await expect(files.replaceContent('(', '', [], { regex: true })).rejects.toMatchObject({ code: 'Closing' });
    });

    it('accepts and rejects the same patterns', async () => {
        const files = addon.openRepoFiles(root);
        for (const pattern of [...BAD, ...ACCEPTED]) {
            let jsAccepts = true;
            try {
                new RegExp(pattern, 'gi');
            } catch {
                jsAccepts = false;
            }
            const native = await files.replaceContent(pattern, 'x', [], { regex: true }).then(
                () => true,
                (err: { code?: string; message: string }) => {
                    expect(err.code).toBe('InvalidArg');
                    expect(err.message).toMatch(/^Invalid regular expression: /);
                    return false;
                },
            );
            expect(native, pattern).toBe(jsAccepts);
        }
        expect(BAD.every((p) => { try { new RegExp(p); return false; } catch { return true; } })).toBe(true);
    });
});
