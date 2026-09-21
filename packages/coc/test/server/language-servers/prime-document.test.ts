/**
 * Priming-document selection over temp-dir fixtures: which file a project
 * primes with, and the bounds that keep the search cheap.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { resolvePrimeDocument } from '../../../src/server/language-servers/prime-document';
import { TYPESCRIPT_PRESET } from '../../../src/server/language-servers/presets';

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-lsp-prime-'));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function write(relative: string, contents = 'export {};\n'): string {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, 'utf-8');
    return target;
}

describe('resolvePrimeDocument', () => {
    it('opens the shallowest matching file, in name order', () => {
        write('src/nested/aaa.ts');
        write('zebra.ts');
        write('alpha.ts');

        const document = resolvePrimeDocument(TYPESCRIPT_PRESET, root);

        expect(document?.uri).toBe(pathToFileURL(path.join(root, 'alpha.ts')).href);
    });

    it('carries the language id the extension maps to, so .tsx primes as React', () => {
        write('Component.tsx', 'export const Component = () => null;\n');

        const document = resolvePrimeDocument(TYPESCRIPT_PRESET, root);

        expect(document?.languageId).toBe('typescriptreact');
        expect(document?.text).toBe('export const Component = () => null;\n');
    });

    it('reads the file from disk so the server sees the project as it is', () => {
        write('main.ts', 'export const answer = 42;\n');

        expect(resolvePrimeDocument(TYPESCRIPT_PRESET, root)?.text).toBe('export const answer = 42;\n');
    });

    it('ignores files the definition does not claim', () => {
        write('notes.md', '# nothing to compile\n');
        write('main.py', 'pass\n');

        expect(resolvePrimeDocument(TYPESCRIPT_PRESET, root)).toBeUndefined();
    });

    it('never primes from an excluded directory', () => {
        write('node_modules/dependency/index.ts');
        write('dist/bundle.ts');

        expect(resolvePrimeDocument(TYPESCRIPT_PRESET, root)).toBeUndefined();
    });

    it('stops descending at the depth bound', () => {
        write('a/b/c/deep.ts');

        expect(resolvePrimeDocument(TYPESCRIPT_PRESET, root, { maxDepth: 1 })).toBeUndefined();
        expect(resolvePrimeDocument(TYPESCRIPT_PRESET, root, { maxDepth: 3 })?.uri)
            .toBe(pathToFileURL(path.join(root, 'a', 'b', 'c', 'deep.ts')).href);
    });

    it('skips a file past the size bound and takes the next match', () => {
        write('big.ts', 'x'.repeat(4_096));
        write('small.ts', 'export {};\n');

        const document = resolvePrimeDocument(TYPESCRIPT_PRESET, root, { maxBytes: 1_024 });

        expect(document?.uri).toBe(pathToFileURL(path.join(root, 'small.ts')).href);
    });

    it('gives up once the entry budget runs out', () => {
        write('a/b/buried.ts');
        for (let index = 0; index < 20; index++) {
            write(`a/filler-${index}.md`);
        }

        expect(resolvePrimeDocument(TYPESCRIPT_PRESET, root, { maxEntries: 3 })).toBeUndefined();
    });

    it('returns nothing for a root that does not exist', () => {
        expect(resolvePrimeDocument(TYPESCRIPT_PRESET, path.join(root, 'missing'))).toBeUndefined();
    });
});
