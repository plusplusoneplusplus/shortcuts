/**
 * Generate CoC icon PNGs at multiple sizes from the default SVG template.
 * Usage: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const color1 = '#58a6ff';
const color2 = '#a371f7';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${color1}"/>
      <stop offset="100%" stop-color="${color2}"/>
    </linearGradient>
    <linearGradient id="g2" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${color2}"/>
      <stop offset="100%" stop-color="${color1}"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="pulse" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${color1}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${color1}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="#0d1117"/>
  <circle cx="50" cy="50" r="28" fill="url(#pulse)"/>
  <path d="M 58 15 A 35 35 0 1 0 58 85"
        fill="none" stroke="url(#g1)" stroke-width="8.5" stroke-linecap="round" filter="url(#glow)"/>
  <path d="M 48 30 A 20 20 0 1 1 48 70"
        fill="none" stroke="url(#g2)" stroke-width="6" stroke-linecap="round" filter="url(#glow)"/>
  <circle cx="50" cy="50" r="5" fill="${color1}" filter="url(#glow)"/>
  <circle cx="50" cy="50" r="9" fill="none" stroke="${color2}" stroke-width="1.2" opacity="0.45"/>
</svg>`;

const outDir = join(rootDir, 'packages', 'coc', 'assets', 'icons');
mkdirSync(outDir, { recursive: true });

// Save the default SVG
writeFileSync(join(outDir, 'coc-icon.svg'), svg);
console.log('Wrote coc-icon.svg');

const sizes = [16, 32, 48, 128, 256, 512];
const svgBuf = Buffer.from(svg);

for (const size of sizes) {
    const outPath = join(outDir, `coc-icon-${size}x${size}.png`);
    await sharp(svgBuf)
        .resize(size, size)
        .png()
        .toFile(outPath);
    console.log(`Wrote coc-icon-${size}x${size}.png`);
}

console.log('Done! Icons saved to packages/coc/assets/icons/');
