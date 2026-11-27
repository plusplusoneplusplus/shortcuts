/**
 * Package contract: each `exports` subpath is a src/<area>/index.ts with
 * matching dist paths, and `math` (optional katex peer) stays out of the root.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
    exports: Record<string, { types: string; import: string }>;
    peerDependencies: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    dependencies?: Record<string, string>;
};
const areas = Object.keys(manifest.exports).filter((k) => k !== '.').map((k) => k.slice(2));
const rootSource = readFileSync(join(pkgDir, 'src', 'index.ts'), 'utf8');

describe('tiptap-react exports', () => {
    it('maps each subpath to src/<area>/index.ts and dist/<area>/index.js', () => {
        expect(areas).toEqual(expect.arrayContaining(['math', 'mermaid']));
        for (const area of areas) {
            expect(existsSync(join(pkgDir, 'src', area, 'index.ts')), area).toBe(true);
            expect(manifest.exports[`./${area}`]).toEqual({
                types: `./dist/${area}/index.d.ts`,
                import: `./dist/${area}/index.js`,
            });
        }
    });

    it('keeps math subpath-only because katex is an optional peer', () => {
        expect(manifest.peerDependenciesMeta?.katex?.optional).toBe(true);
        expect(rootSource).not.toContain("'./math/index.js'");
        expect(rootSource).toContain("'./mermaid/index.js'");
    });

    it('keeps Tiptap and React as peers', () => {
        expect(Object.keys(manifest.peerDependencies)).toEqual(
            expect.arrayContaining(['@tiptap/core', '@tiptap/react', 'react', '@plusplusoneplusplus/tiptap-kit']),
        );
        const deps = Object.keys(manifest.dependencies ?? {});
        expect(deps.filter((d) => d.startsWith('@tiptap/') || d === 'react')).toEqual([]);
    });
});
