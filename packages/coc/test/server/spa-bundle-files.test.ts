/**
 * SPA Dashboard Tests — bundle file existence checks
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Bundle files', () => {
    const pkgRoot = path.resolve(__dirname, '../..');
    const clientDist = path.resolve(pkgRoot, 'src/server/spa/client/dist');

    it('bundle.js exists on disk', () => {
        expect(fs.existsSync(path.resolve(clientDist, 'bundle.js'))).toBe(true);
    });

    it('bundle.css exists on disk', () => {
        expect(fs.existsSync(path.resolve(clientDist, 'bundle.css'))).toBe(true);
    });

    it('bundle.js is non-empty', () => {
        const stat = fs.statSync(path.resolve(clientDist, 'bundle.js'));
        expect(stat.size).toBeGreaterThan(100);
    });

    it('bundle.css is non-empty', () => {
        const stat = fs.statSync(path.resolve(clientDist, 'bundle.css'));
        expect(stat.size).toBeGreaterThan(100);
    });
});
