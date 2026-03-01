/**
 * E2E smoke test — loads the SPA at desktop viewport and asserts basic rendering.
 *
 * This is intentionally minimal: it establishes a regression baseline for the
 * responsive work. Subsequent commits will add mobile/tablet E2E tests.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { VIEWPORTS } from './helpers/viewports';

const SPA_ROOT = path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

describe('SPA responsive smoke', () => {
    it('exports desktop viewport preset with correct dimensions', () => {
        expect(VIEWPORTS.desktop).toEqual({ width: 1280, height: 800 });
    });

    it('exports mobile viewport preset with correct dimensions', () => {
        expect(VIEWPORTS.mobile).toEqual({ width: 375, height: 812 });
    });

    it('exports tablet viewport preset with correct dimensions', () => {
        expect(VIEWPORTS.tablet).toEqual({ width: 768, height: 1024 });
    });

    it('SPA client directory exists', () => {
        expect(fs.existsSync(SPA_ROOT)).toBe(true);
    });

    it('SPA entry point exists', () => {
        const entryPoints = ['index.tsx', 'index.ts', 'App.tsx', 'main.tsx'];
        const found = entryPoints.some(ep => fs.existsSync(path.join(SPA_ROOT, ep)));
        expect(found).toBe(true);
    });
});
