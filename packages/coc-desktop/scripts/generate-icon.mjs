// Refreshes the CoC desktop app icon at media/coc-icon.png from the canonical
// CoC brand asset (packages/coc/assets/icons/). The brand icon — a dark tile
// with the glowing blue/purple "C" ring — is the single source of truth and
// mirrors the web UI's CocIcon. electron-builder consumes this single PNG and
// derives the per-platform .icns / .ico at pack time (AC-07).
//
// We copy the 512×512 PNG: it is the largest raster the brand ships and is the
// minimum electron-builder accepts for a macOS .icns (256 for a Windows .ico).
// nativeImage (the dev dock/window/tray icon) needs a raster, so we use the PNG
// rather than the brand SVG.
//
// Run: node packages/coc-desktop/scripts/generate-icon.mjs
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '..', '..', 'coc', 'assets', 'icons', 'coc-icon-512x512.png');
const OUT = resolve(here, '..', '..', '..', 'media', 'coc-icon.png');

if (!statSync(SRC, { throwIfNoEntry: false })?.isFile()) {
  throw new Error(`CoC brand icon not found at ${SRC}`);
}

mkdirSync(dirname(OUT), { recursive: true });
copyFileSync(SRC, OUT);
console.log(`copied brand icon ${SRC} -> ${OUT}`);
