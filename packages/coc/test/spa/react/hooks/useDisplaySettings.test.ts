/**
 * Tests for useDisplaySettings.ts — static source analysis.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const USE_DISPLAY_SETTINGS_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'hooks', 'preferences', 'useDisplaySettings.ts'
);

describe('useDisplaySettings', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(USE_DISPLAY_SETTINGS_PATH, 'utf-8');
    });

    it('exports useDisplaySettings function', () => {
        expect(source).toContain('export function useDisplaySettings');
    });

    it('exports invalidateDisplaySettings function', () => {
        expect(source).toContain('export function invalidateDisplaySettings');
    });

    it('includes toolCompactness in DisplaySettings interface', () => {
        expect(source).toContain('toolCompactness: 0 | 1 | 2 | 3');
    });

    it('includes toolCompactness default of 3 in DEFAULT_SETTINGS', () => {
        expect(source).toContain('toolCompactness: 3');
    });

    it('maps toolCompactness from resolved in fetchDisplaySettings', () => {
        expect(source).toContain('resolved?.toolCompactness');
    });

    it('falls back to 3 when toolCompactness is absent', () => {
        expect(source).toContain('resolved?.toolCompactness ?? 3');
    });

    it('includes taskCardDensity in DisplaySettings interface', () => {
        expect(source).toContain("taskCardDensity: 'compact' | 'dense'");
    });

    it('includes taskCardDensity default of dense in DEFAULT_SETTINGS', () => {
        expect(source).toContain("taskCardDensity: 'dense'");
    });

    it('maps taskCardDensity from resolved in fetchDisplaySettings', () => {
        expect(source).toContain('resolved?.taskCardDensity');
    });

    it('falls back to dense when taskCardDensity is absent', () => {
        expect(source).toContain("taskCardDensity === 'compact' ? 'compact' : 'dense'");
    });
});

// ── Deep-link initial-state seeding from __DASHBOARD_CONFIG__ ────────────────

describe('useDisplaySettings — __DASHBOARD_CONFIG__ seeding', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(USE_DISPLAY_SETTINGS_PATH, 'utf-8');
    });

    it('imports feature flag helpers from config', () => {
        expect(source).toContain('isTerminalEnabled');
        expect(source).toContain('isNotesEnabled');
        expect(source).toContain('isDreamsEnabled');
        expect(source).toMatch(/from\s+['"]\.\.\/\.\.\/utils\/config['"]/);
    });

    it('defines getInitialSettings that spreads DEFAULT_SETTINGS with config values', () => {
        expect(source).toContain('function getInitialSettings');
        expect(source).toContain('...DEFAULT_SETTINGS');
        expect(source).toContain('isTerminalEnabled()');
        expect(source).toContain('isNotesEnabled()');
        expect(source).toContain('isDreamsEnabled()');
    });

    it('uses getInitialSettings() as useState fallback instead of DEFAULT_SETTINGS', () => {
        expect(source).toContain('cachedSettings ?? getInitialSettings()');
        // Should NOT fall back to DEFAULT_SETTINGS in useState
        expect(source).not.toMatch(/useState.*cachedSettings\s*\?\?\s*DEFAULT_SETTINGS/);
    });
});

describe('useDisplaySettings — Dreams feature flag', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(USE_DISPLAY_SETTINGS_PATH, 'utf-8');
    });

    it('includes dreamsEnabled in DisplaySettings', () => {
        expect(source).toContain('dreamsEnabled: boolean');
    });

    it('defaults dreamsEnabled to false', () => {
        expect(source).toContain('dreamsEnabled: false');
    });

    it('seeds dreamsEnabled from bootstrap runtime config', () => {
        expect(source).toContain('dreamsEnabled: isDreamsEnabled()');
    });

    it('maps dreamsEnabled from resolved admin config', () => {
        expect(source).toContain('dreamsEnabled: resolved?.dreams?.enabled ?? false');
    });
});
