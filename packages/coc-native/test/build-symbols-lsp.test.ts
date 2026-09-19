/**
 * The build and packaging path for the stdio symbol language server.
 *
 * Three seams matter and none of them are visible from the resolver: cargo has
 * to be asked for the right crate and profile, its output has to be found where
 * `--target` puts it, and what a release stages under `prebuilt/<triple>/` has
 * to land on a path the resolver actually tries.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { symbolsLspBinaryCandidates } from '../src/symbols-lsp';

// @ts-expect-error — .mjs build scripts with no type declarations.
import { CRATE, buildSymbolsLsp, cargoArgs, cargoOutputPath } from '../scripts/build-symbols-lsp.mjs';
// @ts-expect-error — .mjs build scripts with no type declarations.
import { tripleFromBinaryName } from '../../../scripts/stage-native-binaries.mjs';

const RELEASED_TRIPLES = [
    'linux-x64-gnu',
    'linux-arm64-gnu',
    'darwin-arm64',
    'darwin-x64',
    'win32-x64-msvc',
    'win32-arm64-msvc',
] as const;

describe('cargoArgs', () => {
    it('builds the bin crate from the workspace manifest', () => {
        const args = cargoArgs({ profile: 'release' });
        expect(args[0]).toBe('build');
        expect(args).toContain('-p');
        expect(args).toContain(CRATE);
        expect(args).toContain(path.join('rust', 'Cargo.toml'));
        expect(args).toContain('--release');
    });

    it('omits --release for a debug build', () => {
        expect(cargoArgs({ profile: 'debug' })).not.toContain('--release');
    });

    it('passes a cross-compilation target through', () => {
        expect(cargoArgs({ profile: 'release', target: 'aarch64-apple-darwin' })).toContain(
            'aarch64-apple-darwin',
        );
    });
});

describe('cargoOutputPath', () => {
    it('reads from target/<profile> without a target triple', () => {
        const output = cargoOutputPath({ profile: 'release', platform: 'linux' });
        expect(output.endsWith(path.join('rust', 'target', 'release', CRATE))).toBe(true);
    });

    // `--target` inserts a directory; missing that reads a binary from the
    // previous host build and ships it for the wrong architecture.
    it('reads from target/<triple>/<profile> with one', () => {
        const output = cargoOutputPath({
            profile: 'release',
            target: 'aarch64-apple-darwin',
            platform: 'darwin',
        });
        expect(
            output.endsWith(path.join('target', 'aarch64-apple-darwin', 'release', CRATE)),
        ).toBe(true);
    });

    it('expects a .exe on windows', () => {
        expect(cargoOutputPath({ profile: 'debug', platform: 'win32' }).endsWith('.exe')).toBe(true);
    });
});

describe('buildSymbolsLsp', () => {
    it('fails loudly when cargo produced nothing at the expected path', () => {
        expect(() =>
            buildSymbolsLsp({
                profile: 'release',
                target: 'nonexistent-triple',
                run: () => undefined,
                logger: { log: () => undefined },
            }),
        ).toThrow(/did not produce/);
    });

    it('copies the binary to the triple-qualified name, executable', () => {
        const source = cargoOutputPath({ profile: 'release' });
        const preexisting = fs.existsSync(source);
        if (!preexisting) {
            fs.mkdirSync(path.dirname(source), { recursive: true });
            fs.writeFileSync(source, '');
        }
        // `buildSymbolsLsp` writes to the real package root — there is no root
        // to redirect — and on a built tree that is the shipping binary, which
        // CI uploads as an artifact right after this suite runs. Leaving it
        // deleted silently drops the language server from every downstream job.
        const shipped = symbolsLspBinaryCandidates()[0];
        const saved = fs.existsSync(shipped)
            ? { content: fs.readFileSync(shipped), mode: fs.statSync(shipped).mode }
            : null;
        const logged: string[] = [];

        try {
            const destination = buildSymbolsLsp({
                profile: 'release',
                target: undefined,
                run: () => undefined,
                logger: { log: (line: string) => logged.push(line) },
            });

            expect(destination).toBe(shipped);
            expect(fs.existsSync(destination)).toBe(true);
            expect(symbolsLspBinaryCandidates()).toContain(destination);
            if (process.platform !== 'win32') {
                expect(fs.statSync(destination).mode & 0o111).not.toBe(0);
            }
            expect(logged.join('\n')).toContain('symbols lsp: built');
        } finally {
            if (!preexisting) fs.rmSync(source, { force: true });
            if (saved) {
                fs.writeFileSync(shipped, saved.content);
                fs.chmodSync(shipped, saved.mode);
            } else {
                fs.rmSync(shipped, { force: true });
            }
        }
    });
});

describe('release staging', () => {
    // The release uploads triple-qualified names and the staging script derives
    // the directory back out of them. A name either side cannot parse silently
    // drops a platform from the release.
    it.each(RELEASED_TRIPLES)('round-trips the %s artifact name', triple => {
        const suffix = triple.startsWith('win32') ? '.exe' : '';
        expect(tripleFromBinaryName(`coc-symbols-lsp.${triple}${suffix}`)).toBe(triple);
        expect(tripleFromBinaryName(`coc-native.${triple}.node`)).toBe(triple);
    });

    it('rejects a name neither build produces', () => {
        expect(tripleFromBinaryName('libsomething.so')).toBeNull();
    });

    it('stages into a directory the resolver searches', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-prebuilt-'));
        const [platform, arch] = ['linux', 'x64'];
        const name = `coc-symbols-lsp.linux-x64-gnu`;
        const staged = path.join(root, 'prebuilt', tripleFromBinaryName(name)!, name);

        expect(symbolsLspBinaryCandidates(root, platform, arch)).toContain(staged);
    });
});
