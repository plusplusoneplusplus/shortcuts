#!/usr/bin/env node
/**
 * Move downloaded `coc-native.<triple>.node` artifacts into the layout the
 * loader searches: `packages/coc-native/prebuilt/<triple>/`.
 *
 * `actions/download-artifact` with a `pattern` writes one directory per
 * artifact, so the binaries arrive nested and named but not placed. Failing
 * loudly here is the point — a packaging mistake must break the release, not
 * degrade silently into the JavaScript file-search fallback in production.
 *
 * Usage: node scripts/stage-native-binaries.mjs <download-dir>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prebuiltRoot = path.join(repoRoot, 'packages', 'coc-native', 'prebuilt');

/** `coc-native.linux-x64-gnu.node` → `linux-x64-gnu`. */
export function tripleFromBinaryName(fileName) {
    const match = /^coc-native\.(.+)\.node$/.exec(fileName);
    return match ? match[1] : null;
}

/** Every `.node` file under `dir`, at any depth. */
export function findBinaries(dir, fsImpl = fs) {
    if (!fsImpl.existsSync(dir)) return [];
    const found = [];
    for (const entry of fsImpl.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...findBinaries(full, fsImpl));
        else if (entry.name.endsWith('.node')) found.push(full);
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
        console.error(`[stage-native] no .node binaries found under ${downloadDir}`);
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
        fs.copyFileSync(source, path.join(destinationDir, name));
        console.log(`[stage-native] staged prebuilt/${triple}/${name}`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
