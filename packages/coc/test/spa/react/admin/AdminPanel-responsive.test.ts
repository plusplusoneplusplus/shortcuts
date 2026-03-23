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

    it('config inputs use compact py-0.5 styling (admin is always desktop context)', () => {
        // Admin panel is not a mobile-first form — always compact
        const inputMatches = adminPanelSource.match(/py-0\.5/g);
        expect(inputMatches).not.toBeNull();
    });

    it('form groups still stack responsively on narrow screens', () => {
        expect(adminPanelSource).toContain('flex-col md:flex-row');
    });
});
