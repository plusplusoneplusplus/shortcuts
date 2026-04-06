/**
 * Tests for useDisplaySettings.ts — static source analysis.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const USE_DISPLAY_SETTINGS_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'hooks', 'useDisplaySettings.ts'
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
        expect(source).toContain('data?.resolved?.toolCompactness');
    });

    it('falls back to 3 when toolCompactness is absent', () => {
        expect(source).toContain('data?.resolved?.toolCompactness ?? 3');
    });

    it('includes taskCardDensity in DisplaySettings interface', () => {
        expect(source).toContain("taskCardDensity: 'compact' | 'dense'");
    });

    it('includes taskCardDensity default of dense in DEFAULT_SETTINGS', () => {
        expect(source).toContain("taskCardDensity: 'dense'");
    });

    it('maps taskCardDensity from resolved in fetchDisplaySettings', () => {
        expect(source).toContain('data?.resolved?.taskCardDensity');
    });

    it('falls back to dense when taskCardDensity is absent', () => {
        expect(source).toContain("taskCardDensity === 'compact' ? 'compact' : 'dense'");
    });
});