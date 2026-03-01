/**
 * Tests for AdminPanel — responsive layout verification.
 * Validates responsive-container class and input touch targets.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Verify admin panel source has responsive-container and touch-friendly input classes
const adminPanelSource = readFileSync(
    resolve(__dirname, '../../../../src/server/spa/client/react/admin/AdminPanel.tsx'),
    'utf-8'
);

describe('AdminPanel responsive layout', () => {
    it('uses responsive-container class for outermost content container', () => {
        expect(adminPanelSource).toContain('responsive-container');
    });

    it('config inputs have min-h-[44px] for mobile touch targets', () => {
        // All config inputs should have the mobile touch target height
        const inputMatches = adminPanelSource.match(/min-h-\[44px\]/g);
        expect(inputMatches).not.toBeNull();
        // At least 5 inputs (model, parallelism, timeout, output, follow-up count)
        expect(inputMatches!.length).toBeGreaterThanOrEqual(5);
    });

    it('config inputs have md:min-h-0 for desktop reset', () => {
        const inputMatches = adminPanelSource.match(/md:min-h-0/g);
        expect(inputMatches).not.toBeNull();
        expect(inputMatches!.length).toBeGreaterThanOrEqual(5);
    });

    it('form groups use flex-col md:flex-row for responsive stacking', () => {
        expect(adminPanelSource).toContain('flex-col md:flex-row');
    });
});
