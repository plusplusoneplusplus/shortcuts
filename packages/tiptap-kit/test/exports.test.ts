/**
 * Package contract: every `exports` subpath is a folder under src/ with an
 * index, the dist targets follow the same layout, and the root entry re-exports
 * every name of every area. `export *` silently drops a name two areas both
 * export, so a collision would vanish from the root without this check.
 * Areas that load an optional peer stay subpath-only, so importing the root
 * never requires that peer.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as root from '../src/index.js';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
    exports: Record<string, { types: string; import: string }>;
    peerDependencies: Record<string, string>;
    dependencies?: Record<string, string>;
};
const areas = Object.keys(manifest.exports)
    .filter((key) => key !== '.')
    .map((key) => key.slice(2));
/** Areas that import an optional peer (`math` loads katex, `markdown` loads marked and turndown, `front-matter` loads js-yaml). */
const SUBPATH_ONLY = ['math', 'markdown', 'front-matter'];

describe('tiptap-kit exports', () => {
    it('maps each subpath to src/<area>/index.ts and dist/<area>/index.js', () => {
        expect(areas.length).toBeGreaterThan(0);
        for (const area of areas) {
            expect(existsSync(join(pkgDir, 'src', area, 'index.ts')), area).toBe(true);
            expect(manifest.exports[`./${area}`]).toEqual({
                types: `./dist/${area}/index.d.ts`,
                import: `./dist/${area}/index.js`,
            });
        }
    });

    it('re-exports every area from the root without losing a name', async () => {
        const rootSource = readFileSync(join(pkgDir, 'src', 'index.ts'), 'utf8');
        for (const area of areas.filter((a) => !SUBPATH_ONLY.includes(a))) {
            expect(rootSource).toContain(`'./${area}/index.js'`);
            const mod = (await import(`../src/${area}/index.ts`)) as Record<string, unknown>;
            for (const [name, value] of Object.entries(mod)) {
                expect((root as Record<string, unknown>)[name], `${area}.${name}`).toBe(value);
            }
        }
    });

    it('keeps optional-peer areas out of the root entry', () => {
        const rootSource = readFileSync(join(pkgDir, 'src', 'index.ts'), 'utf8');
        const meta = (manifest as { peerDependenciesMeta?: Record<string, { optional?: boolean }> })
            .peerDependenciesMeta ?? {};
        for (const peer of ['katex', 'marked', 'turndown', 'js-yaml']) expect(meta[peer]?.optional, peer).toBe(true);
        for (const area of SUBPATH_ONLY) {
            expect(areas).toContain(area);
            expect(rootSource).not.toContain(`'./${area}/index.js'`);
        }
        expect(Object.keys(root)).not.toContain('renderMath');
        expect(Object.keys(root)).not.toContain('createMarkdownCodec');
        expect(Object.keys(root)).not.toContain('parseFrontMatter');
    });

    it('keeps Tiptap as a peer so the host app owns the single editor instance', () => {
        expect(Object.keys(manifest.peerDependencies)).toEqual(
            expect.arrayContaining(['@tiptap/core', '@tiptap/pm']),
        );
        expect(Object.keys(manifest.dependencies ?? {}).filter((d) => d.startsWith('@tiptap/'))).toEqual([]);
    });
});
