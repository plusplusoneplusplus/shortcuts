/**
 * Unit tests for `features/chat/list-mode-config` — the declarative
 * configuration the 001 refactor uses to drive `ChatListPane`.
 *
 * These tests pin the per-mode config so the single config-driven renderer
 * (added in later steps of 001) cannot drift behavior between modes
 * accidentally.
 */

import { describe, it, expect } from 'vitest';
import {
    resolveListMode,
    getListModeConfig,
    type ListMode,
} from '../../../../src/server/spa/client/react/features/chat/list-mode-config';

describe('resolveListMode', () => {
    it('maps undefined activeTab to activity', () => {
        expect(resolveListMode(undefined)).toBe('activity');
    });

    it('maps named tabs 1:1', () => {
        expect(resolveListMode('chats')).toBe('chats');
        expect(resolveListMode('tasks')).toBe('tasks');
    });
});

describe('getListModeConfig', () => {
    it('accepts both ListMode and legacy activeTab inputs', () => {
        expect(getListModeConfig('chats').mode).toBe('chats');
        expect(getListModeConfig('tasks').mode).toBe('tasks');
        expect(getListModeConfig('activity').mode).toBe('activity');
        expect(getListModeConfig(undefined).mode).toBe('activity');
    });

    it('chats mode: inline search, filter chips, ralph grouping', () => {
        const cfg = getListModeConfig('chats');
        expect(cfg.scope).toBe('chat-only');
        expect(cfg.showPauseBanner).toBe(false);
        expect(cfg.showScopeSegmented).toBe(false);
        expect(cfg.showFilterChips).toBe(true);
        expect(cfg.showSearchInput).toBe('inline');
        expect(cfg.enableRalphGrouping).toBe(true);
        expect(cfg.enablePlanGrouping).toBe(false);
        expect(cfg.enableServerSearchPanel).toBe(true);
        expect(cfg.historyLayout).toBe('status-priority');
    });

    it('activity mode: toolbar search, scope segmented, plan + ralph grouping', () => {
        const cfg = getListModeConfig('activity');
        expect(cfg.scope).toBe('scoped');
        expect(cfg.showPauseBanner).toBe(true);
        expect(cfg.showScopeSegmented).toBe(true);
        expect(cfg.showFilterChips).toBe(false);
        expect(cfg.showSearchInput).toBe('toolbar');
        // Plan 002: ralph grouping mirrors Chats; plan-file grouping is
        // applied to non-ralph residuals (ralph wins on overlap).
        expect(cfg.enableRalphGrouping).toBe(true);
        expect(cfg.enablePlanGrouping).toBe(true);
        expect(cfg.enableServerSearchPanel).toBe(false);
        expect(cfg.historyLayout).toBe('pinned-completed-archived');
    });

    it('tasks mode: pause banner, no chips, plan grouping', () => {
        const cfg = getListModeConfig('tasks');
        expect(cfg.scope).toBe('task-only');
        expect(cfg.showPauseBanner).toBe(true);
        expect(cfg.showScopeSegmented).toBe(false);
        expect(cfg.showFilterChips).toBe(false);
        expect(cfg.showSearchInput).toBe('toolbar');
        expect(cfg.enableRalphGrouping).toBe(false);
        expect(cfg.enablePlanGrouping).toBe(true);
        expect(cfg.historyLayout).toBe('pinned-completed-archived');
    });

    it.each(['chats', 'tasks', 'activity'] as ListMode[])(
        '%s mode: emits sections in a stable, valid order',
        mode => {
            const cfg = getListModeConfig(mode);
            const ids = cfg.sections.map(s => s.id);
            // No duplicates
            expect(new Set(ids).size).toBe(ids.length);
            // Date buckets follow today → week → older
            const todayIdx = ids.indexOf('today');
            const weekIdx = ids.indexOf('week');
            const olderIdx = ids.indexOf('older');
            expect(todayIdx).toBeGreaterThanOrEqual(0);
            expect(weekIdx).toBeGreaterThan(todayIdx);
            expect(olderIdx).toBeGreaterThan(weekIdx);
            // Archived is last (or absent)
            const archivedIdx = ids.indexOf('archived');
            if (archivedIdx >= 0) expect(archivedIdx).toBe(ids.length - 1);
            // Running always comes before any date bucket
            const runningIdx = ids.indexOf('running');
            expect(runningIdx).toBeLessThan(todayIdx);
        },
    );

    it('archived section defaults to collapsed across modes', () => {
        for (const mode of ['chats', 'tasks', 'activity'] as const) {
            const archived = getListModeConfig(mode).sections.find(s => s.id === 'archived');
            expect(archived?.defaultCollapsed).toBe(true);
        }
    });
});
