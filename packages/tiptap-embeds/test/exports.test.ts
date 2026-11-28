/**
 * Package contract: every JavaScript `exports` subpath is a folder under src/ with an
 * index, and the root re-exports every name of every area except the
 * subpath-only `markdown` (optional marked/turndown peers) and `pdf` (its
 * pdf.js renderer imports the optional pdfjs-dist peer) areas.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as root from '../src/index.js';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
    exports: Record<string, string | { types: string; import: string }>;
    peerDependencies: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    dependencies?: Record<string, string>;
};
const areas = Object.keys(manifest.exports).filter((key) => key !== '.' && key !== './styles.css').map((key) => key.slice(2));
const SUBPATH_ONLY = ['markdown', 'pdf'];

describe('tiptap-embeds exports', () => {
    it('maps each subpath to src/<area>/index.ts and dist/<area>/index.js', () => {
        expect(areas).toEqual(expect.arrayContaining(['urls', 'youtube', 'map', 'pdf', 'paper', 'markdown']));
        for (const area of areas) {
            expect(existsSync(join(pkgDir, 'src', area, 'index.ts')), area).toBe(true);
            expect(manifest.exports[`./${area}`]).toEqual({
                types: `./dist/${area}/index.d.ts`,
                import: `./dist/${area}/index.js`,
            });
        }
    });

    it('re-exports every area from the root without losing a name', async () => {
        for (const area of areas.filter((a) => !SUBPATH_ONLY.includes(a))) {
            const mod = (await import(`../src/${area}/index.ts`)) as Record<string, unknown>;
            for (const [name, value] of Object.entries(mod)) {
                expect((root as Record<string, unknown>)[name], `${area}.${name}`).toBe(value);
            }
        }
    });

    it('keeps optional-peer areas subpath-only', () => {
        const rootSource = readFileSync(join(pkgDir, 'src', 'index.ts'), 'utf8');
        for (const area of SUBPATH_ONLY) expect(rootSource).not.toContain(`'./${area}/index.js'`);
        expect(Object.keys(root)).not.toContain('pdfMarkdownExtension');
        expect(Object.keys(root)).not.toContain('renderPdfDocument');
        for (const peer of ['marked', 'turndown', 'pdfjs-dist']) expect(manifest.peerDependenciesMeta?.[peer]?.optional, peer).toBe(true);
    });

    it('keeps Tiptap and the kit as peers', () => {
        expect(Object.keys(manifest.peerDependencies)).toEqual(
            expect.arrayContaining(['@tiptap/core', '@tiptap/pm', '@tiptap/react', '@plusplusoneplusplus/tiptap-kit']),
        );
        expect(manifest.dependencies ?? {}).toEqual({});
    });
});
