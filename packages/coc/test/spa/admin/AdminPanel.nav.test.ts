/**
 * Unit tests for AdminPanel navigation configuration — AC-01 (Memory in Knowledge group)
 * and AC-02 (sidebar group reorganization).
 *
 * These tests verify the static nav data (exported constants) rather than rendering
 * the full component, which would require extensive mocking of API calls and lazy
 * components.
 */

import { describe, it, expect } from 'vitest';
import {
    ALL_TOOL_NAV_ITEMS,
    TOOL_TAB_GROUP_LABELS,
} from '../../../src/server/spa/client/react/admin/AdminPanel';

// ── ALL_TOOL_NAV_ITEMS ────────────────────────────────────────────────────────

describe('ALL_TOOL_NAV_ITEMS', () => {
    it('includes a memory entry', () => {
        const item = ALL_TOOL_NAV_ITEMS.find(i => i.tab === 'memory');
        expect(item).toBeDefined();
        expect(item?.label).toBe('Memory');
        expect(item?.id).toBe('memory-toggle');
    });

    it('includes a skills entry', () => {
        const item = ALL_TOOL_NAV_ITEMS.find(i => i.tab === 'skills');
        expect(item).toBeDefined();
        expect(item?.label).toBe('Skills');
    });

    it('memory entry comes before skills entry (Knowledge group ordering)', () => {
        const memIdx = ALL_TOOL_NAV_ITEMS.findIndex(i => i.tab === 'memory');
        const skillsIdx = ALL_TOOL_NAV_ITEMS.findIndex(i => i.tab === 'skills');
        expect(memIdx).toBeGreaterThanOrEqual(0);
        expect(skillsIdx).toBeGreaterThanOrEqual(0);
        expect(memIdx).toBeLessThan(skillsIdx);
    });

    it('includes all expected tool tabs', () => {
        const tabs = ALL_TOOL_NAV_ITEMS.map(i => i.tab);
        expect(tabs).toContain('memory');
        expect(tabs).toContain('skills');
        expect(tabs).toContain('models');
        expect(tabs).toContain('stats');
        expect(tabs).toContain('logs');
        expect(tabs).toContain('servers');
    });
});

// ── TOOL_TAB_GROUP_LABELS ─────────────────────────────────────────────────────

describe('TOOL_TAB_GROUP_LABELS', () => {
    it('places memory in the Knowledge group (AC-01)', () => {
        expect(TOOL_TAB_GROUP_LABELS['memory']).toBe('Knowledge');
    });

    it('places skills in the Knowledge group (AC-02)', () => {
        expect(TOOL_TAB_GROUP_LABELS['skills']).toBe('Knowledge');
    });

    it('places models in Configure', () => {
        expect(TOOL_TAB_GROUP_LABELS['models']).toBe('Configure');
    });

    it('places servers in Connections', () => {
        expect(TOOL_TAB_GROUP_LABELS['servers']).toBe('Connections');
    });

    it('places stats in Operations', () => {
        expect(TOOL_TAB_GROUP_LABELS['stats']).toBe('Operations');
    });

    it('places logs in Operations', () => {
        expect(TOOL_TAB_GROUP_LABELS['logs']).toBe('Operations');
    });
});
