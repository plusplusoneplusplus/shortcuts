/**
 * Package contract: each JavaScript `exports` subpath is a src/<area>/index.ts with
 * matching dist paths, the root re-exports every other area without losing a
 * name (`export *` drops collisions silently), and the optional-peer areas
 * (`math` loads katex, `code-block` loads lowlight and highlight.js) stay out
 * of the root.
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
const areas = Object.keys(manifest.exports).filter((k) => k !== '.' && k !== './styles.css').map((k) => k.slice(2));
const rootSource = readFileSync(join(pkgDir, 'src', 'index.ts'), 'utf8');
const SUBPATH_ONLY = ['math', 'code-block'];

describe('tiptap-react exports', () => {
    it('maps each subpath to src/<area>/index.ts and dist/<area>/index.js', () => {
        expect(areas).toEqual(expect.arrayContaining(['editor', 'toolbar', 'toc', 'math', 'mermaid', 'image', 'code-block']));
        for (const area of areas) {
            expect(existsSync(join(pkgDir, 'src', area, 'index.ts')), area).toBe(true);
            expect(manifest.exports[`./${area}`]).toEqual({
                types: `./dist/${area}/index.d.ts`,
                import: `./dist/${area}/index.js`,
            });
        }
    });

    it('re-exports every area except the optional-peer ones from the root without losing a name', async () => {
        for (const area of areas.filter((a) => !SUBPATH_ONLY.includes(a))) {
            expect(rootSource).toContain(`'./${area}/index.js'`);
            const mod = (await import(`../src/${area}/index.ts`)) as Record<string, unknown>;
            for (const [name, value] of Object.entries(mod)) {
                expect((root as Record<string, unknown>)[name], `${area}.${name}`).toBe(value);
            }
        }
    });

    it('keeps optional-peer areas subpath-only', () => {
        for (const peer of ['katex', '@tiptap/extension-code-block-lowlight', 'lowlight', 'highlight.js']) {
            expect(manifest.peerDependenciesMeta?.[peer]?.optional, peer).toBe(true);
        }
        for (const area of SUBPATH_ONLY) expect(rootSource).not.toContain(`'./${area}/index.js'`);
        expect(Object.keys(root)).not.toContain('codeLowlight');
    });

    it('keeps Tiptap and React as peers', () => {
        expect(Object.keys(manifest.peerDependencies)).toEqual(
            expect.arrayContaining(['@tiptap/core', '@tiptap/react', 'react', '@plusplusoneplusplus/tiptap-kit']),
        );
        const deps = Object.keys(manifest.dependencies ?? {});
        expect(deps.filter((d) => d.startsWith('@tiptap/') || d === 'react')).toEqual([]);
    });
});
