import { describe, it, expect } from 'vitest';
import { EXPLORE_FILTER, ALL_TOOLS_FILTER, createToolNameFilter } from '../../src/memory/tool-call-cache-presets';

describe('EXPLORE_FILTER', () => {
    it('matches task with agent_type=explore', () => {
        expect(EXPLORE_FILTER('task', { agent_type: 'explore' })).toBe(true);
    });

    it('matches task with agent_type=general-purpose', () => {
        expect(EXPLORE_FILTER('task', { agent_type: 'general-purpose' })).toBe(true);
    });

    it('matches task with no agent_type', () => {
        expect(EXPLORE_FILTER('task', {})).toBe(true);
    });

    it('rejects grep', () => {
        expect(EXPLORE_FILTER('grep', { pattern: 'foo' })).toBe(false);
    });

    it('rejects glob', () => {
        expect(EXPLORE_FILTER('glob', { pattern: '**/*.ts' })).toBe(false);
    });

    it('rejects view', () => {
        expect(EXPLORE_FILTER('view', { path: '/src/index.ts' })).toBe(false);
    });

    it('rejects read_file', () => {
        expect(EXPLORE_FILTER('read_file', {})).toBe(false);
    });

    it('rejects list_directory', () => {
        expect(EXPLORE_FILTER('list_directory', {})).toBe(false);
    });

    it('rejects edit', () => {
        expect(EXPLORE_FILTER('edit', {})).toBe(false);
    });

    it('rejects create', () => {
        expect(EXPLORE_FILTER('create', {})).toBe(false);
    });

    it('rejects powershell', () => {
        expect(EXPLORE_FILTER('powershell', {})).toBe(false);
    });
});

describe('ALL_TOOLS_FILTER', () => {
    it('matches everything', () => {
        expect(ALL_TOOLS_FILTER('anything', {})).toBe(true);
    });

    it('matches empty name', () => {
        expect(ALL_TOOLS_FILTER('', {})).toBe(true);
    });
});

describe('createToolNameFilter', () => {
    it('produces correct filter', () => {
        const filter = createToolNameFilter('grep', 'view');
        expect(filter('grep', {})).toBe(true);
        expect(filter('view', {})).toBe(true);
        expect(filter('edit', {})).toBe(false);
    });

    it('with no names matches nothing', () => {
        const filter = createToolNameFilter();
        expect(filter('grep', {})).toBe(false);
        expect(filter('', {})).toBe(false);
    });
});
