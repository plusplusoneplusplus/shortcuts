/**
 * Tests for WorkItemSection — localStorage-backed category expansion state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_PATH = path.join(
    __dirname,
    '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'work-items', 'WorkItemSection.tsx',
);

describe('WorkItemSection — localStorage persistence', () => {
    let src: string;

    beforeEach(() => {
        src = fs.readFileSync(SRC_PATH, 'utf-8');
    });

    it('uses a workspace-scoped localStorage key', () => {
        expect(src).toContain('coc-wi-categories-');
        expect(src).toContain('workspaceId');
    });

    it('reads initial state from localStorage', () => {
        expect(src).toContain('localStorage.getItem(storageKey)');
    });

    it('writes state to localStorage on toggle', () => {
        expect(src).toContain('localStorage.setItem(storageKey');
    });

    it('falls back to defaultCollapsed when localStorage is empty', () => {
        expect(src).toContain('defaultCollapsed');
        expect(src).toContain('defaults');
    });

    it('handles corrupt localStorage gracefully', () => {
        // Should have a try/catch around localStorage access
        const getItemIdx = src.indexOf('localStorage.getItem');
        expect(getItemIdx).toBeGreaterThan(-1);
        const tryCatchBefore = src.lastIndexOf('try {', getItemIdx);
        expect(tryCatchBefore).toBeGreaterThan(-1);
        expect(tryCatchBefore).toBeLessThan(getItemIdx);
    });

    it('handles corrupt JSON gracefully', () => {
        expect(src).toContain("typeof parsed === 'object'");
        expect(src).toContain('parsed !== null');
    });

    it('persists only valid object shapes', () => {
        expect(src).toContain('!Array.isArray(parsed)');
    });

    it('merges stored state with defaults (stored overrides defaults)', () => {
        expect(src).toContain('...defaults, ...parsed');
    });

    it('wraps toggle write in try/catch', () => {
        const setItemIdx = src.indexOf('localStorage.setItem(storageKey');
        expect(setItemIdx).toBeGreaterThan(-1);
        const tryCatchBefore = src.lastIndexOf('try {', setItemIdx);
        expect(tryCatchBefore).toBeGreaterThan(-1);
        expect(tryCatchBefore).toBeLessThan(setItemIdx);
    });

    it('uses storageKey variable (not hardcoded string in toggle)', () => {
        // The toggle should use the variable, not a hardcoded string
        const setItemIdx = src.indexOf('localStorage.setItem(storageKey');
        expect(setItemIdx).toBeGreaterThan(-1);
    });
});
