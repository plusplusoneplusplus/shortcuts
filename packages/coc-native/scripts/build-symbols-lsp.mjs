/**
 * Compile the `coc-symbols-lsp` stdio language server and place it where the
 * resolver looks.
 *
 * Separate from the addon build for one reason: this is a plain `cargo build`
 * of a bin crate, with no N-API, no `.d.ts` generation and no napi CLI. It runs
 * as part of `npm run build:native` so a single command still produces
 * everything the server needs, and stands alone as `npm run build:symbols-lsp`
 * when only the language server changed.
 *
 * The output is renamed to the triple-qualified name the resolver computes
 * (`coc-symbols-lsp.<triple>[.exe]`), for the same reason the addon is: a
 * release stages six of them side by side, and cargo's own output name is the
 * same on every platform.
 *
 * No hashbang on purpose — same reason as `build-native.mjs`: Vitest inlines a
 * project-local `.mjs` without an esbuild pass and only strips a leading `#!`
 * with an LF-only regex, so on a CRLF checkout it would land inside the module
 * wrapper and the importing suite would die.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { nativeTriple } from './build-native.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The crate and its bin target. */
export const CRATE = 'coc-symbols-lsp';

/** Name the resolver looks for. Must agree with `src/symbols-lsp.ts`. */
export function symbolsLspBinaryName(platform = process.platform, arch = process.arch) {
    const suffix = platform === 'win32' ? '.exe' : '';
    return `${CRATE}.${nativeTriple(platform, arch)}${suffix}`;
}

/** Arguments for `cargo build`. */
export function cargoArgs({ profile, target }) {
    const args = ['build', '--manifest-path', path.join('rust', 'Cargo.toml'), '-p', CRATE];
    if (profile === 'release') args.push('--release');
    if (target) args.push('--target', target);
    return args;
}

/**
 * Where cargo wrote the binary. `--target` adds a triple directory to the path;
 * without it the profile directory sits straight under `target/`.
 */
export function cargoOutputPath({ profile, target, platform = process.platform }) {
    const exe = platform === 'win32' ? '.exe' : '';
    return path.join(
        packageRoot,
        'rust',
        'target',
        ...(target ? [target] : []),
        profile,
        `${CRATE}${exe}`,
    );
}

/** Build the server and copy it next to the addon. Returns the destination. */
export function buildSymbolsLsp(options = {}) {
    const profile = options.profile ?? (process.env.COC_NATIVE_PROFILE === 'debug' ? 'debug' : 'release');
    const target = options.target ?? process.env.CARGO_BUILD_TARGET;
    const run =
        options.run ?? ((args) => execFileSync('cargo', args, { cwd: packageRoot, stdio: 'inherit' }));
    const logger = options.logger ?? console;

    run(cargoArgs({ profile, target }));

    const source = cargoOutputPath({ profile, target });
    if (!fs.existsSync(source)) {
        throw new Error(
            `cargo build did not produce ${path.relative(packageRoot, source)}. ` +
                'The bin target name in rust/lsp/Cargo.toml and CRATE here must agree.',
        );
    }

    const destination = path.join(packageRoot, symbolsLspBinaryName());
    fs.copyFileSync(source, destination);
    // copyFileSync preserves no mode on every platform, and a binary the
    // language-server manager cannot exec fails at spawn with EACCES.
    if (process.platform !== 'win32') fs.chmodSync(destination, 0o755);

    logger.log(`symbols lsp: built ${path.relative(packageRoot, destination)}`);
    return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    buildSymbolsLsp();
}
