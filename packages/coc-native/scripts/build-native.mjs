#!/usr/bin/env node
/**
 * Compile the Rust addon and drop the result next to the loader as
 * `coc-native.<platform>-<arch>[-abi].node`.
 *
 * Deliberately not `@napi-rs/cli`: the loader here resolves binaries from disk
 * (locally built, then `prebuilt/`) rather than from per-platform npm packages,
 * so the only thing the CLI would add is a dependency. Everything else is a
 * `cargo build` plus a copy.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(packageRoot, 'rust', 'napi', 'Cargo.toml');

/** Platform/arch/abi triple used in the binary file name. */
export function nativeTriple(platform = process.platform, arch = process.arch) {
    if (platform === 'linux') return `linux-${arch}-gnu`;
    if (platform === 'win32') return `win32-${arch}-msvc`;
    return `${platform}-${arch}`;
}

/** File name the loader looks for. */
export function nativeBinaryName(platform = process.platform, arch = process.arch) {
    return `coc-native.${nativeTriple(platform, arch)}.node`;
}

/** Name cargo gives the compiled cdylib on this platform. */
export function cargoArtifactName(platform = process.platform) {
    if (platform === 'win32') return 'coc_native.dll';
    if (platform === 'darwin') return 'libcoc_native.dylib';
    return 'libcoc_native.so';
}

function main() {
    const profile = process.env.COC_NATIVE_PROFILE === 'debug' ? 'debug' : 'release';
    const args = ['build', '--manifest-path', manifestPath];
    if (profile === 'release') args.push('--release');
    if (process.env.CARGO_BUILD_TARGET) args.push('--target', process.env.CARGO_BUILD_TARGET);

    execFileSync('cargo', args, { stdio: 'inherit' });

    const targetDir = path.join(packageRoot, 'rust', 'target');
    const built = path.join(
        targetDir,
        ...(process.env.CARGO_BUILD_TARGET ? [process.env.CARGO_BUILD_TARGET] : []),
        profile,
        cargoArtifactName(),
    );
    const destination = path.join(packageRoot, nativeBinaryName());
    fs.copyFileSync(built, destination);
    console.log(`native file index: built ${path.relative(packageRoot, destination)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
