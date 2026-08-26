/**
 * Rust ↔ TypeScript ranking parity.
 *
 * `/search` is answered by the native scorer alone. The TypeScript one is the
 * reference implementation it was ported from, and this test is what keeps the
 * port honest — a CI gate on every platform that builds a binary, not a
 * nice-to-have.
 *
 * The TypeScript scorer is imported straight from the coc package source so
 * there is exactly one reference implementation to drift from.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { rankFuzzyMatches } from '../../coc/src/server/shared/fuzzy-file-score';
import { addon, makeRandom } from './helpers';

const SEGMENTS = [
    'src', 'test', 'lib', 'dist', 'packages', 'server', 'client', 'index', 'utils', 'Repo',
    'treeService', 'quick_open', 'FILE', 'a', 'zz', 'café', '日本語', 'with space', 'x-y', 'v2',
];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.md', '.json', '.rs', ''];

function randomPaths(random: () => number, count: number): string[] {
    const paths = new Set<string>();
    while (paths.size < count) {
        const depth = 1 + Math.floor(random() * 4);
        const parts: string[] = [];
        for (let i = 0; i < depth; i++) {
            parts.push(SEGMENTS[Math.floor(random() * SEGMENTS.length)]);
        }
        const extension = EXTENSIONS[Math.floor(random() * EXTENSIONS.length)];
        paths.add(`${parts.join('/')}${extension}`);
    }
    return [...paths];
}

function randomQuery(random: () => number, paths: string[]): string {
    // Half the queries are drawn from a real path so they actually match;
    // the rest are noise, exercising the no-match and bail-out branches.
    if (random() < 0.5) {
        const source = paths[Math.floor(random() * paths.length)];
        const start = Math.floor(random() * source.length);
        const length = 1 + Math.floor(random() * 6);
        const slice = source.slice(start, start + length);
        if (slice) return random() < 0.5 ? slice.toUpperCase() : slice;
    }
    const alphabet = 'abcdefgxyz/._-9 é';
    const length = 1 + Math.floor(random() * 5);
    let query = '';
    for (let i = 0; i < length; i++) {
        query += alphabet[Math.floor(random() * alphabet.length)];
    }
    return query;
}

/**
 * Build a native index whose path list is exactly `paths`, by materialising
 * them on disk. The walker sorts its output, so both sides rank the same list
 * in the same order and ties break identically.
 */
async function nativeIndexOf(paths: string[]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-parity-'));
    const created: string[] = [];
    for (const relative of paths) {
        const target = path.join(root, relative);
        try {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, '');
            created.push(relative);
        } catch {
            // Random generation can make one path a directory prefix of
            // another; whichever loses is simply not part of this run's list.
        }
    }
    const index = await addon.buildFileIndex(root, { includeIgnored: true });
    return { root, index, created };
}

describe('native and TypeScript scorers rank identically', () => {
    it('agrees on scores, order and match indices for random paths and queries', async () => {
        const random = makeRandom(0x5eed);
        const paths = randomPaths(random, 400);
        const { root, index, created } = await nativeIndexOf(paths);

        try {
            // The walker's sorted order is the list the TypeScript side must rank,
            // because tie-breaking follows input order on both sides.
            const ordered = index.files(0, index.len());
            expect(new Set(ordered)).toEqual(new Set(created));
            expect(ordered.length).toBeGreaterThan(300);

            let matchedAtLeastOnce = false;
            for (let iteration = 0; iteration < 300; iteration++) {
                const query = randomQuery(random, created);
                const limit = 1 + Math.floor(random() * 60);

                const native = await index.search(query, limit);
                const reference = rankFuzzyMatches(query, ordered, limit);

                expect(native.map(m => m.path)).toEqual(reference.map(m => m.path));
                expect(native.map(m => m.score)).toEqual(reference.map(m => m.score));
                expect(native.map(m => m.indices)).toEqual(reference.map(m => m.indices));
                if (native.length > 0) matchedAtLeastOnce = true;
            }
            // Guard against a vacuous pass where nothing ever matched.
            expect(matchedAtLeastOnce).toBe(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('agrees on queries that tie across many paths', async () => {
        // Same score for every path, so any tie-break difference shows up.
        const paths = Array.from({ length: 200 }, (_, i) => `dir${String(i).padStart(3, '0')}/x.ts`);
        const { root, index } = await nativeIndexOf(paths);
        try {
            const ordered = index.files(0, index.len());
            for (const limit of [1, 3, 17, 200]) {
                const native = await index.search('x', limit);
                const reference = rankFuzzyMatches('x', ordered, limit);
                expect(native.map(m => m.path)).toEqual(reference.map(m => m.path));
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('agrees on edge-case queries', async () => {
        const paths = [
            'src/index.ts',
            'README.md',
            'a',
            'café/résumé.md',
            'with space/file.ts',
            // The filename-vs-path ranking cases: a basename match, a deeper
            // copy of the same name, and a path that only matches on its
            // directories.
            'packages/deep-wiki/src/seeds/prompts.ts',
            'packages/forge/src/ai/prompts.ts',
            'packages/forge/src/ai/prompt-builder.ts',
            'packages/forge/src/utils/prompt-resolver.ts',
            'packages/forge/src/ai/command-types.ts',
            'packages/coc/src/commands/wipe-data.ts',
        ];
        const { root, index } = await nativeIndexOf(paths);
        try {
            const ordered = index.files(0, index.len());
            const queries = [
                '', 'a', 'A', '/', '.', 'é', 'É', ' ', 'zzzzzzzzzzzzzzzzzzzzzzzzzz', 'srcindexts',
                'prompt', 'PROMPT', 'prompts', 'promptbuilder', 'ai/prompt', 'p', 'pt',
            ];
            for (const query of queries) {
                const native = await index.search(query, 50);
                const reference = rankFuzzyMatches(query, ordered, 50);
                expect(native.map(m => [m.path, m.score, m.indices])).toEqual(
                    reference.map(m => [m.path, m.score, m.indices]),
                );
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
