/**
 * Move downloaded native artifacts into the layout the resolvers search:
 * `packages/coc-native/prebuilt/<triple>/`.
 *
 * Two artifacts per triple, both triple-qualified by their build:
 * `coc-native.<triple>.node` (the N-API addon) and
 * `coc-symbols-lsp.<triple>[.exe]` (the stdio language server). They share this
 * step because they share a resolution rule — package root first, then
 * `prebuilt/<triple>/` — so there is one place to look when either goes missing.
 *
 * `actions/download-artifact` with a `pattern` writes one directory per
 * artifact, so the binaries arrive nested and named but not placed. Failing
 * loudly here is the point — a packaging mistake must break the release, not
 * degrade silently into the JavaScript file-search fallback in production.
 *
 * Usage: node scripts/stage-native-binaries.mjs <download-dir>
 *
 * No hashbang on purpose. `build-symbols-lsp.test.ts` imports the name parsing
 * from here, and Vitest inlines a project-local `.mjs` without an esbuild pass
 * — Vite only skips a leading `#!` with the LF-only regex `/^#!.*\n/`. Every
 * caller runs this as `node scripts/stage-native-binaries.mjs`, so the hashbang
 * bought nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prebuiltRoot = path.join(repoRoot, 'packages', 'coc-native', 'prebuilt');

/**
 * `coc-native.linux-x64-gnu.node` → `linux-x64-gnu`, and
 * `coc-symbols-lsp.win32-x64-msvc.exe` → `win32-x64-msvc`. Anything else is
 * null, which the caller treats as a failed release rather than a file to skip.
 */
export function tripleFromBinaryName(fileName) {
    const addon = /^coc-native\.(.+)\.node$/.exec(fileName);
    if (addon) return addon[1];
    const lsp = /^coc-symbols-lsp\.(.+?)(\.exe)?$/.exec(fileName);
    return lsp ? lsp[1] : null;
}

/** Whether this file is one of the artifacts a release stages. */
export function isStageableBinary(fileName) {
    return fileName.startsWith('coc-native.') || fileName.startsWith('coc-symbols-lsp.');
}

/** Every stageable binary under `dir`, at any depth. */
export function findBinaries(dir, fsImpl = fs) {
    if (!fsImpl.existsSync(dir)) return [];
    const found = [];
    for (const entry of fsImpl.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...findBinaries(full, fsImpl));
        else if (isStageableBinary(entry.name)) found.push(full);
    }
    return found.sort();
}

function main() {
    const downloadDir = process.argv[2];
    if (!downloadDir) {
        console.error('usage: stage-native-binaries.mjs <download-dir>');
        process.exit(1);
    }

    const binaries = findBinaries(path.resolve(downloadDir));
    if (binaries.length === 0) {
        console.error(`[stage-native] no native binaries found under ${downloadDir}`);
        process.exit(1);
    }

    for (const source of binaries) {
        const name = path.basename(source);
        const triple = tripleFromBinaryName(name);
        if (!triple) {
            console.error(`[stage-native] unexpected binary name: ${name}`);
            process.exit(1);
        }
        const destinationDir = path.join(prebuiltRoot, triple);
        fs.mkdirSync(destinationDir, { recursive: true });
        const destination = path.join(destinationDir, name);
        fs.copyFileSync(source, destination);
        // Artifact download does not preserve the executable bit, and the
        // language server is spawned rather than dlopen'd — without this it
        // fails at exec with EACCES on the user's machine, not here.
        if (name.startsWith('coc-symbols-lsp') && process.platform !== 'win32') {
            fs.chmodSync(destination, 0o755);
        }
        console.log(`[stage-native] staged prebuilt/${triple}/${name}`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
